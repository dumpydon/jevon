import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { analyzeWithJev, JevError } from '../src/lib/jev/client';
import { DECISION_COUNT, JEV_MODEL, LIMITS } from '../src/lib/config';
import { EVALUATION_EXAMPLES } from '../src/lib/fixtures';
import { evaluateFixture } from '../src/lib/benchmark';
import { processBatch } from '../src/server/batch';
import type { AnalysisResult, ApiError, BenchmarkRun, HealthStatus } from '../src/lib/types';
import { analyzeSchema, batchSchema, benchmarkSchema } from './validation';

export interface Bindings {
  TYPESAFE_API_KEY?: string;
  ASSETS?: { fetch(request: Request): Promise<Response> };
  INFERENCE_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
type ApiEnvironment = { Bindings: Bindings; Variables: { requestId: string } };
export type AnalyzeFunction = typeof analyzeWithJev;

export function safeError(
  error: unknown,
  requestId: string,
): { error: ApiError; status: 400 | 401 | 402 | 403 | 408 | 429 | 500 | 502 | 503 | 504 } {
  if (error instanceof JevError) {
    return { error: { code: error.code, message: error.message, requestId }, status: error.status };
  }
  if (error instanceof ZodError)
    return {
      error: {
        code: 'INVALID_INPUT',
        message: error.issues[0]?.message ?? 'Invalid input.',
        requestId,
      },
      status: 400,
    };
  if (error instanceof SyntaxError)
    return {
      error: { code: 'INVALID_JSON', message: 'The request must contain valid JSON.', requestId },
      status: 400,
    };
  return {
    error: {
      code: 'INTERNAL_ERROR',
      message: 'The request could not be completed. Try again or check server configuration.',
      requestId,
    },
    status: 500,
  };
}

export function createApi(analyze: AnalyzeFunction = analyzeWithJev) {
  const app = new Hono<ApiEnvironment>();
  app.use('/api/*', async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set('requestId', requestId);
    c.header('X-Request-ID', requestId);
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const origin = c.req.header('origin');
    if (c.req.method === 'POST' && origin && origin !== new URL(c.req.url).origin) {
      return c.json(
        {
          error: {
            code: 'INVALID_ORIGIN',
            message: 'Submit requests from the Jevon application.',
            requestId,
          },
        },
        403,
      );
    }
    const started = performance.now();
    await next();
    console.info(
      JSON.stringify({
        event: 'api_request',
        requestId,
        path: c.req.path,
        durationMs: Math.round(performance.now() - started),
        status: c.res.status,
      }),
    );
  });
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: LIMITS.maxCsvBytes + 16384,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'REQUEST_TOO_LARGE',
              message: 'Request exceeds the upload limit.',
              requestId: c.get('requestId'),
            },
          },
          413,
        ),
    }),
  );
  app.use('/api/*', async (c, next) => {
    if (c.req.method === 'POST' && c.env.INFERENCE_RATE_LIMIT) {
      // This anonymous portfolio demo has no user identity. Cloudflare sets this header.
      const { success } = await c.env.INFERENCE_RATE_LIMIT.limit({
        key: `inference:${c.req.header('cf-connecting-ip') ?? 'anonymous'}`,
      });
      if (!success) {
        c.header('Retry-After', '60');
        return c.json(
          {
            error: {
              code: 'APP_RATE_LIMIT',
              message: 'Too many analysis requests. Wait a minute before trying again.',
              requestId: c.get('requestId'),
            },
          },
          429,
        );
      }
    }
    await next();
  });

  app.get('/api/health', (c) => {
    const result: HealthStatus = {
      status: 'ok',
      jevConfigured: Boolean(c.env.TYPESAFE_API_KEY?.trim()),
      model: JEV_MODEL,
      decisionCount: DECISION_COUNT,
      limits: {
        maxReviews: LIMITS.maxReviews,
        concurrency: LIMITS.concurrency,
        maxCharacters: LIMITS.maxCharacters,
      },
      baselineConfigured: false,
    };
    return c.json(result);
  });

  app.post('/api/analyze', async (c) => {
    const { reviewText } = analyzeSchema.parse(await c.req.json());
    const result = await analyze(
      { reviewId: c.get('requestId'), product: 'Customer feedback', reviewText },
      {
        apiKey: c.env.TYPESAFE_API_KEY ?? '',
        requestId: c.get('requestId'),
        signal: c.req.raw.signal,
      },
    );
    return c.json(result);
  });

  app.post('/api/batch', async (c) => {
    const { reviews } = batchSchema.parse(await c.req.json());
    if (!c.env.TYPESAFE_API_KEY?.trim())
      return c.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Jev is not configured. Set TYPESAFE_API_KEY on the server.',
            requestId: c.get('requestId'),
          },
        },
        503,
      );
    const requestId = c.get('requestId');
    const controller = new AbortController();
    const signal = AbortSignal.any([c.req.raw.signal, controller.signal]);
    c.header('Content-Type', 'application/x-ndjson');
    c.header('X-Accel-Buffering', 'no');
    return stream(c, async (output) => {
      output.onAbort(() => controller.abort());
      // Serialize concurrent completions so each NDJSON event remains atomic.
      let writeQueue = Promise.resolve();
      try {
        await processBatch(
          reviews,
          (review, options) =>
            analyze(review, { ...options, apiKey: c.env.TYPESAFE_API_KEY ?? '' }),
          {
            signal,
            requestId,
            toApiError: (error, itemId) => safeError(error, itemId).error,
            onProgress: (event) => {
              writeQueue = writeQueue.then(async () => {
                if (!signal.aborted) await output.writeln(JSON.stringify(event));
              });
              return writeQueue;
            },
          },
        );
      } catch (error) {
        if (!signal.aborted)
          await output.writeln(
            JSON.stringify({ type: 'error', error: safeError(error, requestId).error }),
          );
      }
    });
  });

  app.post('/api/benchmark', async (c) => {
    const { exampleIds } = benchmarkSchema.parse(await c.req.json());
    const examples = exampleIds.map((id) =>
      EVALUATION_EXAMPLES.find((example) => example.id === id),
    );
    if (examples.some((example) => !example))
      return c.json(
        {
          error: {
            code: 'INVALID_INPUT',
            message: 'Select examples from the evaluation fixture.',
            requestId: c.get('requestId'),
          },
        },
        400,
      );
    if (!c.env.TYPESAFE_API_KEY?.trim())
      return c.json(
        {
          error: {
            code: 'NOT_CONFIGURED',
            message: 'Jev is not configured. Set TYPESAFE_API_KEY on the server.',
            requestId: c.get('requestId'),
          },
        },
        503,
      );
    const started = performance.now();
    const reviews = examples.map((example) => ({
      reviewId: example!.id,
      product: 'Evaluation fixture',
      reviewText: example!.text,
    }));
    const batch = await processBatch(
      reviews,
      (review, options) => analyze(review, { ...options, apiKey: c.env.TYPESAFE_API_KEY ?? '' }),
      {
        requestId: c.get('requestId'),
        signal: c.req.raw.signal,
        toApiError: (error, id) => safeError(error, id).error,
      },
    );
    const run: BenchmarkRun = {
      id: c.get('requestId'),
      createdAt: new Date().toISOString(),
      model: JEV_MODEL,
      durationMs: Math.round(performance.now() - started),
      measurements: batch.items.map((item) => {
        const example = EVALUATION_EXAMPLES.find((entry) => entry.id === item.review.reviewId)!;
        if (item.status === 'failed')
          return {
            id: example.id,
            name: example.name,
            status: 'failed',
            latencyMs: null,
            schemaValid: false,
            agreements: 0,
            assertions: 0,
            error: item.error,
          };
        const result: AnalysisResult = item.result;
        return {
          id: example.id,
          name: example.name,
          status: 'success',
          latencyMs: result.durationMs,
          schemaValid: true,
          ...evaluateFixture(example, result),
          result,
        };
      }),
      baseline: {
        status: 'not_configured',
        reason:
          'This build measures Jev. A conventional LLM baseline is optional and has no provider credential configured.',
      },
    };
    return c.json(run);
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    const failure = safeError(error, c.get('requestId'));
    console.warn(
      JSON.stringify({
        event: 'api_error',
        requestId: c.get('requestId'),
        code: failure.error.code,
        status: failure.status,
      }),
    );
    return c.json({ error: failure.error }, failure.status);
  });
  app.all('/api/*', (c) =>
    c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'API route not found.',
          requestId: c.get('requestId'),
        },
      },
      404,
    ),
  );
  return app;
}
