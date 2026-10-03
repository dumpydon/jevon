import type {
  AnalysisResult,
  ApiError,
  BatchEvent,
  BenchmarkRun,
  HealthStatus,
  ReviewInput,
} from './types';

// Only a public backend URL is exposed. Local development uses the Vite /api proxy.
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');
const apiUrl = (path: string) => `${apiBase}${path}`;

export class RequestError extends Error {
  readonly code: string;
  readonly requestId?: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'RequestError';
    this.code = error.code;
    this.requestId = error.requestId;
  }
}

async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let error: ApiError = {
    code: 'REQUEST_FAILED',
    message: 'The request could not be completed. Please try again.',
  };
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const candidate = 'error' in body ? body.error : body;
      if (
        candidate &&
        typeof candidate === 'object' &&
        'message' in candidate &&
        typeof candidate.message === 'string'
      ) {
        error = {
          message: candidate.message,
          code:
            'code' in candidate && typeof candidate.code === 'string'
              ? candidate.code
              : 'REQUEST_FAILED',
          requestId:
            'requestId' in candidate && typeof candidate.requestId === 'string'
              ? candidate.requestId
              : undefined,
        };
      }
    }
  } catch {
    /* A proxy may return a non-JSON error; retain the safe message. */
  }
  throw new RequestError(error);
}

async function request<T>(url: string, data?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: data ? 'POST' : 'GET',
    headers: data ? { 'Content-Type': 'application/json' } : undefined,
    body: data ? JSON.stringify(data) : undefined,
    signal,
  });
  await checkResponse(response);
  return response.json() as Promise<T>;
}

export const getHealth = (signal?: AbortSignal) =>
  request<HealthStatus>('/api/health', undefined, signal);
export const analyzeReview = (reviewText: string, signal?: AbortSignal) =>
  request<AnalysisResult>('/api/analyze', { reviewText }, signal);
export const runBenchmark = (exampleIds: string[], signal?: AbortSignal) =>
  request<BenchmarkRun>('/api/benchmark', { exampleIds }, signal);

export async function analyzeBatch(
  reviews: ReviewInput[],
  onEvent: (event: BatchEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(apiUrl('/api/batch'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviews }),
    signal,
  });
  await checkResponse(response);
  if (!response.body)
    throw new RequestError({
      code: 'STREAM_UNAVAILABLE',
      message: 'The server did not return a progress stream.',
    });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  const deliver = (line: string) => {
    if (!line.trim()) return;
    let event: BatchEvent;
    try {
      event = JSON.parse(line) as BatchEvent;
    } catch {
      throw new RequestError({
        code: 'INVALID_RESPONSE',
        message: 'The server returned an unreadable progress update.',
      });
    }
    if (event.type === 'complete') completed = true;
    if (event.type === 'error') throw new RequestError(event.error);
    onEvent(event);
  };
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(deliver);
    }
    buffer += decoder.decode();
    deliver(buffer);
    if (!completed && !signal.aborted)
      throw new RequestError({
        code: 'STREAM_INTERRUPTED',
        message:
          'The connection ended before the batch completed. Completed reviews have been retained.',
      });
  } finally {
    reader.releaseLock();
  }
}

export function safeError(error: unknown): { message: string; requestId?: string } {
  if (error instanceof RequestError) return { message: error.message, requestId: error.requestId };
  return { message: 'Unable to reach the server. Check your connection and try again.' };
}
