interface Env {
  OPENAI_API_KEY?: string;
}

interface FlowNode {
  id: string;
  type: 'title' | 'fact' | 'insight';
  content: string;
  topicId: string;
}

interface Topic {
  title: string;
  facts: string[];
  insights: string[];
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const openaiApiKey = context.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const body = await context.request.json() as {
    text: string;
    informationLevel?: string;
    textDensity?: string;
    systemPrompt: string;
  };

  const { text, informationLevel = 'high', textDensity = 'high', systemPrompt } = body;

  if (!text || !systemPrompt) {
    return Response.json({ error: 'text and systemPrompt are required' }, { status: 400 });
  }

  const densityLimits: Record<string, number> = { high: 80, medium: 56, low: 32 };
  const densityLimit = densityLimits[textDensity] ?? 80;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `トピック量レベル: ${informationLevel}\nfacts・insights の1項目あたり文字数上限: ${densityLimit}文字（厳守）\n\n以下のテキストを分析してください：\n\n${text}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    return Response.json({ error: `OpenAI error: ${res.status} ${res.statusText}` }, { status: 502 });
  }

  const result = await res.json() as { choices: Array<{ message: { content: string } }> };
  const content = result.choices[0].message.content;

  let parsed: { topics: Topic[] } | undefined;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }

  if (!parsed?.topics) {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  const nodes: FlowNode[] = [];
  let counter = Date.now();
  parsed.topics.forEach((topic, i) => {
    if (!topic.title || !Array.isArray(topic.facts) || !Array.isArray(topic.insights)) return;
    const topicId = `topic-${counter}-${i}`;
    nodes.push({ id: `node-${counter++}-title`, type: 'title', content: topic.title, topicId });
    topic.facts.forEach((f, j) => nodes.push({ id: `node-${counter++}-fact-${j}`, type: 'fact', content: f, topicId }));
    topic.insights.forEach((ins, j) => nodes.push({ id: `node-${counter++}-insight-${j}`, type: 'insight', content: ins, topicId }));
  });

  return Response.json({ nodes });
}
