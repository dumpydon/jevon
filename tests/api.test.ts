import { describe, expect, it, vi } from 'vitest';
import { createApi } from '../server/api';
import { JevError } from '../src/lib/jev/client';
import type { AnalyzeFunction } from '../server/api';
import type { AnalysisResult, BatchEvent, BenchmarkRun, HealthStatus } from '../src/lib/types';
import { makeResult } from './helpers';
import { LIMITS } from '../src/lib/config';

const mockAnalyze: AnalyzeFunction = vi.fn(async (review, options) =>
  makeResult(review, options.requestId),
);
const env = { TYPESAFE_API_KEY: 'test-credential-for-mocked-tests' };
const post = (body: unknown, headers?: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('server API boundary (no paid requests)', () => {
  it('reports configuration without exposing credentials', async () => {
    const response = await createApi(mockAnalyze).request('/api/health', {}, env);
    const body: HealthStatus = await response.json();
    expect(body.jevConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain(env.TYPESAFE_API_KEY);
    expect(body.decisionCount).toBe(19);
    expect(body.limits).toMatchObject({ maxReviews: 50, concurrency: 2 });
  });
  it('enforces the deployment rate-limit binding before inference', async () => {
    const analyze = vi.fn(mockAnalyze);
    const limit = vi.fn(async () => ({ success: false }));
    const response = await createApi(analyze).request(
      '/api/analyze',
      post({ reviewText: 'Fine' }),
      { ...env, INFERENCE_RATE_LIMIT: { limit } },
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(analyze).not.toHaveBeenCalled();
  });
  it('accepts trimmed feedback and returns typed decisions with a request ID', async () => {
    const response = await createApi(mockAnalyze).request(
      '/api/analyze',
      post({ reviewText: '  Good battery.  ' }),
      env,
    );
    const result: AnalysisResult = await response.json();
    expect(response.status).toBe(200);
    expect(result.review.reviewText).toBe('Good battery.');
    expect(result.traces).toHaveLength(19);
    expect(response.headers.get('x-request-id')).toBe(result.requestId);
    expect(JSON.stringify(result)).not.toContain(env.TYPESAFE_API_KEY);
  });
  it.each(['', '   ', 'x'.repeat(8001)])(
    'rejects empty and oversized feedback before inference',
    async (reviewText) => {
      const analyze = vi.fn(mockAnalyze);
      const response = await createApi(analyze).request('/api/analyze', post({ reviewText }), env);
      expect(response.status).toBe(400);
      expect(analyze).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed JSON, extra fields, and cross-origin submissions', async () => {
    const app = createApi(mockAnalyze);
    expect(
      (
        await app.request(
          '/api/analyze',
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' },
          env,
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request('/api/analyze', post({ reviewText: 'Good', apiKey: 'client-key' }), env))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          'http://localhost/api/analyze',
          post({ reviewText: 'Good' }, { Origin: 'https://another-site.test' }),
          env,
        )
      ).status,
    ).toBe(403);
  });
  it('handles missing configuration and typed upstream errors', async () => {
    const missing = await createApi().request('/api/analyze', post({ reviewText: 'Good' }), {});
    expect(missing.status).toBe(503);
    const app = createApi(async () => {
      throw new JevError('RATE_LIMIT', 'TypeSafe returned a rate-limit response.', 429, 429);
    });
    const response = await app.request('/api/analyze', post({ reviewText: 'Good' }), env);
    expect(response.status).toBe(429);
    const body: { error: { code: string; requestId: string } } = await response.json();
    expect(body.error.code).toBe('RATE_LIMIT');
    expect(body.error.requestId).toBeTruthy();
  });
  it('does not leak unexpected error details', async () => {
    const response = await createApi(async () => {
      throw new Error('sensitive review and private secret');
    }).request('/api/analyze', post({ reviewText: 'Good' }), env);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private secret');
  });
  it('rejects invalid or duplicate batch rows before inference', async () => {
    const analyze = vi.fn(mockAnalyze);
    const app = createApi(analyze);
    const review = { reviewId: 'one', product: 'Phone', reviewText: 'Fine' };
    expect((await app.request('/api/batch', post({ reviews: [review, review] }), env)).status).toBe(
      400,
    );
    expect(
      (await app.request('/api/batch', post({ reviews: [{ ...review, reviewText: '' }] }), env))
        .status,
    ).toBe(400);
    const oversized = await app.request(
      '/api/batch',
      post({ reviews: Array.from({ length: 51 }, (_, i) => ({ ...review, reviewId: String(i) })) }),
      env,
    );
    expect(oversized.status).toBe(400);
    expect(await oversized.json()).toMatchObject({
      error: { message: 'Jevon supports up to 50 reviews per batch.' },
    });
    expect(analyze).not.toHaveBeenCalled();
  });
  it('accepts 50 reviews and a 1 MiB JSON request through the server body guard', async () => {
    const analyze = vi.fn(mockAnalyze);
    const reviews = Array.from({ length: 50 }, (_, index) => ({
      reviewId: String(index),
      product: 'Phone',
      reviewText: 'Good battery',
    }));
    const json = JSON.stringify({ reviews });
    const body = json + ' '.repeat(1_048_576 - new TextEncoder().encode(json).byteLength);
    const response = await createApi(analyze).request(
      '/api/batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      },
      env,
    );
    expect(response.status).toBe(200);
    const events: BatchEvent[] = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as BatchEvent);
    const complete = events.find((event) => event.type === 'complete');
    if (complete?.type !== 'complete') throw new Error('Expected completion event');
    expect(complete.result.items).toHaveLength(50);
    expect(analyze).toHaveBeenCalledTimes(50);
  });
  it('rejects requests beyond the file allowance and existing JSON overhead before inference', async () => {
    const analyze = vi.fn(mockAnalyze);
    const response = await createApi(analyze).request(
      '/api/batch',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: ' '.repeat(LIMITS.maxCsvBytes + 16384 + 1),
      },
      env,
    );
    expect(response.status).toBe(413);
    expect(analyze).not.toHaveBeenCalled();
  });
  it('streams bounded batch progress, partial failures, and actual aggregates', async () => {
    const app = createApi(async (review, options) => {
      if (review.reviewId === 'bad')
        throw new JevError('UPSTREAM_ERROR', 'Jev is temporarily unavailable.', 502);
      return makeResult(review, options.requestId);
    });
    const reviews = ['good', 'bad'].map((reviewId) => ({
      reviewId,
      product: 'Phone',
      reviewText: 'Fine battery',
    }));
    const response = await app.request('/api/batch', post({ reviews }), env);
    expect(response.headers.get('content-type')).toBe('application/x-ndjson');
    const events: BatchEvent[] = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as BatchEvent);
    expect(events[0].type).toBe('start');
    const complete = events.find((event) => event.type === 'complete');
    expect(complete?.type).toBe('complete');
    if (complete?.type !== 'complete') throw new Error('Expected completion event');
    expect(complete.result.aggregate.successful).toBe(1);
    expect(complete.result.aggregate.failed).toBe(1);
    expect(complete.result.aggregate.totalDecisions).toBe(19);
  });
  it('measures a small benchmark without fabricating a baseline', async () => {
    const response = await createApi(mockAnalyze).request(
      '/api/benchmark',
      post({ exampleIds: ['mixed', 'absent'] }),
      env,
    );
    expect(response.status).toBe(200);
    const run: BenchmarkRun = await response.json();
    expect(run.measurements).toHaveLength(2);
    expect(run.measurements.every((measurement) => measurement.schemaValid)).toBe(true);
    expect(run.baseline.status).toBe('not_configured');
    expect(run.measurements[0].latencyMs).toBe(120);
  });
  it('rejects unknown or excessive benchmark requests', async () => {
    const app = createApi(mockAnalyze);
    expect(
      (await app.request('/api/benchmark', post({ exampleIds: ['invented'] }), env)).status,
    ).toBe(400);
    expect(
      (await app.request('/api/benchmark', post({ exampleIds: ['mixed', 'mixed'] }), env)).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          '/api/benchmark',
          post({ exampleIds: ['positive', 'battery', 'mixed', 'absent', 'multiple', 'ambiguous'] }),
          env,
        )
      ).status,
    ).toBe(400);
  });
});
