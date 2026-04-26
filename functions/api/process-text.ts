interface Env {
  OPENAI_API_KEY?: string;
}

// Pure OpenAI proxy — all business logic lives in the client (api.ts)
export async function onRequestPost(context: { request: Request; env: Env }) {
  const openaiApiKey = context.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const { messages, max_tokens = 1000, temperature = 0.2 } = await context.request.json() as {
    messages: object[];
    max_tokens?: number;
    temperature?: number;
  };

  if (!messages?.length) {
    return Response.json({ error: 'messages are required' }, { status: 400 });
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'gpt-4o', messages, temperature, max_tokens }),
  });

  if (!res.ok) {
    return Response.json({ error: `OpenAI error: ${res.status} ${res.statusText}` }, { status: 502 });
  }

  const data = await res.json();
  return Response.json(data);
}
