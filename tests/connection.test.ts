import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from '../src/lib/browser';
import type { HealthStatus } from '../src/lib/types';

vi.mock('../src/lib/browser', () => ({ getHealth: vi.fn() }));
const health: HealthStatus = {
  status: 'ok',
  jevConfigured: true,
  model: 'test',
  decisionCount: 19,
  limits: { maxReviews: 50, concurrency: 2, maxCharacters: 8000 },
  baselineConfigured: false,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(getHealth).mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('bounded cold-start health polling', () => {
  it('stops immediately on healthy response', async () => {
    vi.mocked(getHealth).mockResolvedValue(health);
    const { waitForHealth } = await import('../src/lib/connection');
    expect(await waitForHealth(new AbortController().signal)).toEqual(health);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries serially after 3 seconds, then stops on recovery', async () => {
    vi.mocked(getHealth).mockRejectedValueOnce(new Error('cold')).mockResolvedValue(health);
    const { waitForHealth } = await import('../src/lib/connection');
    const pending = waitForHealth(new AbortController().signal);
    await vi.advanceTimersByTimeAsync(2_999);
    expect(getHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(health);
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops at the 60-second deadline instead of waking forever', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('offline'));
    const { waitForHealth } = await import('../src/lib/connection');
    const result = waitForHealth(new AbortController().signal).catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await result).toMatchObject({ message: 'Backend connection timed out' });
    const count = vi.mocked(getHealth).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getHealth).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stalled attempts to 10 seconds and never overlaps health requests', async () => {
    let active = 0;
    let maximum = 0;
    vi.mocked(getHealth).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          maximum = Math.max(maximum, ++active);
          signal?.addEventListener(
            'abort',
            () => {
              active--;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const { waitForHealth } = await import('../src/lib/connection');
    const result = waitForHealth(new AbortController().signal).catch(() => 'timed out');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(active).toBe(0);
    expect(getHealth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(getHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(47_000);
    expect(await result).toBe('timed out');
    expect(maximum).toBe(1);
    expect(active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans up retry timers on unmount', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('cold'));
    const { waitForHealth } = await import('../src/lib/connection');
    const controller = new AbortController();
    const result = waitForHealth(controller.signal).catch(() => 'cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    expect(await result).toBe('cancelled');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts in-flight health on unmount and does not start if already cancelled', async () => {
    vi.mocked(getHealth).mockImplementation(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const { waitForHealth } = await import('../src/lib/connection');
    const controller = new AbortController();
    const result = waitForHealth(controller.signal).catch(() => 'cancelled');
    controller.abort();
    expect(await result).toBe('cancelled');
    await expect(waitForHealth(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports missing configuration without continuing to poll', async () => {
    vi.mocked(getHealth).mockResolvedValue({ ...health, jevConfigured: false });
    const { waitForHealth } = await import('../src/lib/connection');
    expect((await waitForHealth(new AbortController().signal)).jevConfigured).toBe(false);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('best-effort bootstrap activation', () => {
  it.each(['network', 'http'])(
    'activates once despite duplicate bootstrap calls and %s failure',
    async (failure) => {
      const fetchMock = vi.fn<typeof fetch>();
      if (failure === 'network') fetchMock.mockRejectedValue(new Error('KV unavailable'));
      else fetchMock.mockResolvedValue(new Response('{}', { status: 503 }));
      vi.stubGlobal('fetch', fetchMock);
      const { activateWarmWindow } = await import('../src/lib/connection');
      await expect(Promise.all([activateWarmWindow(), activateWarmWindow()])).resolves.toEqual([
        undefined,
        undefined,
      ]);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/warm/activate',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('bounds activation to 5 seconds independently of health', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener('abort', () => reject(new Error('timeout')), {
              once: true,
            });
          }),
      ),
    );
    vi.mocked(getHealth).mockResolvedValue(health);
    const { activateWarmWindow, waitForHealth } = await import('../src/lib/connection');
    const activation = activateWarmWindow();
    expect(await waitForHealth(new AbortController().signal)).toEqual(health);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(activation).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
});
