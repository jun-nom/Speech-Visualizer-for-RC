import { randomUUID } from 'node:crypto';
import type { Plugin } from 'vite';
import type { Rect } from './miro-panels';

type Move = { id: string; viewport: Rect };
type Job = { move: Move; worker: string; delivered: boolean; finish: (error?: string) => void };

export function miroViewportPlugin(boardId?: string): Plugin {
  let worker: { id: string; seen: number } | undefined;
  let job: Job | undefined;
  let waiting: { worker: string; reply: (move?: Move) => void } | undefined;

  return {
    name: 'miro-viewport',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/miro-viewport', async (req, res) => {
        const send = (status: number, body: object) => {
          if (res.writableEnded || res.destroyed) return;
          res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify(body));
        };
        if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') ||
            (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
          return send(403, { error: 'ローカル専用です。' });
        }
        if (req.method !== 'POST' || req.headers['content-type'] !== 'application/json') {
          return send(405, { error: 'POST JSON required' });
        }
        try {
          let body = '';
          for await (const chunk of req) {
            body += String(chunk);
            if (body.length > 4000) return send(413, { error: 'Request too large' });
          }
          const data = JSON.parse(body);
          const connected = worker && Date.now() - worker.seen < 45000;
          if (data.action === 'status') return send(200, { connected: Boolean(connected) });
          if (data.action === 'claim' || data.action === 'poll' || data.action === 'complete') {
            if (!boardId || data.boardId !== boardId || typeof data.worker !== 'string') {
              return send(403, { error: '設定した Miro ボードを開いてください。' });
            }
            if (data.action === 'claim') {
              if (worker?.id !== data.worker) {
                job?.finish('別の Miro タブに接続が切り替わりました。');
                waiting?.reply();
              }
              worker = { id: data.worker, seen: Date.now() };
              return send(200, {});
            }
            if (worker && worker.id !== data.worker) {
              return send(409, { error: '同じ Miro ボードの別タブが接続中です。' });
            }
            worker = { id: data.worker, seen: Date.now() };
            if (data.action === 'complete') {
              if (job?.move.id === data.id && job.worker === worker.id) job.finish(data.error);
              return send(200, {});
            }
            if (job?.worker === worker.id) {
              job.delivered = true;
              return send(200, { move: job.move });
            }
            if (data.wait !== true) return send(200, {});
            waiting?.reply();
            const timer = setTimeout(() => reply(), 20000);
            const reply = (move?: Move) => {
              clearTimeout(timer);
              if (waiting?.reply === reply) waiting = undefined;
              send(200, move ? { move } : {});
            };
            res.once('close', () => {
              clearTimeout(timer);
              if (waiting?.reply === reply) waiting = undefined;
            });
            waiting = { worker: worker.id, reply };
            return;
          }
          if (data.action !== 'move') return send(400, { error: 'Unknown action' });
          if (!connected || !worker) return send(503, { error: '対象の Miro タブで Speech Visualizer アプリを開いてください。' });
          if (job) return send(409, { error: 'Miro の画面移動が進行中です。' });
          const viewport = data.viewport as Rect | undefined;
          if (!viewport || ![viewport.x, viewport.y, viewport.width, viewport.height].every(Number.isFinite) ||
              viewport.width <= 0 || viewport.height <= 0) return send(400, { error: '画面の座標が不正です。' });
          const timer = setTimeout(() => job?.finish(job.delivered
            ? 'Miro は移動指示を受け取りましたが、画面の移動完了を確認できませんでした。'
            : 'Miro のタブが移動指示を受け取れませんでした。'), 30000);
          job = { move: { id: randomUUID(), viewport }, worker: worker.id, delivered: false, finish: error => {
            clearTimeout(timer);
            job = undefined;
            send(error ? 502 : 200, error ? { error } : {});
          } };
          if (waiting?.worker === worker.id) {
            job.delivered = true;
            waiting.reply(job.move);
          }
        } catch {
          send(400, { error: '画面操作のリクエストを読み取れませんでした。' });
        }
      });
    },
  };
}
