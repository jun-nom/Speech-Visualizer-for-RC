interface Env {
  OPENAI_API_KEY?: string;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequest(context: { request: Request; env: Env }) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  if (!env.OPENAI_API_KEY) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500, headers: corsHeaders });
  }

  const { term } = await request.json() as { term?: unknown };
  if (!term || typeof term !== 'string' || !term.trim()) {
    return Response.json({ error: 'term is required' }, { status: 400, headers: corsHeaders });
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'あなたは日本語の専門家です。与えられた用語のひらがな読みのみを返してください。読み仮名以外の文字は一切含めないでください。アルファベットや記号はそのまま読みに変換してください。例：「MIXI」→「みくしぃ」、「富士通」→「ふじつう」、「GMOメディア」→「じーえむおーめでぃあ」',
        },
        {
          role: 'user',
          content: `次の用語のひらがな読みを返してください：${term.trim()}`,
        },
      ],
      max_tokens: 60,
      temperature: 0,
    }),
  });

  if (!res.ok) {
    return Response.json({ error: `OpenAI error: ${res.status}` }, { status: 502, headers: corsHeaders });
  }

  const data = await res.json() as { choices: Array<{ message: { content: string } }> };
  const reading = data.choices[0]?.message?.content?.trim() ?? '';
  return Response.json({ reading }, { headers: corsHeaders });
}
