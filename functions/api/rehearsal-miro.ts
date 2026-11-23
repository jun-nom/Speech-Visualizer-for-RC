import { createMiroHandler } from '../../dev/miro-live-handler';

export async function onRequest({ request }: { request: Request }) {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: '同じサイトから接続してください。' }, { status: 403 });
  }
  const token = /^Bearer (\S+)$/.exec(request.headers.get('Authorization') ?? '')?.[1];
  if (!token) {
    return Response.json({ error: '設定画面に Miro のアクセストークンを入力してください。' }, { status: 401 });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const body = await request.text();
  if (body.length > 96000) return new Response(null, { status: 413 });
  try {
    const { update, tracking } = JSON.parse(body) as { update?: object; tracking?: unknown };
    const response = await createMiroHandler(token)(new Request(request.url, {
      method: update ? 'PUT' : 'GET', body: update && JSON.stringify(update),
    }), tracking, true);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch {
    return Response.json({ error: 'Miro への接続要求を処理できませんでした。' }, { status: 400 });
  }
}
