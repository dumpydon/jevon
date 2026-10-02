import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeWithJev, JevError } from '../src/lib/jev/client';
import { normalizeJevResult } from '../src/lib/jev/normalize';
import { buildQuestions } from '../src/lib/jev/questions';
import { aggregateResults } from '../src/lib/decisions/aggregation';
import { applyRules, mapSatisfactionToRating } from '../src/lib/decisions/rules';
import {
  ASPECTS,
  type BatchItem,
  type OperationalSignal,
  type ReviewInput,
} from '../src/lib/types';
import { makeRawJevFixture as rawResponse, makeScoreFixture as scoreAnswer } from './jev-fixture';

const review: ReviewInput = {
  reviewId: 'test-1',
  product: 'Test phone',
  reviewText: 'Battery is poor, but the camera is excellent.',
};
const metadata = { requestId: 'test-request', durationMs: 123 };

function resultWithBattery(mention: number, satisfaction: number) {
  const raw = rawResponse();
  raw.answers.battery_mentioned = { type: 'noul', noul: mention };
  const definition = buildQuestions().battery_satisfaction;
  if (definition.type !== 'score') throw new Error('Expected a score fixture.');
  raw.answers.battery_satisfaction = scoreAnswer(satisfaction, definition.criteria);
  return normalizeJevResult(raw, review, metadata);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('typed decision schema and normalization', () => {
  it('builds exactly 19 independent questions using official primitives', () => {
    const questions = Object.values(buildQuestions());
    expect(questions).toHaveLength(19);
    expect(questions.filter((item) => item.type === 'noul')).toHaveLength(8);
    expect(questions.filter((item) => item.type === 'score')).toHaveLength(9);
    expect(questions.filter((item) => item.type === 'choice')).toHaveLength(2);
  });

  it('maps 0–4 to 1–5 stars without rounding or clamping invalid values', () => {
    expect(mapSatisfactionToRating(0)).toBe(1);
    expect(mapSatisfactionToRating(4)).toBe(5);
    expect(mapSatisfactionToRating(1.437)).toBeCloseTo(2.437, 8);
    for (const invalid of [-1, 4.1, NaN, Infinity])
      expect(() => mapSatisfactionToRating(invalid)).toThrow(RangeError);
  });

  it('accepts the exact mention threshold and suppresses unsupported ratings', () => {
    const accepted = resultWithBattery(0.5, 1.4);
    const battery = accepted.aspects.find((item) => item.id === 'battery');
    expect(battery?.rating).toBeCloseTo(2.4);
    expect(battery?.mentioned).toBe(true);
    expect(accepted.traces.find((item) => item.id === 'battery_mentioned')).toMatchObject({
      threshold: 0.5,
      accepted: true,
    });
    const absent = resultWithBattery(0.4999, 4);
    expect(absent.aspects.find((item) => item.id === 'battery')).toMatchObject({
      mentioned: false,
      rating: null,
      confidence: null,
      satisfactionLabel: null,
    });
    expect(
      absent.traces.find((item) => item.id === 'battery_satisfaction')?.decision,
    ).toMatchObject({ type: 'score', score: 4 });
    expect(
      absent.traces.find((item) => item.id === 'battery_satisfaction')?.mappedRating,
    ).toBeUndefined();
  });

  it('preserves the real output, usage, distributions, and review in the DTO', () => {
    const raw = rawResponse();
    const result = normalizeJevResult(raw, review, metadata);
    expect(result).toMatchObject({
      requestId: metadata.requestId,
      durationMs: 123,
      source: 'jev',
      decisionCount: 19,
      review,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(result.traces.find((item) => item.id === 'overall_sentiment')?.decision).toEqual(
      raw.answers.overall_sentiment,
    );
    expect(result.traces.find((item) => item.id === 'escalation_need')?.decision).toEqual({
      type: 'noul',
      noul: 0.2,
    });
    expect(result.aspects).toHaveLength(ASPECTS.length);
  });

  it.each([
    [
      'missing question',
      (raw: ReturnType<typeof rawResponse>) => {
        delete raw.answers.camera_mentioned;
      },
    ],
    [
      'unexpected question',
      (raw: ReturnType<typeof rawResponse>) => {
        raw.answers.extra = { type: 'noul', noul: 1 };
      },
    ],
    [
      'wrong type',
      (raw: ReturnType<typeof rawResponse>) => {
        raw.answers.camera_mentioned = {
          type: 'score',
          score: 1,
          confidence: 1,
          legend: { '0': 'A', '1': 'B' },
          probabilities: { '0': 0, '1': 1 },
        };
      },
    ],
    [
      'out of range probability',
      (raw: ReturnType<typeof rawResponse>) => {
        raw.answers.camera_mentioned = { type: 'noul', noul: 1.1 };
      },
    ],
    [
      'nonfinite score',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.urgency;
        if (item.type === 'score') item.score = NaN;
      },
    ],
    [
      'wrong confidence',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.urgency;
        if (item.type === 'score') item.confidence = -0.2;
      },
    ],
    [
      'wrong score range',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.urgency;
        if (item.type === 'score') item.score = 5;
      },
    ],
    [
      'invalid choice',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.primary_topic;
        if (item.type === 'choice') item.choice = 'imaginary';
      },
    ],
    [
      'missing distribution label',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.primary_topic;
        if (item.type === 'choice') delete item.probabilities.other;
      },
    ],
    [
      'unnormalized distribution',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.primary_topic;
        if (item.type === 'choice') item.probabilities.other = 0.2;
      },
    ],
    [
      'choice disagrees with probabilities',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.primary_topic;
        if (item.type === 'choice') item.choice = 'other';
      },
    ],
    [
      'score disagrees with probabilities',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.urgency;
        if (item.type === 'score') item.score = 1;
      },
    ],
    [
      'mismatched legend',
      (raw: ReturnType<typeof rawResponse>) => {
        const item = raw.answers.urgency;
        if (item.type === 'score') item.legend['0'] = 'Unknown rubric';
      },
    ],
    [
      'invalid usage',
      (raw: ReturnType<typeof rawResponse>) => {
        raw.usage.input_tokens = -1;
      },
    ],
  ])('rejects a malformed response: %s', (_, mutate) => {
    const raw = rawResponse();
    mutate(raw);
    expect(() => normalizeJevResult(raw, review, metadata)).toThrow('unexpected decision response');
  });
});

describe('deterministic actions and aggregation', () => {
  const signal: OperationalSignal = {
    sentiment: 'negative',
    sentimentConfidence: 0.8,
    primaryTopic: 'battery',
    topicConfidence: 0.8,
    urgency: 3,
    urgencyConfidence: 0.9,
    churnRisk: 3,
    churnConfidence: 0.7,
    escalationProbability: 0.75,
  };
  it('uses inclusive action thresholds and keeps all action rules inspectable', () => {
    expect(applyRules(signal).every((action) => action.triggered)).toBe(true);
    expect(
      applyRules({
        ...signal,
        urgency: 2.999,
        churnRisk: 2.999,
        escalationProbability: 0.749,
      }).every((action) => !action.triggered),
    ).toBe(true);
    expect(applyRules(signal).find((action) => action.id === 'escalate')).toMatchObject({
      rule: 'escalation_need >= 0.75',
      value: 0.75,
      threshold: 0.75,
    });
  });

  it('aggregates only accepted aspect ratings and successful results', () => {
    const first = resultWithBattery(1, 1.4);
    first.signal = signal;
    const items: BatchItem[] = [
      { review, status: 'success', result: first },
      { review, status: 'success', result: resultWithBattery(1, 3.4) },
      { review, status: 'success', result: resultWithBattery(0.1, 4) },
      { review, status: 'failed', error: { code: 'TIMEOUT', message: 'Timed out.' } },
    ];
    const aggregate = aggregateResults(items);
    expect(aggregate).toMatchObject({
      successful: 3,
      failed: 1,
      totalDecisions: 57,
      highRiskCount: 1,
      escalationCount: 1,
      weakestAspect: 'Battery',
      strongestAspect: 'Battery',
    });
    expect(aggregate.aspects.find((aspect) => aspect.id === 'battery')).toMatchObject({
      mentionCount: 2,
    });
    expect(aggregate.aspects.find((aspect) => aspect.id === 'battery')?.averageRating).toBeCloseTo(
      3.4,
    );
    expect(aggregate.aspects.find((aspect) => aspect.id === 'battery')?.mentionPercent).toBeCloseTo(
      200 / 3,
    );
    expect(aggregate.aspects.find((aspect) => aspect.id === 'camera')).toMatchObject({
      averageRating: null,
      mentionCount: 0,
    });
  });

  it('handles an empty batch without fictitious ratings or percentages', () => {
    const aggregate = aggregateResults([]);
    expect(aggregate).toMatchObject({
      successful: 0,
      failed: 0,
      totalDecisions: 0,
      weakestAspect: null,
      strongestAspect: null,
    });
    expect(
      aggregate.aspects.every(
        (aspect) => aspect.averageRating === null && aspect.mentionPercent === 0,
      ),
    ).toBe(true);
  });
});

describe('server SDK adapter with mocked transport', () => {
  it('calls the official endpoint with the server credential and one shared state', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(rawResponse()));
    const result = await analyzeWithJev(review, {
      apiKey: 'test-only-key',
      requestId: 'adapter-request',
    });
    expect(result.source).toBe('jev');
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-only-key');
    const body: {
      model: string;
      state: { review_text: string };
      questions: Record<string, unknown>;
    } = JSON.parse(String(init?.body));
    expect(body.model).toBe('jev-1.13.0');
    expect(body.state.review_text).toBe(review.reviewText);
    expect(Object.keys(body.questions)).toHaveLength(19);
    expect(JSON.stringify(result)).not.toContain('test-only-key');
  });

  it('rejects missing configuration before attempting a request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    await expect(analyzeWithJev(review, { apiKey: ' ', requestId: 'test' })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
      status: 503,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, 'INVALID_API_KEY'],
    [402, 'INSUFFICIENT_BALANCE'],
    [403, 'ACCESS_DENIED'],
    [429, 'RATE_LIMIT'],
    [422, 'UPSTREAM_VALIDATION'],
  ] as const)('maps HTTP %s safely without retries', async (status, code) => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json(
          { error: 'provider text includes test-only-key and customer data' },
          { status },
        ),
      );
    const error = await analyzeWithJev(review, {
      apiKey: 'test-only-key',
      requestId: 'test',
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(JevError);
    expect(error).toMatchObject({ code, upstreamStatus: status });
    expect((error as JevError).message).not.toContain('test-only-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a transient server response only once', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'temporarily overloaded' }, { status: 529 }))
      .mockResolvedValueOnce(Response.json(rawResponse()));
    await expect(
      analyzeWithJev(review, { apiKey: 'test-only-key', requestId: 'test' }),
    ).resolves.toMatchObject({ source: 'jev' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops after the second transient failure rather than retrying indefinitely', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ error: 'overloaded' }, { status: 529 }));
    await expect(
      analyzeWithJev(review, { apiKey: 'test-only-key', requestId: 'test' }),
    ).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', upstreamStatus: 529, status: 502 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 429])(
    'recognizes insufficient credit on HTTP %s without retries',
    async (status) => {
      const fetch = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          Response.json({ error: { message: 'Insufficient credits' } }, { status }),
        );
      await expect(
        analyzeWithJev(review, { apiKey: 'test-only-key', requestId: 'test' }),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', upstreamStatus: status });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it('does not retry an ambiguous connection failure that may have reached the provider', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new TypeError('connection lost with private provider detail'));
    const error = await analyzeWithJev(review, {
      apiKey: 'test-only-key',
      requestId: 'test',
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'CONNECTION_ERROR', status: 502 });
    expect((error as JevError).message).not.toContain('private provider detail');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('logs only safe request metadata for both successful and failed analysis', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json(rawResponse()))
      .mockResolvedValueOnce(
        Response.json({ error: `secret-key-sentinel ${review.reviewText}` }, { status: 401 }),
      );
    await analyzeWithJev(review, { apiKey: 'secret-key-sentinel', requestId: 'safe-id' });
    await analyzeWithJev(review, { apiKey: 'secret-key-sentinel', requestId: 'safe-id' }).catch(
      () => {},
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    const output = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(output).not.toContain('secret-key-sentinel');
    expect(output).not.toContain(review.reviewText);
    expect(JSON.parse(String(info.mock.calls[0][0]))).toMatchObject({
      event: 'jev.analysis',
      requestId: 'safe-id',
      decisionCount: 19,
      status: 'success',
    });
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({
      event: 'jev.analysis',
      requestId: 'safe-id',
      code: 'INVALID_API_KEY',
      upstreamStatus: 401,
      status: 'failure',
    });
  });

  it('fails malformed successful responses explicitly instead of falling back to fixtures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json({ model: 'jev-1.13.0', answers: {} }),
    );
    await expect(
      analyzeWithJev(review, { apiKey: 'test-only-key', requestId: 'test' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });

  it('maps caller cancellation and does not retry it', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'));
          else
            init?.signal?.addEventListener(
              'abort',
              () => reject(new DOMException('Aborted', 'AbortError')),
              { once: true },
            );
        }),
    );
    const controller = new AbortController();
    const pending = analyzeWithJev(review, {
      apiKey: 'test-only-key',
      requestId: 'test',
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED', status: 408 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('bounds request time and never retries a timed out request', async () => {
    vi.useFakeTimers();
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const pending = analyzeWithJev(review, { apiKey: 'test-only-key', requestId: 'test' });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT', status: 504 });
    await vi.advanceTimersByTimeAsync(20_001);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
