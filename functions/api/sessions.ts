interface Env {
  DICTIONARY_KV?: KVNamespace;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.DICTIONARY_KV) {
    return Response.json({ error: 'KV not configured' }, { status: 500, headers: corsHeaders });
  }

  if (request.method === 'GET') {
    const list = await env.DICTIONARY_KV.list({ prefix: 'session:' });
    const sessions = await Promise.all(
      list.keys.map(k => (env.DICTIONARY_KV as KVNamespace).get(k.name, 'json'))
    );
    return Response.json(sessions.filter(Boolean), { headers: corsHeaders });
  }

  if (request.method === 'POST') {
    const session = await request.json() as { id?: string };
    if (!session?.id) {
      return Response.json({ error: 'session.id is required' }, { status: 400, headers: corsHeaders });
    }
    await env.DICTIONARY_KV.put(`session:${session.id}`, JSON.stringify(session));
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
}
