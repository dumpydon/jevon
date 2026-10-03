import { afterEach, describe, expect, it, vi } from 'vitest';
import contract from '../backend/tests/fixtures/legacy.json';
import type { AnalysisResult, BatchAggregate, BatchEvent, ReviewInput } from '../src/lib/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('frontend API contract', () => {
  it.each(['', 'https://api.example.test/'])(
    'uses the configured public API base: %s',
    async (base) => {
      vi.stubEnv('VITE_API_BASE_URL', base);
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const { getHealth, analyzeReview, runBenchmark } = await import('../src/lib/browser');
      const signal = new AbortController().signal;
      await getHealth(signal);
      await analyzeReview('Good battery', signal);
      await runBenchmark(['absent'], signal);
      const prefix = base.replace(/\/+$/, '');
      expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
        `${prefix}/api/health`,
        `${prefix}/api/analyze`,
        `${prefix}/api/benchmark`,
      ]);
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        `${prefix}/api/analyze`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ reviewText: 'Good battery' }),
          signal,
        }),
      );
    },
  );

  it('reads NDJSON progress across chunk boundaries and retains camelCase results', async () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test');
    const review: ReviewInput = contract.cases[0].review;
    const events: BatchEvent[] = [
      { type: 'start', total: 1, requestId: 'test' },
      {
        type: 'progress',
        completed: 1,
        total: 1,
        item: { review, status: 'success', result: contract.cases[0].expected as AnalysisResult },
      },
      {
        type: 'complete',
        result: {
          requestId: 'test',
          items: [],
          aggregate: contract.aggregate as BatchAggregate,
          durationMs: 120,
          cancelled: false,
        },
      },
    ];
    const wire = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < wire.length; index += 23)
          controller.enqueue(new TextEncoder().encode(wire.slice(index, index + 23)));
        controller.close();
      },
    });
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(stream));
    vi.stubGlobal('fetch', fetchMock);
    const { analyzeBatch } = await import('../src/lib/browser');
    const received: BatchEvent[] = [];
    const signal = new AbortController().signal;
    await analyzeBatch([review], (event) => received.push(event), signal);
    expect(received).toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/batch',
      expect.objectContaining({ signal, body: JSON.stringify({ reviews: [review] }) }),
    );
  });

  it('preserves safe Python errors and request IDs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: 'INSUFFICIENT_BALANCE', message: 'Add credit.', requestId: 'id' },
            }),
            { status: 503 },
          ),
      ),
    );
    const { analyzeReview, safeError } = await import('../src/lib/browser');
    try {
      await analyzeReview('Good');
      throw new Error('Expected request failure');
    } catch (error) {
      expect(safeError(error)).toEqual({ message: 'Add credit.', requestId: 'id' });
    }
  });
});
