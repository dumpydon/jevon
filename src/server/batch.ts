import { LIMITS } from '../lib/config';
import { aggregateResults } from '../lib/decisions/aggregation';
import type {
  AnalysisResult,
  ApiError,
  BatchEvent,
  BatchItem,
  BatchResult,
  ReviewInput,
} from '../lib/types';

export interface BatchAnalysisOptions {
  signal?: AbortSignal;
  requestId: string;
}
export type BatchAnalyzeFn = (
  review: ReviewInput,
  options: BatchAnalysisOptions,
) => Promise<AnalysisResult>;
export interface BatchOptions {
  signal?: AbortSignal;
  requestId?: string;
  onProgress?: (event: BatchEvent) => void | Promise<void>;
  toApiError?: (error: unknown, requestId: string) => ApiError;
}

const FATAL_CODES = new Set([
  'NOT_CONFIGURED',
  'MISSING_CONFIGURATION',
  'INVALID_API_KEY',
  'UNAUTHORIZED',
  'ACCESS_DENIED',
  'INSUFFICIENT_BALANCE',
  'RATE_LIMIT',
  'RATE_LIMITED',
]);

/** Workers take the next item only after their current result and progress event finish. */
export async function processBatch(
  reviews: ReviewInput[],
  analyzeFn: BatchAnalyzeFn,
  options: BatchOptions = {},
): Promise<BatchResult> {
  const startedAt = performance.now();
  const requestId = options.requestId ?? crypto.randomUUID();
  const items: Array<BatchItem | undefined> = Array.from({ length: reviews.length });
  let nextIndex = 0;
  let completed = 0;
  let fatalError: ApiError | undefined;
  let progressQueue = Promise.resolve();

  // Multiple workers share a serialized callback, including asynchronous stream writes.
  const emit = (event: BatchEvent): Promise<void> => {
    progressQueue = progressQueue.then(() => options.onProgress?.(event));
    return progressQueue;
  };
  const itemRequestId = (index: number): string => `${requestId}.${index + 1}`;
  const mapError = (error: unknown, id: string): ApiError =>
    options.toApiError?.(error, id) ?? {
      code: 'ANALYSIS_FAILED',
      message: 'This review could not be analyzed. Please try again.',
      requestId: id,
    };

  await emit({ type: 'start', total: reviews.length, requestId });
  const worker = async (): Promise<void> => {
    while (!options.signal?.aborted && !fatalError) {
      const index = nextIndex++;
      if (index >= reviews.length) return;
      const review = reviews[index];
      let item: BatchItem;
      try {
        const result = await analyzeFn(review, {
          signal: options.signal,
          requestId: itemRequestId(index),
        });
        item = { review, status: 'success', result };
      } catch (error: unknown) {
        if (options.signal?.aborted) return;
        const safeError = mapError(error, itemRequestId(index));
        item = { review, status: 'failed', error: safeError };
        if (FATAL_CODES.has(safeError.code)) fatalError = safeError;
      }
      items[index] = item;
      completed += 1;
      await emit({ type: 'progress', completed, total: reviews.length, item });
    }
  };

  await Promise.all(Array.from({ length: Math.min(LIMITS.concurrency, reviews.length) }, worker));
  if (fatalError && !options.signal?.aborted) {
    for (let index = 0; index < reviews.length; index += 1) {
      if (items[index]) continue;
      const item: BatchItem = {
        review: reviews[index],
        status: 'failed',
        error: { ...fatalError, requestId: itemRequestId(index) },
      };
      items[index] = item;
      completed += 1;
      await emit({ type: 'progress', completed, total: reviews.length, item });
    }
  }

  const finishedItems = items.filter((item): item is BatchItem => item !== undefined);
  const result: BatchResult = {
    requestId,
    items: finishedItems,
    aggregate: aggregateResults(finishedItems),
    durationMs: Math.round(performance.now() - startedAt),
    cancelled: options.signal?.aborted ?? false,
  };
  await emit({ type: 'complete', result });
  return result;
}
