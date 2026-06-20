import { FlowNode, Session } from '../App';
import { buildSystemPrompt, TEXT_DENSITY_LIMITS } from './systemPrompt';
import { loadDictionaryTerms } from '../components/DictionaryDialog';

async function buildTermsInstruction(): Promise<string> {
  try {
    const terms = await loadDictionaryTerms();
    if (terms.length === 0) return '';
    return `\n\n以下の用語が含まれる場合は、必ずこの表記で出力してください：\n${terms.map(t => `- ${t}`).join('\n')}`;
  } catch {
    return '';
  }
}

const SESSIONS_API = '/api/sessions';

export type ServerStatus = 'ok' | 'error';

export async function checkServerHealth(): Promise<ServerStatus> {
  try {
    const res = await fetch(SESSIONS_API, { signal: AbortSignal.timeout(10000) });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

export async function saveSession(session: Session): Promise<void> {
  const res = await fetch(SESSIONS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...session, createdAt: session.createdAt.toISOString() }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status}`);
}

export async function loadAllSessions(): Promise<Session[]> {
  const res = await fetch(SESSIONS_API, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Load failed: ${res.status}`);
  const data = await res.json();
  return (data as any[]).map(s => ({ ...s, createdAt: new Date(s.createdAt) }));
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${SESSIONS_API}/${sessionId}`, {
    method: 'DELETE',
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
}

export interface ProcessTextResponse {
  nodes: FlowNode[];
}

export interface FeedbackResponse {
  comments: string[];
  questions: string[];
}

async function makeRequest(url: string, options: RequestInit, retryCount = 0): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    return response;
  } catch (error) {
    if (retryCount < 2 && (
      error instanceof TypeError && error.message.includes('Failed to fetch') ||
      error instanceof Error && error.name === 'AbortError'
    )) {
      const delay = Math.pow(2, retryCount) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(url, options, retryCount + 1);
    }
    throw error;
  }
}

const NODE_QUANTITY_LIMITS: Record<string, { facts: number; insights: number }> = {
  low:    { facts: 1, insights: 1 },
  medium: { facts: 3, insights: 1 },
  high:   { facts: 5, insights: 3 },
};

const CHAR_LIMITS: Record<string, number> = { high: 90, medium: 56, low: 32 };

async function callOpenAIDirect(messages: object[], apiKey: string, maxTokens: number, temperature: number): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o', messages, temperature, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`OpenAI error: ${response.status}`);
  const result = await response.json();
  return result.choices[0].message.content;
}

async function callOpenAI(
  messages: object[],
  localApiKey: string,
  maxTokens = 1000,
  temperature = 0.2
): Promise<string> {
  if (localApiKey) {
    return callOpenAIDirect(messages, localApiKey, maxTokens, temperature);
  }

  const response = await fetch('/api/process-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: maxTokens, temperature }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('API_KEY_UNAVAILABLE');
  const result = await response.json();
  return result.choices[0].message.content;
}

const trimPeriod = (text: string) => text.replace(/。$/, '');

function parseTopicsToNodes(parsedContent: any, nodeQuantity: string = 'medium'): FlowNode[] {
  const limits = NODE_QUANTITY_LIMITS[nodeQuantity] ?? NODE_QUANTITY_LIMITS.medium;
  const nodes: FlowNode[] = [];
  let counter = Date.now();
  parsedContent.topics.forEach((topic: any, topicIndex: number) => {
    if (!topic.title || !Array.isArray(topic.facts) || !Array.isArray(topic.insights)) return;
    const topicId = `topic-${counter}-${topicIndex}`;
    nodes.push({ id: `node-${counter++}-title`, type: 'title', content: trimPeriod(topic.title), topicId });
    topic.facts.slice(0, limits.facts).forEach((fact: string, i: number) =>
      nodes.push({ id: `node-${counter++}-fact-${i}`, type: 'fact', content: trimPeriod(fact), topicId })
    );
    topic.insights.slice(0, limits.insights).forEach((insight: string, i: number) =>
      nodes.push({ id: `node-${counter++}-insight-${i}`, type: 'insight', content: trimPeriod(insight), topicId })
    );
  });
  return nodes;
}

async function consolidateItems(
  items: string[], maxCount: number, type: 'facts' | 'insights', apiKey: string
): Promise<string[]> {
  const typeLabel = type === 'facts' ? '客観的事実' : '主観的洞察';
  try {
    const content = await callOpenAI([
      {
        role: 'system',
        content: `以下の複数の${typeLabel}を、情報を損なわずに${maxCount}つの項目にまとめてください。番号付きリスト形式（1. ～ ${maxCount}. ）で返してください。JSON等の余分な形式は不要です。`,
      },
      { role: 'user', content: items.map((item, i) => `${i + 1}. ${item}`).join('\n') },
    ], apiKey, 800);
    const lines = content.split('\n').filter(l => l.trim())
      .map(l => l.replace(/^\d+\.\s*/, '').trim()).filter(l => l.length > 0);
    return lines.length > 0 ? lines.slice(0, maxCount) : items.slice(0, maxCount);
  } catch {
    return items.slice(0, maxCount);
  }
}

async function enforceNodeLimits(parsedContent: any, nodeQuantity: string, apiKey: string): Promise<any> {
  const limits = NODE_QUANTITY_LIMITS[nodeQuantity] ?? NODE_QUANTITY_LIMITS.medium;
  for (const topic of parsedContent.topics) {
    if (Array.isArray(topic.facts) && topic.facts.length > limits.facts)
      topic.facts = await consolidateItems(topic.facts, limits.facts, 'facts', apiKey);
    if (Array.isArray(topic.insights) && topic.insights.length > limits.insights)
      topic.insights = await consolidateItems(topic.insights, limits.insights, 'insights', apiKey);
  }
  return parsedContent;
}

const CHAR_MIN_LIMITS: Record<string, number> = { high: 32, medium: 24, low: 2 };

async function enforceTextDensity(parsedContent: any, textDensity: string, apiKey: string): Promise<any> {
  const maxLimit = CHAR_LIMITS[textDensity] ?? 90;
  const minLimit = CHAR_MIN_LIMITS[textDensity] ?? 2;

  type AdjustItem = { topicIndex: number; field: 'facts' | 'insights'; itemIndex: number; text: string };
  const overItems: AdjustItem[] = [];
  const underItems: AdjustItem[] = [];

  parsedContent.topics.forEach((topic: any, ti: number) => {
    (['facts', 'insights'] as const).forEach(field => {
      if (Array.isArray(topic[field]))
        topic[field].forEach((item: string, ii: number) => {
          if (typeof item !== 'string') return;
          if (item.length > maxLimit)
            overItems.push({ topicIndex: ti, field, itemIndex: ii, text: item });
          else if (item.length < minLimit)
            underItems.push({ topicIndex: ti, field, itemIndex: ii, text: item });
        });
    });
  });

  if (overItems.length > 0) {
    const shortenInstruction = textDensity === 'high'
      ? `以下の各テキスト項目を、情報密度を最大化しつつ80〜100文字になるよう書き直してください。数字・固有名詞・手法名はそのまま残し、記号（→・/・:）や略語を活用して凝縮すること。番号付きリストの形式を維持し、各項目を1行で返してください。`
      : `以下の各テキスト項目を、必ず${maxLimit}文字以内に収めて書き直してください。番号付きリストの形式を維持し、各項目を1行で返してください。`;

    try {
      const content = await callOpenAI([
        { role: 'system', content: shortenInstruction },
        { role: 'user', content: overItems.map((item, i) => `${i + 1}. ${item.text}`).join('\n') },
      ], apiKey, 800, 0.1);
      const lines = content.split('\n').filter(l => l.trim());
      overItems.forEach((item, i) => {
        const result = (lines[i] ?? '').replace(/^\d+\.\s*/, '').trim();
        if (result) parsedContent.topics[item.topicIndex][item.field][item.itemIndex] = result;
      });
    } catch { /* keep original on error */ }
  }

  if (underItems.length > 0) {
    const expandInstruction = textDensity === 'high'
      ? `以下の各テキスト項目を、情報密度を最大化して書き直してください。数字・割合・固有名詞・手法名はそのまま使い、「〜について話した」「〜が重要」のような抽象表現は禁止。記号（→・/・:）や略語を積極活用し、80〜100文字で記述すること。番号付きリストの形式を維持し、各項目を1行で返してください。`
      : textDensity === 'medium'
      ? `以下の各テキスト項目について、意味・文脈が正確に伝わるよういくらか詳しく書き直してください。具体的な内容を含め、情報を充実させることを優先し、${minLimit}文字以上${maxLimit}文字以内で記述すること。番号付きリストの形式を維持し、各項目を1行で返してください。`
      : `以下の各テキスト項目を、意味を保ちつつ${minLimit}文字以上${maxLimit}文字以内になるよう書き直してください。番号付きリストの形式を維持し、各項目を1行で返してください。`;

    try {
      const content = await callOpenAI([
        { role: 'system', content: expandInstruction },
        { role: 'user', content: underItems.map((item, i) => `${i + 1}. ${item.text}`).join('\n') },
      ], apiKey, 800, 0.2);
      const lines = content.split('\n').filter(l => l.trim());
      underItems.forEach((item, i) => {
        const result = (lines[i] ?? '').replace(/^\d+\.\s*/, '').trim();
        if (result) parsedContent.topics[item.topicIndex][item.field][item.itemIndex] = result;
      });
    } catch { /* keep original on error */ }
  }

  return parsedContent;
}

function extractJSON(content: string): any {
  // Strip markdown code blocks
  const stripped = content.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try { return JSON.parse(stripped); } catch { /* continue */ }
  // Find outermost {...}
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try { return JSON.parse(content.slice(start, end + 1)); } catch { /* continue */ }
  }
  return null;
}

export async function analyzeVideoFrame(base64: string): Promise<string> {
  const apiKey = typeof window !== 'undefined'
    ? localStorage.getItem('speechflow-openai-key') ?? ''
    : '';
  if (!apiKey) throw new Error('API_KEY_UNAVAILABLE');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 250,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'List all visible text, numbers, labels, and keywords from this screenshot. Output as a plain bullet list in Japanese. No commentary.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${base64}`, detail: 'low' },
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) throw new Error(`Vision API error: ${response.status}`);
  const data = await response.json();
  const content = data.choices[0].message.content as string;
  const REFUSAL_PATTERNS = ['申し訳', 'できません', 'I cannot', 'I am unable', "I'm sorry", 'sorry'];
  if (REFUSAL_PATTERNS.some(p => content.includes(p))) throw new Error('Vision API returned refusal');
  return content;
}

export async function correctProperNounsFromFrame(nodes: FlowNode[], frameBase64: string): Promise<FlowNode[]> {
  const apiKey = typeof window !== 'undefined'
    ? localStorage.getItem('speechflow-openai-key') ?? ''
    : '';
  if (!apiKey || nodes.length === 0) return nodes;

  const numbered = nodes.map((n, i) => `${i + 1}. ${n.content}`).join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      max_tokens: 1000,
      temperature: 0.1,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `画像はプレゼンやYouTube動画のスクリーンショットです。
以下の各テキスト項目の中で、画像に表示されている固有名詞・組織名・人名・製品名と表記が異なる箇所があれば、画像の表記に合わせて修正してください。
- 画像で確認できない固有名詞はそのまま返す
- 内容・意味・語順は変えない（固有名詞の表記のみ修正）
- 番号付きリスト形式（1. ～ N.）のまま全項目を返してください

${numbered}`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:image/jpeg;base64,${frameBase64}`, detail: 'low' },
          },
        ],
      }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) return nodes;
  const data = await response.json();
  const raw = data.choices[0].message.content as string;

  // 番号付きリスト行のみ抽出（拒否メッセージなど番号なし行は無視）
  const correctedMap: Record<number, string> = {};
  for (const line of raw.split('\n')) {
    const m = line.match(/^(\d+)\.\s+(.+)/);
    if (m) correctedMap[parseInt(m[1], 10)] = m[2].trim();
  }
  if (Object.keys(correctedMap).length === 0) return nodes;

  return nodes.map((node, i) => {
    const corrected = correctedMap[i + 1];
    if (!corrected || corrected === node.content) return node;
    // 変更量が元テキストの40%を超える場合は全文置き換えとみなして却下
    const editDistance = levenshtein(node.content, corrected);
    if (editDistance > node.content.length * 0.4) return node;
    return { ...node, content: corrected };
  });
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

async function processText(
  text: string,
  systemPrompt: string,
  nodeQuantity: string,
  textDensity: string,
  apiKey: string,
  visualContext?: string
): Promise<FlowNode[]> {
  const userContent = visualContext
    ? `[音声テキスト]\n${text}\n\n[画面の視覚情報（参考）]\n${visualContext}`
    : `以下のテキストを分析してください：\n\n${text}`;
  const content = await callOpenAI([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ], apiKey, 3000);

  let parsed = extractJSON(content);
  if (!parsed?.topics) throw new Error('Failed to parse OpenAI response');

  parsed = await enforceNodeLimits(parsed, nodeQuantity, apiKey);
  parsed = await enforceTextDensity(parsed, textDensity, apiKey);
  return parseTopicsToNodes(parsed, nodeQuantity);
}

export async function processTextToNodes(
  text: string,
  existingNodeCount: number,
  sessionId: string,
  informationLevel?: string,
  nodeQuantity?: string,
  textDensity?: string,
  visualContext?: string
): Promise<FlowNode[]> {
  const level = informationLevel ?? 'high';
  const nq = nodeQuantity ?? 'medium';
  const td = textDensity ?? 'high';
  const systemPrompt = buildSystemPrompt(td, level, nq) + await buildTermsInstruction();
  const localApiKey = typeof window !== 'undefined'
    ? localStorage.getItem('speechflow-openai-key') ?? ''
    : '';

  return processText(text, systemPrompt, nq, td, localApiKey, visualContext);
}

export async function sanitizeProperNouns(nodes: FlowNode[], apiKey: string): Promise<FlowNode[]> {
  if (nodes.length === 0) return nodes;

  const numbered = nodes.map((n, i) => `${i + 1}. ${n.content}`).join('\n');

  const systemPrompt = `以下の各テキスト項目に、人名・会社名・組織名・団体名などの固有名詞が含まれている場合、自然な日本語で汎称に書き直してください。

書き直しルール：
- 人名 → 「登壇者」「参加者」「研究者」「発表者」など役割で表現
- 会社名・組織名・団体名 → 「クライアント企業」「研究機関」「対象組織」「該当チーム」など文脈に合う汎称で表現
- ツール名・手法名・技術用語・数値・割合はそのまま使用
- 固有名詞が含まれない場合はそのまま返す
- 文の自然さ・意味を保ち、違和感なく仕上げること

番号付きリスト形式（1. ～ N.）のまま全項目を返してください。各項目は1行で返してください。`;

  try {
    const content = await callOpenAI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: numbered },
    ], apiKey, 1500, 0.1);

    const lines = content.split('\n')
      .map(l => l.replace(/^\d+\.\s*/, '').trim())
      .filter(l => l.length > 0);

    if (lines.length !== nodes.length) return nodes;

    return nodes.map((node, i) =>
      lines[i] && lines[i] !== node.content
        ? { ...node, content: lines[i] }
        : node
    );
  } catch {
    return nodes;
  }
}

const FEEDBACK_DENSITY_CONFIGS: Record<string, { charRange: string; commentExamples: string[]; questionExamples: string[] }> = {
  high: {
    charRange: '30〜120文字（理想80文字程度）',
    commentExamples: [
      'ユーザビリティテストでの認知バイアス除去手法が目から鱗でした。私も無意識に誘導的な質問をしていたかもと反省。',
      'ステークホルダーとのリサーチ価値共有の仕組みが素晴らしい。うちでも経営陣の理解不足が課題でした。',
    ],
    questionExamples: [
      'インタビューで感情の深層を引き出すプローブ質問の設計プロセスをもう少し詳しく教えてください。',
      '定量データとの矛盾が生じた際の意思決定プロセスで、どういう基準で判断の優先度を決められていますか？',
    ],
  },
  medium: {
    charRange: '30〜50文字',
    commentExamples: [
      '認知バイアス除去の具体的な工夫は自分の実践でも参考になりました。',
      'ステークホルダーへのリサーチ価値の伝え方は組織での課題と重なります。',
    ],
    questionExamples: [
      'インタビューで本音を引き出す質問設計で特に意識していることは何ですか？',
      '定性と定量データが矛盾した際の優先度の判断基準を教えてください。',
    ],
  },
  low: {
    charRange: '3〜30文字',
    commentExamples: [
      '認知バイアス除去の手法が参考になった',
      'ステークホルダー説得の難しさに共感',
    ],
    questionExamples: [
      'プローブ質問の設計で意識していることは？',
      '定量・定性データの優先度はどう決める？',
    ],
  },
};

function buildFeedbackSystemPrompt(density: string): string {
  const config = FEEDBACK_DENSITY_CONFIGS[density] ?? FEEDBACK_DENSITY_CONFIGS.high;
  const exampleJson = JSON.stringify(
    { comments: config.commentExamples, questions: config.questionExamples },
    null,
    2
  );
  return `あなたはRESeARCH Conference「POTENTIAL」の参加者になりきって、UXリサーチ・デザインリサーチセッションに対する専門的で深い感想と質問を生成するアシスタントです。

## カンファレンス背景
RESEARCH Conferenceは、リサーチをテーマとした日本発のカンファレンスです。2025年のテーマ「POTENTIAL」では、技術発展の中で人間が持つ独自の価値や、人にしかできないリサーチの本質的価値を探求します。

## 参加者プロフィール
- 定性リサーチに強い興味と基本的な教養を持つ
- UXデザイナー、リサーチャー、プロダクトマネージャー、学生など多様な立場

## 感想生成ルール
1. **浅い感想は禁止**: 「勇気をもらいました」「勉強になりました」レベルの浅い感想NG
2. **具体性を重視**: どのポイントが印象的だったか、なぜそう感じたかを明確に
3. **専門的観点**: リサーチ手法、実践上の工夫、課題解決アプローチなどに着目

## 質問生成ルール
1. **単純質問は禁止**: 「リサーチを始めるには？」レベルの基礎的質問NG
2. **深掘り志向**: セッション内容のより深い部分への探求
3. **方法論への関心**: 具体的な手法、プロセス、判断基準への質問

## 文字数ルール（厳守）
各感想・質問のテキストは必ず **${config.charRange}** で記述すること。
この範囲を超えることも、下回ることも禁止。下記のJSON例の文字数を参考にすること。

必ずこの形式のJSONのみを返してください：
${exampleJson}`;
}

export async function generateFeedback(inputs: string[], textDensity?: string): Promise<{ comments: string[], questions: string[] }> {
  const density = textDensity ?? 'high';
  const localApiKey = typeof window !== 'undefined'
    ? localStorage.getItem('speechflow-openai-key') ?? ''
    : '';

  if (localApiKey) {
    const systemPrompt = buildFeedbackSystemPrompt(density) + await buildTermsInstruction();
    const content = await callOpenAI(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `以下のRESeARCH Conferenceセッション内容に対して感想と質問を生成してください：\n\n${inputs.join('\n\n')}` },
      ],
      localApiKey,
      800,
      0.7
    );
    let parsed: { comments: string[]; questions: string[] } | undefined;
    try { parsed = JSON.parse(content); } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
    if (parsed?.comments && parsed?.questions) return parsed;
    throw new Error('Failed to parse feedback response');
  }

  const response = await makeRequest('/api/generate-feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs, textDensity: density }),
  });
  return response.json() as Promise<FeedbackResponse>;
}

export async function generateFallbackNodes(text: string, existingTopicCount: number): Promise<FlowNode[]> {
  const mockNodes: FlowNode[] = [];
  const topicId = `topic-${Date.now()}`;

  const titleContent = `トピック${existingTopicCount + 1}`;
  mockNodes.push({
    id: `node-${Date.now()}-title`,
    type: 'title',
    content: titleContent,
    topicId
  });

  const isShortText = text.length < 50;
  let factContent: string;

  if (isShortText) {
    factContent = text;
  } else {
    const factItems = [
      `${text.slice(0, 30)}に関する実施内容`,
      `具体的な取り組みとその背景`
    ];
    factContent = factItems.map(item => `・${item}`).join('\n');
  }

  if (factContent.length > 80) {
    const chunks = splitTextIntoChunks(factContent, 80);
    chunks.forEach((chunk, index) => {
      mockNodes.push({ id: `node-${Date.now()}-fact-${index}`, type: 'fact', content: chunk, topicId });
    });
  } else {
    mockNodes.push({ id: `node-${Date.now()}-fact`, type: 'fact', content: factContent, topicId });
  }

  let insightContent: string;

  if (isShortText) {
    insightContent = `${text.slice(0, 25)}についての考察`;
  } else {
    const insightItems = [
      `${text.slice(20, 40)}から得られる洞察`,
      `今後の展望と課題`
    ];
    insightContent = insightItems.map(item => `・${item}`).join('\n');
  }

  if (insightContent.length > 80) {
    const chunks = splitTextIntoChunks(insightContent, 80);
    chunks.forEach((chunk, index) => {
      mockNodes.push({ id: `node-${Date.now()}-insight-${index}`, type: 'insight', content: chunk, topicId });
    });
  } else {
    mockNodes.push({ id: `node-${Date.now()}-insight`, type: 'insight', content: insightContent, topicId });
  }

  return mockNodes;
}

export function generateFallbackFeedback(inputs: string[]): { comments: string[], questions: string[] } {
  return {
    comments: [
      "実践でのユーザビリティテストの課題設定アプローチが参考になりました。参加者の認知負荷を軽視していたかもしれません。",
      "ステークホルダーとの合意形成プロセスに共感しました。経営層へのリサーチ価値の伝え方は組織でも課題です。"
    ],
    questions: [
      "インタビューで本音を引き出すための環境設計や質問設計で、特に気をつけているポイントが気になります。",
      "定性データの分析で、個人の主観と客観的な洞察の境界線をどのように判断されているのか知りたいです。",
      "具体的なプロセスや事例について詳しく聞いてみたいと思います。",
      "その手法を実際のプロジェクトでどう活用されているのか興味があります。"
    ]
  };
}

function splitTextIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';

  const words = text.split(' ');

  for (const word of words) {
    if ((currentChunk + ' ' + word).length <= maxLength) {
      currentChunk = currentChunk ? currentChunk + ' ' + word : word;
    } else {
      if (currentChunk) chunks.push(currentChunk);
      currentChunk = word;
    }
  }

  if (currentChunk) chunks.push(currentChunk);

  return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}
