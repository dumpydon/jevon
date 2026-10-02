import { createApi, type Bindings } from './api';

const app = createApi();
export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) return app.fetch(request, env);
    return env.ASSETS
      ? env.ASSETS.fetch(request)
      : new Response('Static assets unavailable.', { status: 503 });
  },
};
