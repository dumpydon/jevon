import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { evaluateFixture } from '../src/lib/benchmark';
import { LIMITS } from '../src/lib/config';
import { CsvValidationError, parseReviewCsv } from '../src/lib/csv';
import { EVALUATION_EXAMPLES } from '../src/lib/fixtures';
import {
  ASPECTS,
  type AnalysisResult,
  type ApiError,
  type BatchEvent,
  type EvaluationExample,
  type ReviewInput,
} from '../src/lib/types';
import { processBatch } from '../src/server/batch';

function review(index: number): ReviewInput {
  return {
    reviewId: `test-${index}`,
    product: 'Test phone',
    reviewText: 'The battery lasts all day.',
  };
}

// Keep review text valid while testing the file's UTF-8 byte boundary independently.
function csvAtBytes(bytes: number): string {
  const prefix = 'text,extra\nGood,';
  const padding = bytes - new TextEncoder().encode(prefix).byteLength;
  return prefix + 'é'.repeat(Math.floor(padding / 2)) + 'x'.repeat(padding % 2);
}

function analysis(input: ReviewInput, requestId = 'test-request'): AnalysisResult {
  return {
    requestId,
    review: input,
    model: 'test-model',
    source: 'jev',
    analyzedAt: '2026-10-02T00:00:00.000Z',
    durationMs: 10,
    decisionCount: 19,
    usage: { inputTokens: 0, outputTokens: 0 },
    aspects: ASPECTS.map((aspect) => ({
      id: aspect.id,
      label: aspect.label,
      mentionProbability: aspect.id === 'battery' ? 0.9 : 0.1,
      mentioned: aspect.id === 'battery',
      rating: aspect.id === 'battery' ? 4 : null,
      satisfactionLabel: aspect.id === 'battery' ? 'Satisfied' : null,
      confidence: aspect.id === 'battery' ? 0.9 : null,
    })),
    signal: {
      sentiment: 'positive',
      sentimentConfidence: 0.9,
      primaryTopic: 'battery',
      topicConfidence: 0.9,
      urgency: 0,
      urgencyConfidence: 0.9,
      churnRisk: 0,
      churnConfidence: 0.9,
      escalationProbability: 0.1,
    },
    actions: [],
    traces: [],
  };
}

describe('CSV validation', () => {
  it('reads canonical columns with quoted commas, quotes and multiline text', () => {
    expect(
      parseReviewCsv(
        'review_id,product,overall_rating,review_text\r\nA,Phone,4.5,"Great camera, and a ""clear"" screen.\nLasts all day."\r\n',
      ),
    ).toEqual([
      {
        reviewId: 'A',
        product: 'Phone',
        overallRating: 4.5,
        reviewText: 'Great camera, and a "clear" screen.\nLasts all day.',
      },
    ]);
  });

  it('normalizes BOM, case and whitespace, accepts aliases and omits blank optional ratings', () => {
    expect(
      parseReviewCsv('\uFEFF ID , Product Name , RATING , TEXT \n A , Phone , , Good battery \n'),
    ).toEqual([{ reviewId: 'A', product: 'Phone', reviewText: 'Good battery' }]);
    expect(parseReviewCsv('review\nWorks well')).toEqual([
      { reviewId: 'RV-001', product: 'Unspecified product', reviewText: 'Works well' },
    ]);
  });

  it('rejects duplicate normalized headers and aliases of the same field', () => {
    expect(() => parseReviewCsv('text,TEXT\nGood,Good')).toThrow(/duplicate/i);
    expect(() => parseReviewCsv('review_id,id,text\nA,B,Good')).toThrow(/one alias/i);
    expect(() => parseReviewCsv('text,extra,EXTRA\nGood,A,B')).toThrow(/duplicate/i);
  });

  it('rejects missing text columns, empty records and duplicate IDs', () => {
    expect(() => parseReviewCsv('id,product\nA,Phone')).toThrow(/review_text column/);
    expect(() => parseReviewCsv('id,text\nA,  ')).toThrow(/Record 1 is missing review text/);
    expect(() => parseReviewCsv('id,text\nA,Good\nA,Bad')).toThrow(/Record 2.*duplicate review ID/);
    expect(() => parseReviewCsv('id,text\n,Good\nRV-001,Bad')).toThrow(/duplicate review ID/);
  });

  it.each(['0', '6', 'NaN', 'Infinity', '0x5', 'five', '-1', '1e0'])(
    'rejects an invalid rating: %s',
    (rating) => {
      expect(() => parseReviewCsv(`rating,text\n${rating},Good`)).toThrow(/number from 1 to 5/);
    },
  );

  it('rejects malformed quotes and mismatched row widths', () => {
    expect(() => parseReviewCsv('text\n"unfinished')).toThrow(/malformed/i);
    expect(() => parseReviewCsv('id,text\nA,Good,Extra')).toThrow(/Record 1 has 3 columns/);
    expect(() => parseReviewCsv('id,text\nA')).toThrow(/Record 1 has 1 columns/);
  });

  it('rejects empty/header-only files, blank headers and null characters', () => {
    expect(() => parseReviewCsv(' \n')).toThrow(/empty/i);
    expect(() => parseReviewCsv('review_text\n')).toThrow(/at least one review/);
    expect(() => parseReviewCsv(',text\nA,Good')).toThrow(/column names cannot be blank/);
    expect(() => parseReviewCsv('text\nGood\0')).toThrow(/null characters/);
  });

  it.each([1_048_575, 1_048_576])('accepts a valid CSV of %i bytes', (bytes) => {
    const csv = csvAtBytes(bytes);
    expect(new TextEncoder().encode(csv).byteLength).toBe(bytes);
    expect(parseReviewCsv(csv)).toMatchObject([{ reviewText: 'Good' }]);
  });

  it('rejects a CSV one UTF-8 byte above 1 MiB', () => {
    const csv = csvAtBytes(1_048_577);
    expect(new TextEncoder().encode(csv).byteLength).toBe(1_048_577);
    expect(csv.length).toBeLessThan(1_048_576);
    expect(() => parseReviewCsv(csv)).toThrow('CSV files must be 1 MB or smaller.');
  });

  it('accepts all 50 review rows without truncating', () => {
    const csv = `text\n${Array.from({ length: 50 }, (_, index) => `Review ${index}`).join('\n')}`;
    const rows = parseReviewCsv(csv);
    expect(rows).toHaveLength(50);
    expect(rows[49].reviewText).toBe('Review 49');
  });

  it('rejects 51 review rows with the batch limit message', () => {
    const csv = `text\n${Array.from({ length: 51 }, () => 'Good').join('\n')}`;
    expect(() => parseReviewCsv(csv)).toThrow('Jevon supports up to 50 reviews per batch.');
  });

  it('preserves the per-review character limit', () => {
    expect(() => parseReviewCsv(`text\n${'A'.repeat(LIMITS.maxCharacters + 1)}`)).toThrow(
      /8,000 characters/,
    );
    expect(parseReviewCsv(`text\n${'A'.repeat(LIMITS.maxCharacters)}`)[0].reviewText).toHaveLength(
      LIMITS.maxCharacters,
    );
  });

  it('matches server limits for review IDs and product names', () => {
    expect(() => parseReviewCsv(`id,text\n${'I'.repeat(101)},Good`)).toThrow(
      /ID longer than 100 characters/,
    );
    expect(() => parseReviewCsv(`product,text\n${'P'.repeat(201)},Good`)).toThrow(
      /product name longer than 200 characters/,
    );
    expect(
      parseReviewCsv(`id,product,text\n${'I'.repeat(100)},${'P'.repeat(200)},Good`),
    ).toHaveLength(1);
  });

  it('accepts the bundled original fixture CSV', () => {
    const csv = readFileSync(new URL('../public/sample-reviews.csv', import.meta.url), 'utf8');
    const parsed = parseReviewCsv(csv);
    expect(parsed).toHaveLength(5);
    expect(parsed.map((item) => item.reviewText)).toEqual(
      EVALUATION_EXAMPLES.slice(0, 5).map((item) => item.text),
    );
  });

  it('provides a status-coded safe error for API callers', () => {
    try {
      parseReviewCsv('');
      throw new Error('Expected CSV validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(CsvValidationError);
      expect(error).toMatchObject({ code: 'INVALID_CSV', status: 400 });
    }
  });
});

describe('bounded batch processing', () => {
  it('processes 50 reviews with at most two simultaneous analyses', async () => {
    let active = 0;
    let maxActive = 0;
    const inputs = Array.from({ length: 50 }, (_, index) => review(index));
    const analyze = vi.fn(async (input: ReviewInput, options: { requestId: string }) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      active -= 1;
      return analysis(input, options.requestId);
    });
    const result = await processBatch(inputs, analyze);
    expect(maxActive).toBe(2);
    expect(active).toBe(0);
    expect(analyze).toHaveBeenCalledTimes(50);
    expect(result.items.map((item) => item.review.reviewId)).toEqual(
      inputs.map((input) => input.reviewId),
    );
    expect(result.aggregate).toMatchObject({ successful: 50, failed: 0, totalDecisions: 950 });
  });

  it('never has more than two in-flight requests and preserves input order', async () => {
    const releases: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const inputs = Array.from({ length: 5 }, (_, index) => review(index));
    const task = processBatch(
      inputs,
      async (input, options) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return analysis(input, options.requestId);
      },
      { requestId: 'batch' },
    );
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]();
    await vi.waitFor(() => expect(releases).toHaveLength(3));
    releases[2]();
    await vi.waitFor(() => expect(releases).toHaveLength(4));
    releases[0]();
    await vi.waitFor(() => expect(releases).toHaveLength(5));
    releases[3]();
    releases[4]();
    const result = await task;
    expect(maxActive).toBe(2);
    expect(result.items.map((item) => item.review.reviewId)).toEqual(
      inputs.map((input) => input.reviewId),
    );
    expect(result.aggregate).toMatchObject({ successful: 5, failed: 0, totalDecisions: 95 });
    expect(result.items[0]).toMatchObject({ result: { requestId: 'batch.1' } });
  });

  it('continues after a nonfatal partial failure without exposing the thrown message', async () => {
    const events: BatchEvent[] = [];
    const result = await processBatch(
      [review(0), review(1), review(2)],
      async (input) => {
        if (input.reviewId === 'test-1') throw new Error('Sensitive upstream response');
        return analysis(input);
      },
      {
        requestId: 'batch',
        onProgress: (event) => {
          events.push(event);
        },
      },
    );
    expect(result.items.map((item) => item.status)).toEqual(['success', 'failed', 'success']);
    expect(result.items[1]).toMatchObject({
      error: { code: 'ANALYSIS_FAILED', requestId: 'batch.2' },
    });
    expect(JSON.stringify(result)).not.toContain('Sensitive upstream response');
    expect(result.aggregate).toMatchObject({ successful: 2, failed: 1, totalDecisions: 38 });
    expect(events.map((event) => event.type)).toEqual([
      'start',
      'progress',
      'progress',
      'progress',
      'complete',
    ]);
  });

  it.each([
    'NOT_CONFIGURED',
    'INVALID_API_KEY',
    'ACCESS_DENIED',
    'INSUFFICIENT_BALANCE',
    'RATE_LIMIT',
  ])('stops scheduling after a fatal %s failure', async (code) => {
    const analyze = vi.fn(async (input: ReviewInput) => {
      if (input.reviewId === 'test-0') throw new Error('Fatal provider response');
      return analysis(input);
    });
    const safe: ApiError = { code, message: 'A safe provider error.' };
    const result = await processBatch(
      Array.from({ length: 6 }, (_, index) => review(index)),
      analyze,
      {
        requestId: 'fatal',
        toApiError: (_error, requestId) => ({ ...safe, requestId }),
      },
    );
    expect(analyze).toHaveBeenCalledTimes(2);
    expect(result.items).toHaveLength(6);
    expect(result.cancelled).toBe(false);
    expect(result.aggregate).toMatchObject({ successful: 1, failed: 5 });
    expect(result.items[5]).toMatchObject({ error: { code, requestId: 'fatal.6' } });
  });

  it('serializes asynchronous progress callbacks and awaits completion delivery', async () => {
    const completed: number[] = [];
    let callbacksRunning = 0;
    let maxCallbacks = 0;
    const result = await processBatch([review(0), review(1)], async (input) => analysis(input), {
      onProgress: async (event) => {
        callbacksRunning += 1;
        maxCallbacks = Math.max(maxCallbacks, callbacksRunning);
        await Promise.resolve();
        if (event.type === 'progress') completed.push(event.completed);
        callbacksRunning -= 1;
      },
    });
    expect(result.aggregate.successful).toBe(2);
    expect(completed).toEqual([1, 2]);
    expect(maxCallbacks).toBe(1);
    expect(callbacksRunning).toBe(0);
  });

  it('cooperatively cancels outstanding work while retaining completed analysis', async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const result = await processBatch(
      [review(0), review(1), review(2), review(3)],
      async (input, options) => {
        started.push(input.reviewId);
        if (input.reviewId === 'test-0') return analysis(input);
        await new Promise<void>((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('Aborted')), {
            once: true,
          });
        });
        return analysis(input);
      },
      {
        signal: controller.signal,
        onProgress: (event) => {
          if (event.type === 'progress') controller.abort();
        },
      },
    );
    expect(started).toEqual(['test-0', 'test-1']);
    expect(result.cancelled).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ status: 'success', review: { reviewId: 'test-0' } });
    expect(result.aggregate).toMatchObject({ successful: 1, failed: 0 });
  });

  it('does not start analysis when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const analyze = vi.fn(async (input: ReviewInput) => analysis(input));
    const result = await processBatch([review(0)], analyze, { signal: controller.signal });
    expect(analyze).not.toHaveBeenCalled();
    expect(result).toMatchObject({ items: [], cancelled: true });
  });

  it('handles an empty batch without model calls', async () => {
    const analyze = vi.fn(async (input: ReviewInput) => analysis(input));
    const result = await processBatch([], analyze);
    expect(analyze).not.toHaveBeenCalled();
    expect(result.aggregate).toMatchObject({ successful: 0, failed: 0, totalDecisions: 0 });
    expect(result.items).toEqual([]);
  });
});

describe('fixture agreement', () => {
  it('counts only explicitly specified assertions, including false mentions', () => {
    const example: EvaluationExample = {
      id: 'test',
      name: 'Battery',
      text: 'Good battery',
      expected: {
        sentiment: 'positive',
        topic: 'battery',
        mentioned: { battery: true, camera: false },
      },
    };
    expect(evaluateFixture(example, analysis(review(0)))).toEqual({ agreements: 4, assertions: 4 });
  });

  it('reports disagreements without inventing expectations for unspecified fields', () => {
    const example: EvaluationExample = {
      id: 'test',
      name: 'Battery',
      text: 'Good battery',
      expected: { sentiment: 'negative', mentioned: { camera: true } },
    };
    expect(evaluateFixture(example, analysis(review(0)))).toEqual({ agreements: 0, assertions: 2 });
  });

  it('does not treat a missing aspect decision as an expected negative', () => {
    const result = analysis(review(0));
    result.aspects = [];
    expect(
      evaluateFixture(
        {
          id: 'test',
          name: 'No camera',
          text: 'Packaging',
          expected: { mentioned: { camera: false } },
        },
        result,
      ),
    ).toEqual({ agreements: 0, assertions: 1 });
  });

  it('handles a fixture with no expectations honestly', () => {
    expect(
      evaluateFixture(
        { id: 'test', name: 'No assertions', text: 'Hello', expected: {} },
        analysis(review(0)),
      ),
    ).toEqual({ agreements: 0, assertions: 0 });
  });
});
