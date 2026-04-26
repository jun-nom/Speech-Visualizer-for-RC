import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as kv from './kv_store.tsx';

interface FlowNode {
  id: string;
  type: 'title' | 'fact' | 'insight';
  content: string;
  topicId: string;
}

interface Session {
  id: string;
  title: string;
  createdAt: string;
  isActive: boolean;
  inputs: string[];
  nodes: FlowNode[];
  createdBy: string; // User identifier who created the session
  isPublic: boolean; // Whether the session is visible to other users
}

const app = new Hono();

app.use('*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}));

app.use('*', logger(console.log));

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Helper function to generate title and summary using OpenAI API for fallback cases
async function generateFallbackTitleAndSummary(text: string, openaiApiKey: string): Promise<{ title: string, summary: string }> {
  try {
    console.log('Generating fallback title and summary using OpenAI API...');
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `あなたは入力されたテキストから適切なタイトル（5〜15文字）と要約（80文字以内）を生成するアシスタントです。

## タイトル生成ルール
- 5〜15文字の具体的で意味のあるタイトル
- 「〜について」のような抽象的表現は避ける
- 内容の核心を簡潔に表現する
- 専門用語やキーワードを活用する

## 要約生成ルール
- 80文字以内で内容の要点をまとめる
- 客観的な事実や取り組み内容を中心に記述
- 具体的で分かりやすい表現を使用する
- 重要なポイントを漏らさず含める

必ずこの形式のJSONのみを返してください：
{
  "title": "ユーザビリティテスト改善",
  "summary": "20名の参加者を対象にA/Bテストを実施し、UI改善により完了率が40%から75%に向上。ユーザー行動分析から3つの主要課題を特定した。"
}`
          },
          {
            role: 'user',
            content: `以下のテキストから適切なタイトルと要約を生成してください：

${text}`
          }
        ],
        temperature: 0.3,
        max_tokens: 300
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    if (!result.choices || !result.choices[0] || !result.choices[0].message) {
      throw new Error('Invalid OpenAI response structure');
    }

    const content = result.choices[0].message.content;
    console.log('OpenAI fallback response:', content.substring(0, 200) + '...');

    // Parse JSON response
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          parsed = JSON.parse(jsonMatch[1]);
        } catch (e2) {
          console.log('Failed to parse JSON from markdown');
          throw new Error('Failed to parse JSON response');
        }
      } else {
        // Try to find JSON object in the response
        const jsonObjMatch = content.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          try {
            parsed = JSON.parse(jsonObjMatch[0]);
          } catch (e3) {
            console.log('Failed to parse extracted JSON object');
            throw new Error('Failed to parse JSON response');
          }
        } else {
          throw new Error('No valid JSON found in response');
        }
      }
    }

    if (!parsed.title || !parsed.summary) {
      throw new Error('Missing title or summary in response');
    }

    console.log('Generated fallback title:', parsed.title);
    console.log('Generated fallback summary:', parsed.summary);

    return {
      title: parsed.title,
      summary: parsed.summary
    };

  } catch (error) {
    console.error('Error generating fallback title and summary:', error);
    
    // Fallback to simple extraction if API fails
    const cleanedText = text.trim().replace(/\s+/g, ' ');
    const words = cleanedText.split(' ').filter(word => word.length > 2);
    
    let title = 'テキスト分析';
    if (words.length > 0) {
      const firstFewWords = words.slice(0, 3).join('');
      if (firstFewWords.length <= 15) {
        title = firstFewWords;
      } else if (words[0].length <= 15) {
        title = words[0];
      }
    }
    
    let summary = cleanedText;
    if (summary.length > 80) {
      summary = summary.substring(0, 77) + '...';
    }
    
    return { title, summary };
  }
}

// Helper function to extract keywords from summary text for title generation (legacy fallback)
function extractKeywordsForTitle(summaryText: string): string {
  const cleaned = summaryText.trim().replace(/\s+/g, ' ');
  
  // Remove common prefixes and suffixes
  const withoutPrefixes = cleaned
    .replace(/^・/, '')
    .replace(/について$/, '')
    .replace(/に関する.*$/, '')
    .replace(/の実施内容$/, '')
    .replace(/の取り組み$/, '')
    .replace(/についての考察$/, '')
    .replace(/から得られる.*$/, '')
    .replace(/の課題$/, '')
    .replace(/の手法$/, '')
    .replace(/の分析$/, '')
    .replace(/\.\.\.$/, '');

  // Split into words and find meaningful keywords
  const words = withoutPrefixes.split(/[、。・\s]+/).filter(word => 
    word.length >= 2 && 
    !['です', 'ます', 'した', 'では', 'から', 'まで', 'として', 'による', 'について', 'に関して', '具体的な', 'その他', '今後の'].includes(word)
  );

  if (words.length === 0) {
    return 'コンテンツ分析';
  }

  // Look for technical terms, methodologies, or specific concepts
  const technicalTerms = words.filter(word => 
    word.includes('テスト') || 
    word.includes('リサーチ') || 
    word.includes('分析') || 
    word.includes('設計') || 
    word.includes('実装') || 
    word.includes('調査') || 
    word.includes('評価') || 
    word.includes('検証') ||
    word.includes('ユーザー') ||
    word.includes('インタビュー') ||
    word.includes('データ') ||
    word.includes('手法') ||
    word.includes('プロセス') ||
    word.includes('アプローチ')
  );

  if (technicalTerms.length > 0) {
    const selectedTerm = technicalTerms[0];
    if (selectedTerm.length <= 15) {
      return selectedTerm;
    }
  }

  // Try to use the first meaningful word or phrase
  const firstMeaningfulWord = words.find(word => word.length >= 3 && word.length <= 15);
  if (firstMeaningfulWord) {
    return firstMeaningfulWord;
  }

  // Fallback: use first few characters of meaningful content
  const meaningfulContent = words.join('').substring(0, 12);
  if (meaningfulContent.length > 0) {
    return meaningfulContent;
  }

  return 'コンテンツ分析';
}

// Process text to speech flow nodes
app.post('/make-server-a0d800ba/process-text', async (c) => {
  try {
    const { text, existingNodeCount, sessionId, informationLevel = 'high', textDensity = 'high', systemPrompt } = await c.req.json();

    if (!text || typeof text !== 'string') {
      return c.json({ error: 'Text is required' }, 400);
    }

    const textDensityLimits: Record<string, number> = { high: 90, medium: 56, low: 32 };
    const textDensityLimit = textDensityLimits[textDensity] ?? 80;

    console.log('Processing text:', text.substring(0, 100) + '...');
    console.log('Existing topic count:', existingNodeCount);
    console.log('Information level:', informationLevel);
    console.log('Text density:', textDensity, '→ limit:', textDensityLimit);

    // Check if OpenAI API key is available
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('OpenAI API key not found in environment variables');
      return c.json({ error: 'OpenAI API key not configured' }, 500);
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `トピック量レベル: ${informationLevel}
facts・insights の1項目あたり文字数上限: ${textDensityLimit}文字（厳守）

以下のテキストを分析してください：

${text}`
          }
        ],
        temperature: 0.2,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      
      // Return more specific error messages based on status code
      if (response.status === 401) {
        return c.json({ error: 'OpenAI API key is invalid or expired' }, 500);
      } else if (response.status === 429) {
        return c.json({ error: 'OpenAI API rate limit exceeded. Please try again later.' }, 500);
      } else if (response.status === 503) {
        return c.json({ error: 'OpenAI API is temporarily unavailable. Please try again later.' }, 500);
      } else {
        return c.json({ error: `OpenAI API error: ${response.status} ${response.statusText}` }, 500);
      }
    }

    const openaiResult = await response.json();
    console.log('OpenAI response received, processing...');
    
    if (!openaiResult.choices || !openaiResult.choices[0] || !openaiResult.choices[0].message) {
      console.error('Invalid OpenAI response structure:', openaiResult);
      return c.json({ error: 'Invalid response from OpenAI API' }, 500);
    }

    const content = openaiResult.choices[0].message.content;
    console.log('OpenAI content:', content.substring(0, 200) + '...');
    
    // Improved JSON parsing with fallback
    let parsedContent;
    try {
      // Try to parse as-is first
      parsedContent = JSON.parse(content);
    } catch (e) {
      console.log('Failed to parse JSON directly, trying fallback methods...');
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          parsedContent = JSON.parse(jsonMatch[1]);
        } catch (e2) {
          console.log('Failed to parse JSON from markdown:', jsonMatch[1]);
        }
      }
      
      if (!parsedContent) {
        // Try to find JSON object in the response
        const jsonObjMatch = content.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          try {
            parsedContent = JSON.parse(jsonObjMatch[0]);
          } catch (e3) {
            console.log('Failed to parse extracted JSON object:', jsonObjMatch[0]);
          }
        }
      }
      
      if (!parsedContent) {
        console.log('All JSON parsing methods failed, attempting to generate intelligent fallback using OpenAI API...');
        
        // Try to use OpenAI API to generate proper title and summary for fallback
        try {
          const fallbackResult = await generateFallbackTitleAndSummary(text, openaiApiKey);
          
          console.log('Successfully generated fallback using OpenAI API');
          parsedContent = {
            topics: [
              {
                title: fallbackResult.title,
                facts: [fallbackResult.summary],
                insights: ["追加の分析が必要です"]
              }
            ]
          };
        } catch (fallbackError) {
          console.log('OpenAI API fallback also failed, using basic extraction:', fallbackError);
          
          // Final fallback: use basic text extraction
          const cleanedText = text.trim().replace(/\s+/g, ' ');
          const words = cleanedText.split(' ').filter(word => word.length > 2);
          
          let title = 'テキスト分析';
          if (words.length > 0) {
            const firstFewWords = words.slice(0, 3).join('');
            if (firstFewWords.length <= 15) {
              title = firstFewWords;
            } else if (words[0].length <= 15) {
              title = words[0];
            }
          }
          
          let summary = cleanedText;
          if (summary.length > 80) {
            summary = summary.substring(0, 77) + '...';
          }
          
          parsedContent = {
            topics: [
              {
                title: title,
                facts: [summary],
                insights: ["追加の分析が必要です"]
              }
            ]
          };
        }
      }
    }

    // Validate the parsed content
    if (!parsedContent || !Array.isArray(parsedContent.topics)) {
      console.error('Invalid parsed content structure:', parsedContent);
      return c.json({ error: 'Failed to parse valid topics from AI response' }, 500);
    }

    console.log('Successfully parsed', parsedContent.topics.length, 'topics');

    // Re-summarize any items exceeding the character limit (up to 2 attempts)
    const collectOverLimit = () => {
      const items: { topicIndex: number; field: 'facts' | 'insights'; itemIndex: number; text: string }[] = [];
      parsedContent.topics.forEach((topic: any, ti: number) => {
        (['facts', 'insights'] as const).forEach(field => {
          if (Array.isArray(topic[field])) {
            topic[field].forEach((item: string, ii: number) => {
              if (typeof item === 'string' && item.length > textDensityLimit) {
                items.push({ topicIndex: ti, field, itemIndex: ii, text: item });
              }
            });
          }
        });
      });
      return items;
    };

    for (let attempt = 0; attempt < 2; attempt++) {
      const overLimitItems = collectOverLimit();
      if (overLimitItems.length === 0) break;

      console.log(`Attempt ${attempt + 1}: ${overLimitItems.length} item(s) exceeding ${textDensityLimit} chars, re-summarizing...`);
      const itemListText = overLimitItems.map((item, i) => `${i + 1}. ${item.text}`).join('\n');

      const retryResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'system',
              content: `以下の各テキスト項目を、必ず${textDensityLimit}文字以内に収めて要約してください。
${textDensityLimit}文字を1文字でも超えることは絶対に禁止です。意味が伝わる範囲で最大限短くしてください。
番号付きリストの形式を維持し、各項目を1行で返してください。JSON等の余分な形式は不要です。`,
            },
            {
              role: 'user',
              content: itemListText,
            }
          ],
          temperature: 0.1,
          max_tokens: 400,
        })
      });

      if (!retryResponse.ok) {
        console.warn(`Re-summarization attempt ${attempt + 1} failed`);
        break;
      }

      const retryResult = await retryResponse.json();
      const retryContent: string = retryResult.choices?.[0]?.message?.content ?? '';
      const retryLines = retryContent.split('\n').filter((l: string) => l.trim());

      overLimitItems.forEach((item, i) => {
        const line = retryLines[i] ?? '';
        const summarized = line.replace(/^\d+\.\s*/, '').trim();
        if (summarized) {
          parsedContent.topics[item.topicIndex][item.field][item.itemIndex] = summarized;
          console.log(`Re-summarized [${item.field}][${item.itemIndex}]: "${item.text}" → "${summarized}" (${summarized.length}文字)`);
        }
      });
    }
    }

    // Generate nodes without positioning (CSS flexbox handles layout)
    const nodes: FlowNode[] = [];
    let nodeIdCounter = Date.now();
    
    parsedContent.topics.forEach((topic: any, topicIndex: number) => {
      if (!topic.title || !Array.isArray(topic.facts) || !Array.isArray(topic.insights)) {
        console.warn('Skipping invalid topic:', topic);
        return; // Skip invalid topics
      }

      const topicId = `topic-${nodeIdCounter}-${topicIndex}`;

      // Create title node
      nodes.push({
        id: `node-${nodeIdCounter++}-title`,
        type: 'title',
        content: topic.title,
        topicId
      });

      // Create facts nodes
      topic.facts.forEach((fact: string, index: number) => {
        nodes.push({
          id: `node-${nodeIdCounter++}-fact-${index}`,
          type: 'fact',
          content: fact,
          topicId
        });
      });

      // Create insights nodes
      topic.insights.forEach((insight: string, index: number) => {
        nodes.push({
          id: `node-${nodeIdCounter++}-insight-${index}`,
          type: 'insight',
          content: insight,
          topicId
        });
      });
    });

    console.log('Generated', nodes.length, 'nodes total');
    return c.json({ nodes });

  } catch (error) {
    console.error('Error processing text:', error);
    return c.json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, 500);
  }
});

// Generate feedback (comments and questions)
app.post('/make-server-a0d800ba/generate-feedback', async (c) => {
  try {
    const { inputs } = await c.req.json();
    
    if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
      return c.json({ error: 'Inputs array is required' }, 400);
    }

    console.log('Generating feedback for', inputs.length, 'inputs');

    // Check if OpenAI API key is available
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      console.error('OpenAI API key not found in environment variables');
      return c.json({ error: 'OpenAI API key not configured' }, 500);
    }

    const allText = inputs.join('\n\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `あなたはRESeARCH Conference「POTENTIAL」の参加者になりきって、UXリサーチ・デザインリサーチセッションに対する専門的で深い感想と質問を生成するアシスタントです。

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

## 参加者属性例
- 5年目UXデザイナー、リサーチャー3年目、PM2年目
- 大学院修士1年、デザイン学科4年生
- スタートアップCXO、事業会社UX責任者
- フリーランスリサーチャー、コンサルタント

## 語彙修正・専門用語調整
デザインリサーチ・UXリサーチ分野の正しい専門用語を使用してください：
- 「デザイン志向」→「デザイン思考」
- 「ユーザーエクスペリエンス」→「UX（ユーザーエクスペリエンス）」
- 「ユーザーインターフェース」→「UI（ユーザーインターフェース）」
- 「ペルソナ作成」→「ペルソナ開発」
- 「ユーザビリティー」→「ユーザビリティ」
- その他の表記揺れも適切な専門用語に統一

## 出力形式
各感想・質問は内容のみを記載し、30〜120文字（理想80文字程度）

必ずこの形式のJSONのみを返してください：
{
  "comments": [
    "ユーザビリティテストでの認知バイアス除去手法が目から鱗でした。私も無意識に誘導的な質問をしていたかもと反省。",
    "ステークホルダーとのリサーチ価値共有の仕組みが素晴らしい。うちでも経営陣の理解不足が課題でした。"
  ],
  "questions": [
    "インタビューで感情の深層を引き出すプローブ質問の設計プロセスをもう少し詳しく教えてください。",
    "定量データとの矛盾が生じた際の意思決定プロセスで、どういう基準で判断の優先度を決められていますか？"
  ]
}`
          },
          {
            role: 'user',
            content: `以下のRESeARCH Conferenceセッション内容に対して感想と質問を生成してください：

${allText}`
          }
        ],
        temperature: 0.7,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error for feedback:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText
      });
      
      // Return more specific error messages based on status code
      if (response.status === 401) {
        return c.json({ error: 'OpenAI API key is invalid or expired' }, 500);
      } else if (response.status === 429) {
        return c.json({ error: 'OpenAI API rate limit exceeded. Please try again later.' }, 500);
      } else if (response.status === 503) {
        return c.json({ error: 'OpenAI API is temporarily unavailable. Please try again later.' }, 500);
      } else {
        return c.json({ error: `OpenAI API error: ${response.status} ${response.statusText}` }, 500);
      }
    }

    const openaiResult = await response.json();
    console.log('OpenAI feedback response received, processing...');
    
    if (!openaiResult.choices || !openaiResult.choices[0] || !openaiResult.choices[0].message) {
      console.error('Invalid OpenAI feedback response structure:', openaiResult);
      return c.json({ error: 'Invalid response from OpenAI API' }, 500);
    }

    const content = openaiResult.choices[0].message.content;
    console.log('OpenAI feedback content:', content.substring(0, 200) + '...');
    
    // Improved JSON parsing with fallback for feedback
    let parsedContent;
    try {
      // Try to parse as-is first
      parsedContent = JSON.parse(content);
    } catch (e) {
      console.log('Failed to parse feedback JSON directly, trying fallback methods...');
      
      // Try to extract JSON from markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
      if (jsonMatch) {
        try {
          parsedContent = JSON.parse(jsonMatch[1]);
        } catch (e2) {
          console.log('Failed to parse feedback JSON from markdown:', jsonMatch[1]);
        }
      }
      
      if (!parsedContent) {
        // Try to find JSON object in the response
        const jsonObjMatch = content.match(/\{[\s\S]*\}/);
        if (jsonObjMatch) {
          try {
            parsedContent = JSON.parse(jsonObjMatch[0]);
          } catch (e3) {
            console.log('Failed to parse extracted feedback JSON object:', jsonObjMatch[0]);
          }
        }
      }
      
      if (!parsedContent) {
        console.log('All feedback JSON parsing methods failed, creating fallback content');
        // Fallback: create basic feedback
        parsedContent = {
          comments: [
            "とても興味深い内容でした。実践的なアプローチに感銘を受けました。",
            "新しい視点を学べて勉強になりました。自分の業務にも活かしたいと思います。"
          ],
          questions: [
            "実際の業務でどのように活用されているのでしょうか？",
            "技術的な実装について詳しく教えてください。"
          ]
        };
      }
    }

    // Validate the parsed feedback content
    if (!parsedContent || !Array.isArray(parsedContent.comments) || !Array.isArray(parsedContent.questions)) {
      console.error('Invalid parsed feedback content structure:', parsedContent);
      return c.json({ error: 'Failed to parse valid feedback from AI response' }, 500);
    }

    console.log('Successfully generated feedback with', parsedContent.comments.length, 'comments and', parsedContent.questions.length, 'questions');
    return c.json(parsedContent);

  } catch (error) {
    console.error('Error generating feedback:', error);
    return c.json({ 
      error: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}` 
    }, 500);
  }
});

// Save session to database
app.post('/make-server-a0d800ba/save-session', async (c) => {
  try {
    const session = await c.req.json();
    
    if (!session || !session.id) {
      return c.json({ error: 'Session data with id is required' }, 400);
    }

    await kv.set(`session:${session.id}`, session);
    return c.json({ success: true });

  } catch (error) {
    console.log('Error saving session:', error);
    return c.json({ error: 'Internal server error during session save' }, 500);
  }
});

// Load session from database
app.get('/make-server-a0d800ba/load-session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id');
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    const session = await kv.get(`session:${sessionId}`);
    
    if (!session) {
      return c.json({ error: 'Session not found' }, 404);
    }

    return c.json(session);

  } catch (error) {
    console.log('Error loading session:', error);
    return c.json({ error: 'Internal server error during session load' }, 500);
  }
});

// List all sessions
app.get('/make-server-a0d800ba/sessions', async (c) => {
  try {
    const sessions = await kv.getByPrefix('session:');
    return c.json(sessions || []);

  } catch (error) {
    console.log('Error listing sessions:', error);
    return c.json({ error: 'Internal server error during session listing' }, 500);
  }
});

// Load all sessions from database (alias for sessions endpoint)
app.get('/make-server-a0d800ba/sessions/all', async (c) => {
  try {
    const sessions = await kv.getByPrefix('session:');
    return c.json(sessions || []);

  } catch (error) {
    console.log('Error loading all sessions:', error);
    return c.json({ error: 'Internal server error during session listing' }, 500);
  }
});

// Delete session from database
app.delete('/make-server-a0d800ba/delete-session/:id', async (c) => {
  try {
    const sessionId = c.req.param('id');
    
    if (!sessionId) {
      return c.json({ error: 'Session ID is required' }, 400);
    }

    await kv.del(`session:${sessionId}`);
    return c.json({ success: true });

  } catch (error) {
    console.log('Error deleting session:', error);
    return c.json({ error: 'Internal server error during session deletion' }, 500);
  }
});

// Bulk delete sessions from database
app.post('/make-server-a0d800ba/delete-sessions-bulk', async (c) => {
  try {
    const { sessionIds } = await c.req.json();
    
    if (!sessionIds || !Array.isArray(sessionIds) || sessionIds.length === 0) {
      return c.json({ error: 'Session IDs array is required' }, 400);
    }

    let deletedCount = 0;
    for (const sessionId of sessionIds) {
      try {
        await kv.del(`session:${sessionId}`);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete session ${sessionId}:`, error);
      }
    }

    return c.json({ success: true, deletedCount });

  } catch (error) {
    console.log('Error during bulk delete:', error);
    return c.json({ error: 'Internal server error during bulk deletion' }, 500);
  }
});

// Health check
app.get('/make-server-a0d800ba/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Return OpenAI API key so the client can call OpenAI directly
app.get('/make-server-a0d800ba/openai-key', (c) => {
  const key = Deno.env.get('OPENAI_API_KEY') ?? '';
  if (!key) return c.json({ error: 'OPENAI_API_KEY not configured' }, 500);
  return c.json({ key });
});

// Clean up dummy sessions (one-time utility endpoint)
app.delete('/make-server-a0d800ba/cleanup-dummy-sessions', async (c) => {
  try {
    console.log('Starting cleanup of dummy and empty sessions...');
    const sessions = await kv.getByPrefix('session:');
    let deletedCount = 0;

    // Delete sessions with specific dummy titles, old timestamps, or completely empty sessions
    for (const session of sessions) {
      if (session.title === '2025/08/17 09:15' || 
          session.title === '2025/08/17 08:30' ||
          session.title === '2025/1/12 15:30' ||
          session.title === '2025/1/12 14:15' ||
          session.title === '2025/1/12 16:45' ||
          // Also check for any session that looks like a dummy with no real data
          (session.inputs && session.inputs.length === 0 && 
           session.nodes && session.nodes.length === 0 &&
           session.title.match(/^\d{4}\/\d{1,2}\/\d{1,2}\s\d{2}:\d{2}$/)) ||
          // Delete completely empty sessions (no inputs AND no nodes)
          ((!session.inputs || session.inputs.length === 0) && 
           (!session.nodes || session.nodes.length === 0))) {
        await kv.del(`session:${session.id}`);
        deletedCount++;
        console.log(`Deleted empty/dummy session: ${session.title} (ID: ${session.id})`);
      }
    }

    console.log(`Cleanup completed. Deleted ${deletedCount} dummy sessions.`);
    return c.json({ success: true, deletedCount });

  } catch (error) {
    console.log('Error during cleanup:', error);
    return c.json({ error: 'Internal server error during cleanup' }, 500);
  }
});

export default {
  fetch: app.fetch,
};

Deno.serve(app.fetch);