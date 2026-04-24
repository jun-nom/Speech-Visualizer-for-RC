import { projectId, publicAnonKey } from './supabase/info';
import { FlowNode, Session } from '../App';
import { buildSystemPrompt, TEXT_DENSITY_LIMITS } from './systemPrompt';

const API_BASE_URL = `https://${projectId}.supabase.co/functions/v1/make-server-a0d800ba`;

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${publicAnonKey}`,
};

export interface ProcessTextResponse {
  nodes: FlowNode[];
}

export interface FeedbackResponse {
  comments: string[];
  questions: string[];
}


// Enhanced error handling for network requests
async function makeRequest(url: string, options: RequestInit, retryCount = 0): Promise<Response> {
  try {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    return response;
  } catch (error) {
    console.error(`Request failed (attempt ${retryCount + 1}):`, error);
    
    // Retry logic for network errors
    if (retryCount < 2 && (
      error instanceof TypeError && error.message.includes('Failed to fetch') ||
      error instanceof Error && error.name === 'AbortError'
    )) {
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      console.log(`Retrying request in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return makeRequest(url, options, retryCount + 1);
    }
    
    throw error;
  }
}

// Parse OpenAI JSON response into FlowNodes
function parseTopicsToNodes(parsedContent: any): FlowNode[] {
  const nodes: FlowNode[] = [];
  let counter = Date.now();
  parsedContent.topics.forEach((topic: any, topicIndex: number) => {
    if (!topic.title || !Array.isArray(topic.facts) || !Array.isArray(topic.insights)) return;
    const topicId = `topic-${counter}-${topicIndex}`;
    nodes.push({ id: `node-${counter++}-title`, type: 'title', content: topic.title, topicId });
    topic.facts.forEach((fact: string, i: number) =>
      nodes.push({ id: `node-${counter++}-fact-${i}`, type: 'fact', content: fact, topicId })
    );
    topic.insights.forEach((insight: string, i: number) =>
      nodes.push({ id: `node-${counter++}-insight-${i}`, type: 'insight', content: insight, topicId })
    );
  });
  return nodes;
}

// Call OpenAI directly from the client using the user's API key
async function processTextWithOpenAIDirect(
  text: string,
  informationLevel: string,
  systemPrompt: string,
  openaiApiKey: string
): Promise<FlowNode[]> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `トピック量レベル: ${informationLevel}\n\n以下のテキストを分析してください：\n\n${text}` },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const result = await response.json();
  const content: string = result.choices[0].message.content;

  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
  }

  if (!parsed?.topics) throw new Error('Failed to parse OpenAI response');
  return parseTopicsToNodes(parsed);
}

// Process text to speech flow nodes
export async function processTextToNodes(
  text: string,
  existingNodeCount: number,
  sessionId: string,
  informationLevel?: string,
  textDensity?: string
): Promise<FlowNode[]> {
  const level = informationLevel ?? 'high';
  const systemPrompt = buildSystemPrompt(textDensity ?? 'high');

  // Use direct OpenAI call if API key is configured in app settings
  const openaiApiKey = typeof window !== 'undefined'
    ? localStorage.getItem('speechflow-openai-key') ?? ''
    : '';

  if (openaiApiKey) {
    try {
      return await processTextWithOpenAIDirect(text, level, systemPrompt, openaiApiKey);
    } catch (error) {
      console.warn('Direct OpenAI call failed, falling back to server:', error);
    }
  }

  // Cloudflare Pages Function（APIキーはサーバー側に保管、クライアントには見えない）
  try {
    const response = await makeRequest('/api/process-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, informationLevel: level, textDensity: textDensity ?? 'high', systemPrompt }),
    });
    const data: ProcessTextResponse = await response.json();
    return data.nodes;
  } catch (cfError) {
    console.warn('Cloudflare Function unavailable, falling back to Supabase:', cfError);
  }

  // 最終フォールバック: Supabase Edge Function
  try {
    const response = await makeRequest(`${API_BASE_URL}/process-text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, existingNodeCount, sessionId, informationLevel, textDensity, systemPrompt }),
    });
    const data: ProcessTextResponse = await response.json();
    return data.nodes;
  } catch (error) {
    console.error('Error processing text to nodes:', error);
    throw error;
  }
}

// Generate feedback (comments and questions)
export async function generateFeedback(inputs: string[]): Promise<{ comments: string[], questions: string[] }> {
  // Cloudflare Pages Function
  try {
    const response = await makeRequest('/api/generate-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    const data: FeedbackResponse = await response.json();
    return data;
  } catch (cfError) {
    console.warn('Cloudflare Function unavailable, falling back to Supabase:', cfError);
  }

  // 最終フォールバック: Supabase Edge Function
  try {
    const response = await makeRequest(`${API_BASE_URL}/generate-feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ inputs }),
    });
    const data: FeedbackResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Error generating feedback:', error);
    throw error;
  }
}

// Save session to database
export async function saveSession(session: Session): Promise<void> {
  try {
    await makeRequest(`${API_BASE_URL}/save-session`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...session,
        createdAt: session.createdAt.toISOString(),
      }),
    });
  } catch (error) {
    console.error('Error saving session:', error);
    throw error;
  }
}

// Load session from database
export async function loadSession(sessionId: string): Promise<Session> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/load-session/${sessionId}`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return {
      ...data,
      createdAt: new Date(data.createdAt),
    };
  } catch (error) {
    console.error('Error loading session:', error);
    throw error;
  }
}

// List all sessions
export async function listSessions(): Promise<Session[]> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/sessions`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return data.map((session: any) => ({
      ...session,
      createdAt: new Date(session.createdAt),
    }));
  } catch (error) {
    console.error('Error listing sessions:', error);
    throw error;
  }
}

// Load all sessions from database
export async function loadAllSessions(): Promise<Session[]> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/sessions/all`, {
      method: 'GET',
      headers,
    });

    const data = await response.json();
    return data.map((session: any) => ({
      ...session,
      createdAt: new Date(session.createdAt),
    }));
  } catch (error) {
    console.error('Error loading all sessions:', error);
    throw error;
  }
}

// Delete session from database
export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await makeRequest(`${API_BASE_URL}/delete-session/${sessionId}`, {
      method: 'DELETE',
      headers,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    throw error;
  }
}

// Bulk delete sessions from database
export async function deleteSessionsBulk(sessionIds: string[]): Promise<{ success: boolean; deletedCount: number }> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/delete-sessions-bulk`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sessionIds }),
    });

    return await response.json();
  } catch (error) {
    console.error('Error during bulk delete:', error);
    throw error;
  }
}

// Health check
export async function checkHealth(): Promise<{ status: string; timestamp: string }> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/health`, {
      method: 'GET',
      headers,
    });

    return await response.json();
  } catch (error) {
    console.error('Error checking health:', error);
    throw error;
  }
}

// Clean up dummy sessions (one-time utility function)
export async function cleanupDummySessions(): Promise<{ success: boolean; deletedCount: number }> {
  try {
    const response = await makeRequest(`${API_BASE_URL}/cleanup-dummy-sessions`, {
      method: 'DELETE',
      headers,
    });

    return await response.json();
  } catch (error) {
    console.error('Error cleaning up dummy sessions:', error);
    throw error;
  }
}

// Fallback functions for when OpenAI API is unavailable
export async function generateFallbackNodes(text: string, existingTopicCount: number): Promise<FlowNode[]> {
  const mockNodes: FlowNode[] = [];
  const topicId = `topic-${Date.now()}`;
  
  // Always create exactly 3 nodes: title, fact, insight
  // Only split if a single node content exceeds 80 characters
  
  // 1. Title node - keep simple and under 80 chars
  const titleContent = `トピック${existingTopicCount + 1}`;
  mockNodes.push({
    id: `node-${Date.now()}-title`,
    type: 'title',
    content: titleContent,
    topicId
  });
  
  // 2. Fact node - objective information with bullet points if needed
  const isShortText = text.length < 50;
  let factContent: string;
  
  if (isShortText) {
    factContent = text;
  } else {
    // Create realistic fact content using bullet points for multiple items
    const factItems = [
      `${text.slice(0, 30)}に関する実施内容`,
      `具体的な取り組みとその背景`
    ];
    factContent = factItems.map(item => `・${item}`).join('\n');
  }
  
  // Only split if the content actually exceeds 80 characters
  if (factContent.length > 80) {
    const chunks = splitTextIntoChunks(factContent, 80);
    chunks.forEach((chunk, index) => {
      mockNodes.push({
        id: `node-${Date.now()}-fact-${index}`,
        type: 'fact',
        content: chunk,
        topicId
      });
    });
  } else {
    mockNodes.push({
      id: `node-${Date.now()}-fact`,
      type: 'fact',
      content: factContent,
      topicId
    });
  }
  
  // 3. Insight node - subjective analysis with bullet points if needed
  let insightContent: string;
  
  if (isShortText) {
    insightContent = `${text.slice(0, 25)}についての考察`;
  } else {
    // Create realistic insight content using bullet points for multiple items
    const insightItems = [
      `${text.slice(20, 40)}から得られる洞察`,
      `今後の展望と課題`
    ];
    insightContent = insightItems.map(item => `・${item}`).join('\n');
  }
  
  // Only split if the content actually exceeds 80 characters
  if (insightContent.length > 80) {
    const chunks = splitTextIntoChunks(insightContent, 80);
    chunks.forEach((chunk, index) => {
      mockNodes.push({
        id: `node-${Date.now()}-insight-${index}`,
        type: 'insight',
        content: chunk,
        topicId
      });
    });
  } else {
    mockNodes.push({
      id: `node-${Date.now()}-insight`,
      type: 'insight',
      content: insightContent,
      topicId
    });
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

// Helper function to split text into chunks of specified length
function splitTextIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  
  const words = text.split(' ');
  
  for (const word of words) {
    if ((currentChunk + ' ' + word).length <= maxLength) {
      currentChunk = currentChunk ? currentChunk + ' ' + word : word;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      currentChunk = word;
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}