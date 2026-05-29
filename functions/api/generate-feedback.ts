interface Env {
  OPENAI_API_KEY?: string;
}

interface DensityConfig {
  charRange: string;
  commentExamples: string[];
  questionExamples: string[];
}

const DENSITY_CONFIGS: Record<string, DensityConfig> = {
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

function buildSystemPrompt(density: string): string {
  const config = DENSITY_CONFIGS[density] ?? DENSITY_CONFIGS.high;
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
- すぐに実践できるレベルのリサーチ知識を保有
- 自身の業務や学業向上に役立つ深い知識を求めている

## 感想生成ルール
1. **浅い感想は禁止**: 「勇気をもらいました」「勉強になりました」レベルの浅い感想NG
2. **具体性を重視**: どのポイントが印象的だったか、なぜそう感じたかを明確に
3. **専門的観点**: リサーチ手法、実践上の工夫、課題解決アプローチなどに着目
4. **個人体験との接続**: 自身の実務や学習での類似体験、対比などを含める
5. **感情的共感**: 登壇者の葛藤、発見、成長に対する共感を表現

## 質問生成ルール
1. **単純質問は禁止**: 「リサーチを始めるには？」レベルの基礎的質問NG
2. **実務応用性**: 質問者の業務や学業の具体的な向上につながる内容
3. **深掘り志向**: セッション内容のより深い部分への探求
4. **方法論への関心**: 具体的な手法、プロセス、判断基準への質問
5. **課題解決指向**: 現在抱えている実務上の課題解決に向けた質問

## 文字数ルール（厳守）
各感想・質問のテキストは必ず **${config.charRange}** で記述すること。
この範囲を超えることも、下回ることも禁止。下記のJSON例の文字数を参考にすること。

必ずこの形式のJSONのみを返してください：
${exampleJson}`;
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const openaiApiKey = context.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    return Response.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 });
  }

  const { inputs, textDensity } = await context.request.json() as { inputs: string[]; textDensity?: string };

  if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
    return Response.json({ error: 'inputs array is required' }, { status: 400 });
  }

  const charRange = CHAR_RANGES[textDensity ?? 'high'] ?? CHAR_RANGES.high;
  const systemPrompt = buildSystemPrompt(charRange);

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
          content: `以下のRESeARCH Conferenceセッション内容に対して感想と質問を生成してください：\n\n${inputs.join('\n\n')}`,
        },
      ],
      temperature: 0.7,
      max_tokens: 800,
    }),
  });

  if (!res.ok) {
    return Response.json({ error: `OpenAI error: ${res.status} ${res.statusText}` }, { status: 502 });
  }

  const result = await res.json() as { choices: Array<{ message: { content: string } }> };
  const content = result.choices[0].message.content;

  let parsed: { comments: string[]; questions: string[] } | undefined;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
  }

  if (!parsed?.comments || !parsed?.questions) {
    return Response.json({ error: 'Failed to parse AI response' }, { status: 500 });
  }

  return Response.json(parsed);
}
