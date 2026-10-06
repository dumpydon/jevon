import { activateWarmLease, keepRenderWarm, type WorkerEnv } from './warm';

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    if (new URL(request.url).pathname !== '/api/warm/activate') return env.ASSETS.fetch(request);
    const headers = { 'Cache-Control': 'no-store' };
    if (request.method !== 'POST')
      return new Response('Method not allowed', {
        status: 405,
        headers: { ...headers, Allow: 'POST' },
      });
    try {
      const warmUntil = await activateWarmLease(env);
      return Response.json({ warmUntil }, { headers });
    } catch {
      console.warn('Warm lease unavailable; normal backend requests are unaffected');
      return Response.json({ available: false }, { status: 503, headers });
    }
  },
  async scheduled(_event: unknown, env: WorkerEnv): Promise<void> {
    await keepRenderWarm(env);
  },
};
