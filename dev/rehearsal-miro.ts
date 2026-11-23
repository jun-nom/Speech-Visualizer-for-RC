import type { Plugin } from 'vite';
import { createMiroHandler } from './miro-live-handler';

export function rehearsalMiroPlugin(env: Record<string, string>): Plugin {
  const handle = createMiroHandler(env.MIRO_ACCESS_TOKEN);
  return {
    name: 'rehearsal-miro-local',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/rehearsal-miro', async (req, res) => {
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ローカル専用です。' }));
          return;
        }
        let body: string | undefined;
        if (req.method === 'PUT') {
          body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 48000) {
              res.writeHead(413, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: '編集案が大きすぎます。' }));
              return;
            }
          }
        }
        const response = await handle(new Request(new URL(req.url || '/', 'http://localhost'), { method: req.method, body }));
        res.writeHead(response.status, { 'Content-Type': 'application/json' });
        res.end(await response.text());
      });
    },
  };
}
