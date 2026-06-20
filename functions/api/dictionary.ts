interface Env {
  DICTIONARY_KV?: KVNamespace;
}

interface StoredEntry {
  term: string;
  reading: string;
}

const KV_KEY = 'shared_dictionary_terms';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

function normalizeStored(data: unknown): StoredEntry[] | null {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] === 'object' && data[0] !== null) {
    const entries = data.filter(
      (e): e is StoredEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as StoredEntry).term === 'string' &&
        (e as StoredEntry).term.trim() !== '',
    );
    return entries.length > 0 ? entries : null;
  }
  if (typeof data[0] === 'string') {
    const terms = data.filter((t): t is string => typeof t === 'string' && t.trim() !== '');
    return terms.length > 0 ? terms.map(t => ({ term: t, reading: '' })) : null;
  }
  return null;
}

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
    const entries = normalizeStored(stored);
    return Response.json({ entries: entries ?? null }, { headers: corsHeaders });
  }

  if (request.method === 'POST') {
    const body = await request.json() as Record<string, unknown>;
    const raw = 'entries' in body ? body.entries : body.terms;
    if (!Array.isArray(raw)) {
      return Response.json({ error: 'entries must be an array' }, { status: 400, headers: corsHeaders });
    }
    const entries = normalizeStored(raw);
    await env.DICTIONARY_KV.put(KV_KEY, JSON.stringify(entries ?? []));
    return Response.json({ success: true }, { headers: corsHeaders });
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
}
