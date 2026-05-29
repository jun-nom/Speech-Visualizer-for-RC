import React, { useState, useEffect, useRef } from 'react';
import { SpeechFlowCanvas } from './components/SpeechFlowCanvas';
import { TextInputForm, InformationLevel, TextDensity, NodeQuantity } from './components/TextInputForm';
import { SessionManager } from './components/SessionManager';
import { FeedbackGenerator } from './components/FeedbackGenerator';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner@2.0.3';
import * as api from './utils/api';
import { SettingsDialog } from './components/SettingsDialog';
import { LogViewer } from './components/LogViewer';
import { TranscriptionButton } from './components/TranscriptionButton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './components/ui/alert-dialog';

export interface FlowNode {
  id: string;
  type: 'title' | 'fact' | 'insight';
  content: string;
  topicId: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: Date;
  isActive: boolean;
  inputs: string[];
  nodes: FlowNode[];
  createdBy: string;
  isPublic: boolean;
  draftInput?: string;
}

const MIRO_BOARD_ID = 'uXjVHMCUsVk=';
const MIRO_NODE_WIDTH = 620;
const MIRO_COLUMN_STEP = 700;
const MIRO_NODE_GAP = 48;

const MIRO_STYLES: Record<string, object> = {
  title:   { fillColor: '#E2EEFD', borderColor: '#2D9BF0', borderStyle: 'normal', borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle' },
  fact:    { fillColor: '#FFFFFF',  borderColor: '#2D9BF0', borderStyle: 'dotted', borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle' },
  insight: { fillColor: '#414BB2', borderColor: '#414BB2', borderStyle: 'normal', borderWidth: '1', color: '#FFFFFF',  fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '0', textAlign: 'center', textAlignVertical: 'middle' },
};

function miroEstimateHeight(content: string, minH: number): number {
  const LINE_HEIGHT = Math.round(37 * 1.4);
  const charsPerLine = Math.max(1, Math.floor((MIRO_NODE_WIDTH - 50) / 37));
  let lines = 0;
  for (const seg of content.split('\n')) lines += Math.max(1, Math.ceil(seg.length / charsPerLine));
  return Math.max(minH, lines * LINE_HEIGHT + 80);
}

const MIRO_BATCH_GAP = 80; // gap between successive batches

async function syncNodesToMiro(nodes: FlowNode[], lastShapeId: string | null): Promise<{ success: boolean; lastShapeId?: string }> {
  const token = import.meta.env.VITE_MIRO_ACCESS_TOKEN as string | undefined;
  if (!token) return { success: false };

  // Determine starting position: bottom-right of last placed shape
  let startX = 0;
  let startY = 0;
  if (lastShapeId) {
    try {
      const res = await fetch(`https://api.miro.com/v2/boards/${MIRO_BOARD_ID}/shapes/${lastShapeId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json() as { position: { x: number; y: number }; geometry: { width: number; height: number } };
        startX = data.position.x + data.geometry.width / 2 + MIRO_BATCH_GAP;
        startY = data.position.y + data.geometry.height / 2 + MIRO_BATCH_GAP;
      }
    } catch {
      // fall through to default (0, 0)
    }
  }

  const topicOrder: string[] = [];
  const grouped: Record<string, FlowNode[]> = {};
  for (const node of nodes) {
    if (!grouped[node.topicId]) { grouped[node.topicId] = []; topicOrder.push(node.topicId); }
    grouped[node.topicId].push(node);
  }
  const typeOrder: Record<string, number> = { title: 0, fact: 1, insight: 2 };
  for (const id of topicOrder) grouped[id].sort((a, b) => (typeOrder[a.type] ?? 1) - (typeOrder[b.type] ?? 1));

  let newLastShapeId: string | undefined;
  let firstError = '';
  for (let col = 0; col < topicOrder.length; col++) {
    let y = startY;
    for (const node of grouped[topicOrder[col]]) {
      const minH = node.type === 'title' ? 160 : 200;
      const height = miroEstimateHeight(node.content, minH);
      const esc = node.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      const content = node.type === 'title' ? `<b>${esc}</b>` : esc;
      try {
        const res = await fetch(`https://api.miro.com/v2/boards/${MIRO_BOARD_ID}/shapes`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            data: { shape: 'round_rectangle', content },
            style: MIRO_STYLES[node.type] ?? MIRO_STYLES.fact,
            position: { x: startX + col * MIRO_COLUMN_STEP, y },
            geometry: { width: MIRO_NODE_WIDTH, height },
          }),
        });
        if (res.ok) {
          const data = await res.json() as { id: string };
          newLastShapeId = data.id;
        } else {
          const errText = await res.text();
          console.error(`[Miro] ${res.status} (${node.type}):`, errText);
          if (!firstError) firstError = `[${node.type}] ${res.status}: ${errText.slice(0, 100)}`;
        }
      } catch (err) {
        console.error('[Miro] fetch error:', err);
        if (!firstError) firstError = String(err);
      }
      y += height + MIRO_NODE_GAP;
    }
  }

  if (firstError) { toast.error(`Miroエラー: ${firstError}`); return { success: false }; }
  toast.success('Miroに追加しました');
  return { success: true, lastShapeId: newLastShapeId };
}

export default function App() {
  const getUserId = (): string => {
    if (typeof window === 'undefined') return 'user-' + Date.now().toString();
    try {
      let storedId = localStorage.getItem('speechflow-user-id');
      if (storedId) return storedId;
      const newId = 'user-' + Date.now().toString();
      localStorage.setItem('speechflow-user-id', newId);
      return newId;
    } catch {
      return 'user-fallback-' + Date.now().toString();
    }
  };

  const currentUserId = getUserId();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [feedback, setFeedback] = useState<{ comments: string[], questions: string[] }>({ comments: [], questions: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [supabaseStatus, setSupabaseStatus] = useState<api.SupabaseStatus | null>(null);
  const [isLogViewerOpen, setIsLogViewerOpen] = useState(false);
  const [showPanels, setShowPanels] = useState(true);
  const [horizontalScroll, setHorizontalScroll] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-horizontal-scroll') === 'true';
    }
    return false;
  });
  const [pendingVisualContext, setPendingVisualContext] = useState<string | null>(null);
  const isAnalyzingFrameRef = useRef(false);
  const latestFrameRef = useRef<string | null>(null);
  const lastMiroShapeIdRef = useRef<string | null>(null);

  const [informationLevel, setInformationLevel] = useState<InformationLevel>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-information-level') as InformationLevel) || 'high';
    }
    return 'high';
  });

  const [nodeQuantity, setNodeQuantity] = useState<NodeQuantity>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-node-quantity') as NodeQuantity) || 'medium';
    }
    return 'medium';
  });

  const [textDensity, setTextDensity] = useState<TextDensity>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-text-density') as TextDensity) || 'medium';
    }
    return 'medium';
  });

  const [feedbackTextDensity, setFeedbackTextDensity] = useState<TextDensity>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-feedback-text-density') as TextDensity) || 'high';
    }
    return 'high';
  });

  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-openai-key') || '';
    }
    return '';
  });

  const [deepgramApiKey, setDeepgramApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-deepgram-key') || '';
    }
    return '';
  });

  const [aiModel, setAiModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-ai-model') || 'gpt-4o';
    }
    return 'gpt-4o';
  });

  const handleInformationLevelChange = (level: InformationLevel) => {
    setInformationLevel(level);
    localStorage.setItem('speechflow-information-level', level);
  };

  const handleNodeQuantityChange = (quantity: NodeQuantity) => {
    setNodeQuantity(quantity);
    localStorage.setItem('speechflow-node-quantity', quantity);
  };

  const handleTextDensityChange = (density: TextDensity) => {
    setTextDensity(density);
    localStorage.setItem('speechflow-text-density', density);
  };

  const handleFeedbackTextDensityChange = (density: TextDensity) => {
    setFeedbackTextDensity(density);
    localStorage.setItem('speechflow-feedback-text-density', density);
  };

  const handleOpenaiApiKeyChange = (key: string) => {
    setOpenaiApiKey(key);
    localStorage.setItem('speechflow-openai-key', key);
  };

  const handleDeepgramApiKeyChange = (key: string) => {
    setDeepgramApiKey(key);
    localStorage.setItem('speechflow-deepgram-key', key);
  };

  const handleTranscript = (text: string) => {
    setInterimTranscript('');
    setCurrentInput(prev => prev ? prev + text : text);
  };

  const handleInterimTranscript = (text: string) => {
    setInterimTranscript(text);
  };

  const handleNewFrame = async (base64: string) => {
    latestFrameRef.current = base64;
    if (isAnalyzingFrameRef.current) return;
    isAnalyzingFrameRef.current = true;
    try {
      const description = await api.analyzeVideoFrame(base64);
      setPendingVisualContext(description);
    } catch {
      // vision analysis is best-effort; don't surface errors
    } finally {
      isAnalyzingFrameRef.current = false;
    }
  };

  const handleAiModelChange = (model: string) => {
    setAiModel(model);
    localStorage.setItem('speechflow-ai-model', model);
  };

  const activeSession = sessions.find(s => s.isActive);

  const currentViewingSession = activeSession || sessions.find(s =>
    JSON.stringify(s.inputs) === JSON.stringify(inputHistory)
  );

  const isViewingOtherUserSession = currentViewingSession && currentViewingSession.createdBy !== currentUserId;

  const saveSessionsToLocal = (sessionsToSave: Session[]) => {
    try {
      const serializable = sessionsToSave.map(session => ({
        ...session,
        createdAt: session.createdAt.toISOString()
      }));
      localStorage.setItem('speechflow-local-sessions', JSON.stringify(serializable));
    } catch (error) {
      console.warn('Failed to save sessions to local storage:', error);
    }
  };

  const loadSessionsFromLocal = (): Session[] => {
    try {
      const localSessions = localStorage.getItem('speechflow-local-sessions');
      if (localSessions) {
        const parsed = JSON.parse(localSessions);
        return parsed.map((session: any) => ({
          ...session,
          createdAt: new Date(session.createdAt)
        }));
      }
    } catch (error) {
      console.warn('Failed to load from local storage:', error);
    }
    return [];
  };

  // Supabase health check on mount
  useEffect(() => {
    api.checkSupabaseHealth().then(setSupabaseStatus);
  }, []);

  const saveToSupabase = (session: Session) => {
    if (supabaseStatus === 'quota_exceeded' || supabaseStatus === 'error') return;
    api.saveSessionToSupabase(session).catch((err: any) => {
      if (err?.isQuotaExceeded) setSupabaseStatus('quota_exceeded');
      console.warn('Supabase save failed:', err);
    });
  };

  const createNewSession = async () => {
    if (isCreatingSession) return;
    setIsCreatingSession(true);
    try {
      const newSession: Session = {
        id: Date.now().toString(),
        title: new Date().toLocaleString('ja-JP').replace(/[\/\s]/g, '/'),
        createdAt: new Date(),
        isActive: true,
        inputs: [],
        nodes: [],
        createdBy: currentUserId,
        isPublic: true
      };

      // 現在のテキスト入力内容をアクティブセッションのドラフトとして保存
      const sessionsWithDraft = sessions.map(s =>
        s.isActive && currentInput.trim()
          ? { ...s, isActive: false, draftInput: currentInput }
          : { ...s, isActive: false }
      );
      const updatedSessions = [...sessionsWithDraft, newSession];
      setSessions(updatedSessions);
      setInputHistory([]);
      setCurrentInput('');
      setFeedback({ comments: [], questions: [] });
      saveSessionsToLocal(updatedSessions);
      saveToSupabase(newSession);
      toast.success('新しいセッションを作成しました');
    } catch (error) {
      toast.error('セッション作成中にエラーが発生しました');
    } finally {
      setIsCreatingSession(false);
    }
  };

  // Load sessions on app start
  useEffect(() => {
    setIsLoadingSessions(true);
    try {
      const loadedSessions = loadSessionsFromLocal().filter(s => s.inputs.length > 0);

      if (loadedSessions.length > 0) {
        const userSessions = loadedSessions
          .filter(s => s.createdBy === currentUserId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        if (userSessions.length > 0) {
          const newestSession = userSessions[0];
          const withActive = loadedSessions.map(s => ({ ...s, isActive: s.id === newestSession.id }));
          setSessions(withActive);
          setInputHistory(newestSession.inputs || []);
        } else {
          setSessions(loadedSessions);
          createNewSession();
        }
      } else {
        createNewSession();
      }
    } catch (error) {
      console.error('Failed to load initial data:', error);
      createNewSession();
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  const handleAddToFlow = async (text: string, informationLevel: InformationLevel) => {
    if (!text.trim() || !activeSession || isProcessing) return;

    setIsProcessing(true);

    try {
      const newHistory = [...inputHistory, text];
      setInputHistory(newHistory);

      const updatedSessions = sessions.map(session =>
        session.isActive
          ? { ...session, inputs: [...session.inputs, text] }
          : session
      );
      setSessions(updatedSessions);

      setCurrentInput('');

      const uniqueTopicIds = new Set(activeSession.nodes.map(node => node.topicId));
      const existingTopicCount = uniqueTopicIds.size;

      let newNodes: FlowNode[];

      try {
        newNodes = await api.processTextToNodes(text, existingTopicCount, activeSession.id, informationLevel, nodeQuantity, textDensity, pendingVisualContext ?? undefined);

        newNodes = newNodes.filter(node => {
          if (node.type === 'insight' && node.content === '追加の分析が必要です') return false;
          return true;
        });
      } catch (apiError) {
        const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';

        if (errorMessage === 'API_KEY_UNAVAILABLE') {
          toast.error('APIキーを設定してください');
          return;
        }

        if (errorMessage.toLowerCase().includes('rate limit')) {
          newNodes = await api.generateFallbackNodes(text, existingTopicCount);
          toast.error('OpenAI APIのレート制限に達しました。しばらくしてから再試行してください。');
        } else {
          toast.error(`処理中にエラーが発生しました: ${errorMessage}`);
          return;
        }
      }

      const updatedSessionsWithNodes = updatedSessions.map(session =>
        session.isActive
          ? { ...session, nodes: [...session.nodes, ...newNodes] }
          : session
      );
      setSessions(updatedSessionsWithNodes);
      saveSessionsToLocal(updatedSessionsWithNodes);
      const savedSession = updatedSessionsWithNodes.find(s => s.isActive);
      if (savedSession) saveToSupabase(savedSession);

      // バックグラウンドで固有名詞を映像フレームと照合・補正
      const frameForCorrection = latestFrameRef.current;
      if (frameForCorrection) {
        api.correctProperNounsFromFrame(newNodes, frameForCorrection).then(correctedNodes => {
          const hasChanges = correctedNodes.some((n, i) => n.content !== newNodes[i]?.content);
          if (!hasChanges) return;
          setSessions(prev => {
            const updated = prev.map(session =>
              session.isActive
                ? {
                    ...session,
                    nodes: session.nodes.map(node => {
                      const corrected = correctedNodes.find(c => c.id === node.id);
                      return corrected ?? node;
                    }),
                  }
                : session
            );
            saveSessionsToLocal(updated);
            return updated;
          });
        }).catch(() => {});
      }

      toast.success('スピーチフローに追加しました');

      // Miroボードに非同期でシェイプを追加
      syncNodesToMiro(newNodes, lastMiroShapeIdRef.current).then(({ success, lastShapeId }) => {
        if (success && lastShapeId) lastMiroShapeIdRef.current = lastShapeId;
      });
    } catch (error) {
      toast.error('処理中にエラーが発生しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateFeedback = async () => {
    if (isGeneratingFeedback) {
      toast.info('感想・質問を生成中です。しばらくお待ちください。');
      return;
    }

    let currentSession = activeSession || currentViewingSession;

    if (inputHistory.length === 0) {
      toast.info('感想・質問を生成するためのテキストがありません。まずスピーチ内容を入力してください。');
      return;
    }

    if (!currentSession) {
      toast.error('セッションが見つかりません。ページを再読み込みしてください。');
      return;
    }

    setIsGeneratingFeedback(true);

    try {
      let generatedFeedback: { comments: string[], questions: string[] };

      try {
        generatedFeedback = await api.generateFeedback(inputHistory, feedbackTextDensity);
      } catch (apiError) {
        const errorMessage = (apiError instanceof Error ? apiError.message : 'Unknown error').toLowerCase();
        generatedFeedback = api.generateFallbackFeedback(inputHistory);
        if (errorMessage.includes('openai') || errorMessage.includes('api key') || errorMessage.includes('rate limit')) {
          toast.error('OpenAI APIに接続できません。基本的な感想・質問を表示します。');
        }
      }

      setFeedback(generatedFeedback);
      toast.success(`感想${generatedFeedback.comments.length}件と質問${generatedFeedback.questions.length}件を生成しました`);
    } catch (error) {
      toast.error('感想・質問生成中にエラーが発生しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsGeneratingFeedback(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    const sessionToDelete = sessions.find(s => s.id === sessionId);
    if (!sessionToDelete) {
      toast.error('セッションが見つかりません');
      return;
    }

    if (sessionToDelete.createdBy !== currentUserId) {
      toast.error('このセッションを削除する権限がありません');
      return;
    }

    const updatedSessions = sessions.filter(s => s.id !== sessionId);

    if (sessionToDelete.isActive && updatedSessions.length > 0) {
      updatedSessions[0].isActive = true;
      setInputHistory(updatedSessions[0].inputs || []);
    } else if (updatedSessions.length === 0) {
      setSessions([]);
      saveSessionsToLocal([]);
      await createNewSession();
      return;
    }

    setSessions(updatedSessions);
    saveSessionsToLocal(updatedSessions);
    setFeedback({ comments: [], questions: [] });
    toast.success('セッションを削除しました');
  };

  const bulkDeleteSessions = async (sessionIds: string[]) => {
    if (sessionIds.length === 0) {
      toast.error('削除するセッションが選択されていません');
      return;
    }

    const sessionsToDelete = sessions.filter(s => sessionIds.includes(s.id));
    const updatedSessions = sessions.filter(s => !sessionIds.includes(s.id));

    const activeSessionWasDeleted = sessionsToDelete.some(s => s.isActive);
    if (activeSessionWasDeleted && updatedSessions.length > 0) {
      const userSessions = updatedSessions.filter(s => s.createdBy === currentUserId);
      if (userSessions.length > 0) {
        userSessions[0].isActive = true;
        setInputHistory(userSessions[0].inputs || []);
      }
    } else if (updatedSessions.filter(s => s.createdBy === currentUserId).length === 0) {
      setSessions(updatedSessions);
      saveSessionsToLocal(updatedSessions);
      await createNewSession();
      return;
    }

    setSessions(updatedSessions);
    saveSessionsToLocal(updatedSessions);
    setFeedback({ comments: [], questions: [] });
    toast.success(`${sessionIds.length}件のセッションを削除しました`);
  };

  const switchSession = (sessionId: string) => {
    const selectedSession = sessions.find(s => s.id === sessionId);
    if (!selectedSession) return;

    if (selectedSession.createdBy === currentUserId) {
      const updatedSessions = sessions.map(s => ({ ...s, isActive: s.id === sessionId }));
      setSessions(updatedSessions);
      setInputHistory(selectedSession.inputs);
      setCurrentInput(selectedSession.draftInput || '');
      setFeedback({ comments: [], questions: [] });
      saveSessionsToLocal(updatedSessions);
    } else {
      setSessions(sessions.map(s => ({ ...s, isActive: false })));
      setInputHistory(selectedSession.inputs);
      setCurrentInput(selectedSession.draftInput || '');
      setFeedback({ comments: [], questions: [] });
      toast.info('他のユーザのセッションを閲覧しています（読み取り専用）');
    }
  };

  const handleSessionUpdate = (updatedSession: Session) => {
    setSessions(sessions.map(s =>
      s.id === updatedSession.id ? updatedSession : s
    ));
    if (updatedSession.isActive) {
      setInputHistory(updatedSession.inputs);
    }
  };

  return (
    <div className="speech-flow-app h-screen overflow-hidden bg-gray-50">
      {/* Header */}
      <header className="speech-flow-header bg-white border-b border-gray-200 px-6 py-0 h-[56px]">
        <div className="flex items-center justify-between h-full gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0 overflow-hidden">
            <h1 className="text-xl whitespace-nowrap shrink-0">スピーチフロー可視化ツール</h1>
            {(supabaseStatus === 'quota_exceeded' || supabaseStatus === 'error') && (
              <span className="text-xs text-amber-600 truncate min-w-0">
                {supabaseStatus === 'quota_exceeded'
                  ? 'Supabaseのデータ転送量超過。データはローカルに保存されます。'
                  : 'Supabaseに接続できません。データはローカルに保存されます。'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Button variant="ghost" size="sm" onClick={() => setIsLogViewerOpen(true)} className="text-xs text-gray-500">
              ログ
            </Button>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={horizontalScroll}
                onChange={(e) => {
                  setHorizontalScroll(e.target.checked);
                  localStorage.setItem('speechflow-horizontal-scroll', String(e.target.checked));
                }}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              横スクロール
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={showPanels}
                onChange={(e) => setShowPanels(e.target.checked)}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              左右パネル表示
            </label>
            <TranscriptionButton
              deepgramApiKey={deepgramApiKey}
              onTranscript={handleTranscript}
              onInterimTranscript={handleInterimTranscript}
              onNewFrame={handleNewFrame}
            />
            <SettingsDialog
              openaiApiKey={openaiApiKey}
              onOpenaiApiKeyChange={handleOpenaiApiKeyChange}
              aiModel={aiModel}
              onAiModelChange={handleAiModelChange}
              deepgramApiKey={deepgramApiKey}
              onDeepgramApiKeyChange={handleDeepgramApiKeyChange}
            />
          </div>
        </div>
      </header>

      <LogViewer
        isOpen={isLogViewerOpen}
        onClose={() => setIsLogViewerOpen(false)}
        supabaseStatus={supabaseStatus}
        onSupabaseStatusChange={setSupabaseStatus}
      />

      <div className="speech-flow-main flex h-[calc(100vh-56px)]">
        {/* Left Sidebar - Session Management */}
        <div className={`speech-flow-sidebar flex-shrink-0 ${showPanels ? 'w-[280px]' : 'w-12'} bg-white border-r border-gray-200 transition-all duration-200`}>
          <SessionManager
            sessions={sessions}
            currentUserId={currentUserId}
            currentViewingSession={currentViewingSession}
            onCreateSession={createNewSession}
            onSwitchSession={switchSession}
            onDeleteSession={deleteSession}
            onBulkDeleteSessions={bulkDeleteSessions}
            isLoading={isLoadingSessions}
            isCreatingSession={isCreatingSession}
            isCompact={!showPanels}
          />
        </div>

        {/* Main Content Area - Flexible width */}
        <div className="speech-flow-content flex-1 min-w-0 flex flex-col">
          {/* Speech Flow Canvas - Only show for own sessions */}
          {!isViewingOtherUserSession && (
            <div className="speech-flow-canvas-container flex-1 min-h-0 bg-white border-b border-gray-200">
              <SpeechFlowCanvas
                nodes={activeSession?.nodes || []}
                currentSession={currentViewingSession || activeSession}
                currentUserId={currentUserId}
                horizontalScroll={horizontalScroll}
              />
            </div>
          )}

          {/* Input Form */}
          <div className={`speech-flow-input-section bg-white p-6 ${isViewingOtherUserSession ? 'flex-1' : ''}`}>
            <TextInputForm
              value={currentInput + interimTranscript}
              onChange={(v) => { setCurrentInput(v); setInterimTranscript(''); }}
              onSubmit={handleAddToFlow}
              inputHistory={inputHistory}
              informationLevel={informationLevel}
              onInformationLevelChange={handleInformationLevelChange}
              nodeQuantity={nodeQuantity}
              onNodeQuantityChange={handleNodeQuantityChange}
              textDensity={textDensity}
              onTextDensityChange={handleTextDensityChange}
              isProcessing={isProcessing}
              isInputDisabled={!activeSession || activeSession.createdBy !== currentUserId}
              userRole={isViewingOtherUserSession ? 'viewer' : null}
            />
          </div>
        </div>

        {/* Right Sidebar - Feedback */}
        {showPanels && (
          <div className="speech-flow-feedback flex-shrink-0 w-[280px] bg-white border-l border-gray-200">
            <FeedbackGenerator
              feedback={feedback}
              onGenerateFeedback={handleGenerateFeedback}
              isGeneratingFeedback={isGeneratingFeedback}
              feedbackTextDensity={feedbackTextDensity}
              onFeedbackTextDensityChange={handleFeedbackTextDensityChange}
              isFeedbackDisabled={false}
            />
          </div>
        )}
      </div>

      <Toaster />
    </div>
  );
}
