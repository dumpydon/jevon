export const WARM_KEY = 'render_warm_until';
export const WARM_WINDOW_MS = 3 * 60 * 60 * 1000;
const HEALTH_TIMEOUT_MS = 8_000;

export interface WorkerEnv {
  JEVON_STATE: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
  ASSETS: { fetch(request: Request): Promise<Response> };
  VITE_API_BASE_URL: string;
}

async function readExpiry(env: WorkerEnv): Promise<number> {
  const value = Number(await env.JEVON_STATE.get(WARM_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function activateWarmLease(env: WorkerEnv, now = Date.now()): Promise<number> {
  const existing = await readExpiry(env);
  if (existing > now) return existing;
  const expiry = now + WARM_WINDOW_MS;
  await env.JEVON_STATE.put(WARM_KEY, String(expiry));
  return expiry;
}

export async function keepRenderWarm(env: WorkerEnv): Promise<void> {
  try {
    if ((await readExpiry(env)) <= Date.now()) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const url = `${env.VITE_API_BASE_URL.replace(/\/+$/, '')}/api/health`;
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'manual',
      });
      await response.body?.cancel();
      if (!response.ok) console.warn('Render keepalive health request failed:', response.status);
      else console.info('Render keepalive health request succeeded');
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Keepalive is optional: never leak configuration or retry within this invocation.
    console.warn('Render keepalive unavailable; skipping until the next scheduled invocation');
  }
}
