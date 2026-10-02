import { config } from 'dotenv';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { getRequestListener } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApi } from './api';

config({ path: '.env.local', quiet: true });
const production = process.argv.includes('--production');
const app = createApi();
if (production) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', serveStatic({ path: './dist/index.html' }));
}
const listener = getRequestListener((request) =>
  app.fetch(request, { TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY }),
);
const vite = production
  ? null
  : await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
const server = createHttpServer((request, response) => {
  if (request.url?.startsWith('/api/') || production) void listener(request, response);
  else vite!.middlewares(request, response);
});
const port = Number(process.env.PORT ?? 3000);
server.listen(port, '127.0.0.1', () =>
  console.info(
    `Jevon ${production ? 'production preview' : 'development'} ready at http://localhost:${port}`,
  ),
);
async function shutdown() {
  await vite?.close();
  server.close(() => process.exit(0));
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
