interface Env {
  DICTIONARY_KV?: KVNamespace;
}

const KV_KEY = 'shared_dictionary_terms';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!env.DICTIONARY_KV) {
    return Response.json({ error: 'DICTIONARY_KV not configured' }, { status: 500, headers: corsHeaders });
  }

  if (request.method === 'GET') {
    const stored = await env.DICTIONARY_KV.get(KV_KEY, 'json');
    return Response.json({ terms: stored ?? null }, { headers: corsHeaders });
  }

  if (request.method === 'POST') {
    const { terms } = await request.json() as { terms?: unknown };
    if (!Array.isArray(terms)) {
      return Response.json({ error: 'terms must be an array' }, { status: 400, headers: corsHeaders });
    }
    await env.DICTIONARY_KV.put(KV_KEY, JSON.stringify(terms));
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
}
