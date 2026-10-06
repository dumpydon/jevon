import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker';
import { activateWarmLease, WARM_KEY, type WorkerEnv } from '../worker/warm';

const at = (time: string) => Date.parse(`2026-10-06T${time}:00Z`);
function environment(value: string | null = null): WorkerEnv {
  return {
    JEVON_STATE: { get: vi.fn(async () => value), put: vi.fn(async () => {}) },
    ASSETS: { fetch: vi.fn(async () => new Response('frontend')) },
    VITE_API_BASE_URL: 'https://api.example.test/',
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}')),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fixed global warm lease', () => {
  it('creates 10:00 → 13:00 when there is no lease', async () => {
    const env = environment();
    expect(await activateWarmLease(env, at('10:00'))).toBe(at('13:00'));
    expect(env.JEVON_STATE.put).toHaveBeenCalledExactlyOnceWith(WARM_KEY, String(at('13:00')));
  });

  it.each(['11:00', '12:00', '12:59'])(
    'does not extend the active 13:00 expiry at %s',
    async (time) => {
      const env = environment(String(at('13:00')));
      expect(await activateWarmLease(env, at(time))).toBe(at('13:00'));
      expect(env.JEVON_STATE.put).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['13:00', '16:00'],
    ['13:01', '16:01'],
  ])('renews an expired lease at %s → %s', async (now, expiry) => {
    const env = environment(String(at('13:00')));
    expect(await activateWarmLease(env, at(now))).toBe(at(expiry));
    expect(env.JEVON_STATE.put).toHaveBeenCalledExactlyOnceWith(WARM_KEY, String(at(expiry)));
  });

  it('returns the same expiry for repeat POSTs, without inference or repeated writes', async () => {
    vi.setSystemTime(at('10:00'));
    const env = environment();
    vi.mocked(env.JEVON_STATE.put).mockImplementation(async (_key, value) => {
      vi.mocked(env.JEVON_STATE.get).mockResolvedValue(value);
    });
    const request = new Request('https://jevon.test/api/warm/activate', { method: 'POST' });
    const first = await worker.fetch(request, env);
    vi.setSystemTime(at('12:00'));
    const second = await worker.fetch(request, env);
    expect(await first.json()).toEqual({ warmUntil: at('13:00') });
    expect(await second.json()).toEqual({ warmUntil: at('13:00') });
    expect(second.headers.get('cache-control')).toBe('no-store');
    expect(env.JEVON_STATE.put).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['get', 'put'] as const)('isolates KV %s failure from static assets', async (method) => {
    const env = environment();
    vi.mocked(env.JEVON_STATE[method]).mockRejectedValue(new Error('private failure detail'));
    const response = await worker.fetch(
      new Request('https://jevon.test/api/warm/activate', { method: 'POST' }),
      env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ available: false });
    const assets = await worker.fetch(new Request('https://jevon.test/'), env);
    expect(await assets.text()).toBe('frontend');
  });

  it('rejects GET activation without changing the lease', async () => {
    const env = environment();
    const response = await worker.fetch(new Request('https://jevon.test/api/warm/activate'), env);
    expect(response.status).toBe(405);
    expect(env.JEVON_STATE.get).not.toHaveBeenCalled();
  });
});

describe('scheduled health-only keepalive', () => {
  it('pings health at 12:50 while the lease expires at 13:00', async () => {
    vi.setSystemTime(at('12:50'));
    const env = environment(String(at('13:00')));
    await worker.scheduled({}, env);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('https://api.example.test/api/health', {
      method: 'GET',
      signal: expect.any(AbortSignal),
      redirect: 'manual',
    });
    expect(env.JEVON_STATE.put).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['13:00', '13:10'])('does nothing at/after expiry (%s)', async (time) => {
    vi.setSystemTime(at(time));
    await worker.scheduled({}, environment(String(at('13:00'))));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does nothing without a lease', async () => {
    await worker.scheduled({}, environment());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips gracefully when KV is unavailable', async () => {
    const env = environment();
    vi.mocked(env.JEVON_STATE.get).mockRejectedValue(new Error('KV unavailable'));
    await expect(worker.scheduled({}, env)).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['network', 'http'])('does not retry a %s failure', async (failure) => {
    vi.setSystemTime(at('12:50'));
    const mock = vi.mocked(fetch);
    if (failure === 'network') mock.mockRejectedValue(new Error('network unavailable'));
    else mock.mockResolvedValue(new Response('', { status: 503 }));
    await expect(worker.scheduled({}, environment(String(at('13:00'))))).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a stalled health ping after 8 seconds without retrying', async () => {
    vi.setSystemTime(at('12:50'));
    vi.mocked(fetch).mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
            once: true,
          });
        }),
    );
    const scheduled = worker.scheduled({}, environment(String(at('13:00'))));
    await vi.advanceTimersByTimeAsync(8_000);
    await expect(scheduled).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
