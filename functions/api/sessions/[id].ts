interface Env {
  DICTIONARY_KV?: KVNamespace;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context: { request: Request; env: Env; params: { id: string } }) {
  const { request, env, params } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.DICTIONARY_KV) {
    return Response.json({ error: 'KV not configured' }, { status: 500, headers: corsHeaders });
  }

  if (request.method === 'DELETE') {
    await env.DICTIONARY_KV.delete(`session:${params.id}`);
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
}
