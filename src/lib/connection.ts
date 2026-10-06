import { getHealth } from './browser';
import type { HealthStatus } from './types';

const CONNECTION_TIMEOUT_MS = 60_000;
const ATTEMPT_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 3_000;
let activation: Promise<void> | undefined;

// Once per document bootstrap, including React's development StrictMode effect replay.
// This same-origin request deliberately bypasses the Render API base URL.
export function activateWarmWindow(): Promise<void> {
  activation ??= (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      await fetch('/api/warm/activate', { method: 'POST', signal: controller.signal });
    } catch {
      // KV/activation failure must never block normal backend access.
    } finally {
      clearTimeout(timeout);
    }
  })();
  return activation;
}

function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, RETRY_DELAY_MS);
    const abort = () => {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

export async function waitForHealth(signal: AbortSignal): Promise<HealthStatus> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const deadline = setTimeout(
    () => controller.abort(new Error('Backend connection timed out')),
    CONNECTION_TIMEOUT_MS,
  );
  try {
    while (!controller.signal.aborted) {
      const attempt = new AbortController();
      const cancelAttempt = () => attempt.abort(controller.signal.reason);
      controller.signal.addEventListener('abort', cancelAttempt, { once: true });
      const timeout = setTimeout(() => attempt.abort(), ATTEMPT_TIMEOUT_MS);
      try {
        const health = await getHealth(attempt.signal);
        if (controller.signal.aborted) throw controller.signal.reason;
        return health;
      } catch {
        if (controller.signal.aborted) throw controller.signal.reason;
      } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', cancelAttempt);
      }
      await pause(controller.signal);
    }
    throw controller.signal.reason;
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
  }
}
