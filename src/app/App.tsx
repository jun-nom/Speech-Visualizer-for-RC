import React, { useState, useEffect } from 'react';
import { SpeechFlowCanvas } from './components/SpeechFlowCanvas';
import { TextInputForm, InformationLevel, TextDensity, NodeQuantity } from './components/TextInputForm';
import { SessionManager } from './components/SessionManager';
import { FeedbackGenerator } from './components/FeedbackGenerator';
import { Button } from './components/ui/button';
import { Toaster } from './components/ui/sonner';
import { toast } from 'sonner@2.0.3';
import * as api from './utils/api';
import { SettingsDialog } from './components/SettingsDialog';
import { projectId, publicAnonKey } from './utils/supabase/info';
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
  createdBy: string; // User identifier who created the session
  isPublic: boolean; // Whether the session is visible to other users
}

export default function App() {
  // User ID for session management - CHANGED: Use session-based approach
  // Since Figma Make's localStorage is reset on every reload, we need a different strategy
  const getUserId = (): string => {
    if (typeof window === 'undefined') {
      return 'user-' + Date.now().toString();
    }
    
    try {
      // Try to get from localStorage first
      let storedId = localStorage.getItem('speechflow-user-id');
      
      // Check if localStorage is actually working by testing write
      if (storedId) {
        // Verify localStorage is working by attempting to read it immediately
        const testRead = localStorage.getItem('speechflow-user-id');
        if (testRead === storedId) {
          console.log('✅ LocalStorage is working. Using existing user ID:', storedId);
          return storedId;
        } else {
          console.warn('⚠️ LocalStorage read verification failed');
        }
      }
      
      // If no stored ID or verification failed, check for last active session
      const lastSessionId = sessionStorage.getItem('speechflow-last-session');
      if (lastSessionId) {
        console.log('🔄 Using session-based ID from last active session');
        // We'll determine user ID from the last session they were editing
        // This is a fallback for when localStorage doesn't work
        return 'session-based-' + lastSessionId;
      }
      
      // Create new ID only if none exists
      const newId = 'user-' + Date.now().toString();
      try {
        localStorage.setItem('speechflow-user-id', newId);
        sessionStorage.setItem('speechflow-user-id', newId);
        console.log('✨ Created and stored new user ID:', newId);
      } catch (storageError) {
        console.error('❌ Failed to store user ID:', storageError);
      }
      return newId;
    } catch (error) {
      console.error('Failed to access storage for user ID:', error);
      return 'user-fallback-' + Date.now().toString();
    }
  };

  const currentUserId = getUserId();
  console.log('=== APP INITIALIZATION ===');
  console.log('Current User ID:', currentUserId);
  console.log('LocalStorage test:', (() => {
    try {
      const testKey = 'figma-make-test-' + Date.now();
      localStorage.setItem(testKey, 'test');
      const readValue = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      return readValue === 'test' ? '✅ Working' : '❌ Not Working';
    } catch {
      return '❌ Error';
    }
  })());

  const [sessions, setSessions] = useState<Session[]>([]);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [connectionRetryCount, setConnectionRetryCount] = useState(0);
  
  // Remove empty session cleanup state - no longer needed for periodic checks
  // const [lastEmptySessionCheckTime, setLastEmptySessionCheckTime] = useState<number | null>(null);
  // const [emptySessionCheckPausedUntil, setEmptySessionCheckPausedUntil] = useState<number | null>(null);
  // const [showEmptySessionDialog, setShowEmptySessionDialog] = useState(false);
  // const [emptySessionCount, setEmptySessionCount] = useState(0);

  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [currentInput, setCurrentInput] = useState('');
  const [feedback, setFeedback] = useState<{ comments: string[], questions: string[] }>({ comments: [], questions: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingFeedback, setIsGeneratingFeedback] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);

  // Information level state with localStorage persistence
  const [informationLevel, setInformationLevel] = useState<InformationLevel>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-information-level') as InformationLevel) || 'high';
    }
    return 'high';
  });

  // Node quantity state with localStorage persistence
  const [nodeQuantity, setNodeQuantity] = useState<NodeQuantity>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-node-quantity') as NodeQuantity) || 'medium';
    }
    return 'medium';
  });

  // Text density state with localStorage persistence
  const [textDensity, setTextDensity] = useState<TextDensity>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('speechflow-text-density') as TextDensity) || 'medium';
    }
    return 'medium';
  });

  // Settings state with localStorage persistence using correct Supabase values
  const [openaiApiKey, setOpenaiApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-openai-key') || '';
    }
    return '';
  });
  const [aiModel, setAiModel] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-ai-model') || 'gpt-4o';
    }
    return 'gpt-4o';
  });
  const [supabaseUrl, setSupabaseUrl] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-supabase-url') || `https://${projectId}.supabase.co`;
    }
    return `https://${projectId}.supabase.co`;
  });
  const [supabaseAnonKey, setSupabaseAnonKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('speechflow-supabase-anon-key') || publicAnonKey;
    }
    return publicAnonKey;
  });

  // Information level handler with localStorage persistence
  const handleInformationLevelChange = (level: InformationLevel) => {
    setInformationLevel(level);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-information-level', level);
    }
  };

  const handleNodeQuantityChange = (quantity: NodeQuantity) => {
    setNodeQuantity(quantity);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-node-quantity', quantity);
    }
  };

  // Text density handler with localStorage persistence
  const handleTextDensityChange = (density: TextDensity) => {
    setTextDensity(density);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-text-density', density);
    }
  };

  // Settings handlers with localStorage persistence
  const handleOpenaiApiKeyChange = (key: string) => {
    setOpenaiApiKey(key);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-openai-key', key);
    }
  };

  const handleAiModelChange = (model: string) => {
    setAiModel(model);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-ai-model', model);
    }
  };

  const handleSupabaseUrlChange = (url: string) => {
    setSupabaseUrl(url);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-supabase-url', url);
    }
  };

  const handleSupabaseAnonKeyChange = (key: string) => {
    setSupabaseAnonKey(key);
    if (typeof window !== 'undefined') {
      localStorage.setItem('speechflow-supabase-anon-key', key);
    }
  };

  const activeSession = sessions.find(s => s.isActive);
  
  // Find the currently viewing session (could be active session or other user's session)
  const currentViewingSession = activeSession || sessions.find(s => 
    JSON.stringify(s.inputs) === JSON.stringify(inputHistory)
  );
  
  // Check if viewing other user's session
  const isViewingOtherUserSession = currentViewingSession && currentViewingSession.createdBy !== currentUserId;

  // Connection health check with retry logic
  const checkConnectionHealth = async (retryCount = 0): Promise<boolean> => {
    try {
      await api.checkHealth();
      if (isOfflineMode) {
        setIsOfflineMode(false);
        setConnectionRetryCount(0);
        toast.success('サーバーへの続が復旧しました');
      }
      return true;
    } catch (error) {
      console.warn(`Connection health check failed (attempt ${retryCount + 1}):`, error);
      
      if (retryCount < 2) {
        // Retry up to 3 times with exponential backoff
        const delay = Math.pow(2, retryCount) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        return checkConnectionHealth(retryCount + 1);
      }
      
      if (!isOfflineMode) {
        setIsOfflineMode(true);
        setConnectionRetryCount(retryCount + 1);
        console.error('Server connection failed, switching to offline mode');
      }
      return false;
    }
  };

  // Load sessions with improved error handling
  const loadSessionsWithFallback = async (): Promise<Session[]> => {
    try {
      const isConnected = await checkConnectionHealth();
      if (!isConnected) {
        throw new Error('No server connection');
      }

      const loadedSessions = await api.loadAllSessions();
      console.log('Successfully loaded sessions from server:', loadedSessions.length);
      
      return loadedSessions.map(session => ({
        ...session,
        createdAt: new Date(session.createdAt),
        isActive: session.createdBy === currentUserId ? false : false
      }));
    } catch (error) {
      console.warn('Failed to load sessions from server, using local storage:', error);
      
      // Fallback to local storage
      try {
        const localSessions = localStorage.getItem('speechflow-local-sessions');
        if (localSessions) {
          const parsed = JSON.parse(localSessions);
          return parsed.map((session: any) => ({
            ...session,
            createdAt: new Date(session.createdAt)
          }));
        }
      } catch (localError) {
        console.warn('Failed to load from local storage:', localError);
      }
      
      return [];
    }
  };

  // Save sessions to local storage as backup
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

  // Real-time session sync with offline handling
  useEffect(() => {
    if (isOfflineMode) return; // Skip sync in offline mode

    let syncInterval: NodeJS.Timeout;

    const syncSessions = async () => {
      try {
        const isConnected = await checkConnectionHealth();
        if (!isConnected) return;

        const updatedSessions = await api.loadAllSessions();
        const processedSessions = updatedSessions.map(session => ({
          ...session,
          createdAt: new Date(session.createdAt),
          // Preserve local active state for user's own sessions
          isActive: session.createdBy === currentUserId ? 
            (sessions.find(s => s.id === session.id)?.isActive || false) : 
            false
        }));

        // Update sessions if there are changes
        setSessions(prevSessions => {
          const hasChanges = JSON.stringify(prevSessions.map(s => ({...s, createdAt: s.createdAt.toISOString()}))) !== 
                            JSON.stringify(processedSessions.map(s => ({...s, createdAt: s.createdAt.toISOString()})));
          
          if (hasChanges) {
            console.log('Sessions updated from server');
            
            // Update input history if active session was updated
            const currentActive = prevSessions.find(s => s.isActive);
            const updatedActive = processedSessions.find(s => s.id === currentActive?.id);
            
            if (currentActive && updatedActive && updatedActive.inputs.length !== currentActive.inputs.length) {
              setInputHistory(updatedActive.inputs);
            }
            
            // Save to local storage as backup
            saveSessionsToLocal(processedSessions);
            
            return processedSessions;
          }
          return prevSessions;
        });
      } catch (error) {
        console.warn('Failed to sync sessions:', error);
      }
    };

    // Initial sync and then every 5 seconds (increased from 3 to reduce server load)
    syncInterval = setInterval(syncSessions, 5000);

    return () => {
      if (syncInterval) {
        clearInterval(syncInterval);
      }
    };
  }, [currentUserId, sessions, isOfflineMode]);

  // Load sessions on app start
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoadingSessions(true);
      try {
        console.log('=== LOADING INITIAL DATA ===');
        console.log('Current User ID:', currentUserId);
        
        // Load sessions with fallback
        const loadedSessions = await loadSessionsWithFallback();
        console.log(`✅ Loaded ${loadedSessions.length} sessions from server`);
        
        // Log all loaded sessions for debugging
        loadedSessions.forEach(s => {
          console.log(`Session: ${s.title}, Inputs: ${s.inputs.length}, Nodes: ${s.nodes?.length || 0}, CreatedBy: ${s.createdBy}, CreatedAt: ${s.createdAt}`);
        });
        
        // Delete empty sessions on reload
        const emptySessions = loadedSessions.filter(s => s.inputs.length === 0);
        if (emptySessions.length > 0) {
          console.log(`🗑️ Found ${emptySessions.length} empty sessions on reload, deleting...`);
          const emptySessionIds = emptySessions.map(s => s.id);
          
          let deletedCount = 0;
          if (!isOfflineMode) {
            for (const sessionId of emptySessionIds) {
              try {
                await api.deleteSession(sessionId);
                deletedCount++;
                console.log(`✅ Deleted empty session ${sessionId} (${deletedCount}/${emptySessionIds.length})`);
              } catch (deleteError) {
                console.warn(`⚠️ Failed to delete empty session ${sessionId}:`, deleteError);
              }
            }
            console.log(`✅ Deleted ${deletedCount}/${emptySessionIds.length} empty sessions from server`);
            
            if (deletedCount > 0) {
              toast.success(`リロード時に${deletedCount}件の空セッションを削除しました`);
            }
          }
          
          // Remove empty sessions from loaded sessions
          const nonEmptySessions = loadedSessions.filter(s => s.inputs.length > 0);
          loadedSessions.length = 0;
          loadedSessions.push(...nonEmptySessions);
          
          console.log(`📊 After cleanup: ${loadedSessions.length} sessions remaining`);
        }
        
        // Select the appropriate session
        if (loadedSessions.length > 0) {
          // Find user's sessions and sort by createdAt (newest first)
          const userSessions = loadedSessions
            .filter(s => s.createdBy === currentUserId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
          
          console.log(`👤 Current user has ${userSessions.length} sessions`);
          
          if (userSessions.length > 0) {
            // Select the newest session
            const newestSession = userSessions[0];
            newestSession.isActive = true;
            setInputHistory(newestSession.inputs || []);
            setSessions(loadedSessions);
            saveSessionsToLocal(loadedSessions);
            console.log(`✨ Selected newest session: ${newestSession.title} (${newestSession.createdAt})`);
          } else {
            // Create new session if current user has no sessions
            console.log('📝 Current user has no sessions, creating new one...');
            setSessions(loadedSessions);
            saveSessionsToLocal(loadedSessions);
            
            // Create and activate new session
            const newSession: Session = {
              id: Date.now().toString(),
              title: new Date().toLocaleString('ja-JP').replace(/[\\/\\s]/g, '/'),
              createdAt: new Date(),
              isActive: true,
              inputs: [],
              nodes: [],
              createdBy: currentUserId,
              isPublic: true
            };
            
            const updatedSessions = [...loadedSessions, newSession];
            setSessions(updatedSessions);
            setInputHistory([]);
            setFeedback({ comments: [], questions: [] });
            saveSessionsToLocal(updatedSessions);
            
            // Try to save new session to database if not in offline mode
            if (!isOfflineMode) {
              try {
                await api.saveSession(newSession);
                console.log('✅ Created and saved new session:', newSession.title);
              } catch (saveError) {
                console.warn('Failed to save session to server, continuing locally:', saveError);
              }
            }
          }
        } else {
          // No sessions exist - create new one
          console.log('📝 No sessions exist, creating new one...');
          await createNewSession();
        }

        if (isOfflineMode) {
          toast.info('オフラインモードで動作しています。一部機能が制限されます。');
        }
        
      } catch (error) {
        console.error('Failed to load initial data:', error);
        
        if (!isOfflineMode) {
          setIsOfflineMode(true);
          toast.error('サーバーへの接続に失敗しました。オフラインモードで動作します。');
        }
        
        // Create default session if all else fails
        const defaultSession: Session = {
          id: 'default-' + Date.now().toString(),
          title: new Date().toLocaleString('ja-JP').replace(/[\\/\\s]/g, '/'),
          createdAt: new Date(),
          isActive: true,
          inputs: [],
          nodes: [],
          createdBy: currentUserId,
          isPublic: true
        };
        setSessions([defaultSession]);
        saveSessionsToLocal([defaultSession]);
      } finally {
        setIsLoadingSessions(false);
      }
    };

    loadInitialData();
  }, [currentUserId]);

  const handleAddToFlow = async (text: string, informationLevel: InformationLevel) => {
    if (!text.trim() || !activeSession || isProcessing) return;

    setIsProcessing(true);
    
    try {
      // Add to input history
      const newHistory = [...inputHistory, text];
      setInputHistory(newHistory);

      // Update session with new input
      const updatedSessions = sessions.map(session => 
        session.isActive 
          ? { ...session, inputs: [...session.inputs, text] }
          : session
      );
      setSessions(updatedSessions);

      // Process text with OpenAI API - pass number of unique topics rather than total nodes
      const uniqueTopicIds = new Set(activeSession.nodes.map(node => node.topicId));
      const existingTopicCount = uniqueTopicIds.size;
      
      let newNodes: FlowNode[];
      
      try {
        newNodes = await api.processTextToNodes(text, existingTopicCount, activeSession.id, informationLevel, nodeQuantity, textDensity);
        
        // Filter out insight nodes that contain "追加の分析が必要です"
        newNodes = newNodes.filter(node => {
          if (node.type === 'insight' && node.content === '追加の分析が必要です') {
            console.log('Filtering out "追加の分析が必要です" insight node:', node.id);
            return false;
          }
          return true;
        });
        
      } catch (apiError) {
        console.warn('API call failed:', apiError);
        const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';

        if (errorMessage === 'API_KEY_UNAVAILABLE') {
          toast.error('APIキーを設定してください');
          return;
        }

        if (errorMessage.toLowerCase().includes('rate limit') || isOfflineMode) {
          newNodes = await api.generateFallbackNodes(text, existingTopicCount);
          if (isOfflineMode) {
            toast.info('オフラインモードで基本処理を実行しました');
          } else {
            toast.error('OpenAI APIのレート制限に達しました。しばらくしてから再試行してください。');
          }
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

      // Save session to database if not in offline mode
      const sessionToSave = updatedSessionsWithNodes.find(s => s.isActive);
      if (sessionToSave && !isOfflineMode) {
        try {
          await api.saveSession(sessionToSave);
        } catch (saveError) {
          console.warn('Failed to save session to server, continuing locally:', saveError);
        }
      }

      setCurrentInput('');
      toast.success('スピーチフローに追加しました');

    } catch (error) {
      console.error('Error adding to flow:', error);
      toast.error('処理中にエラーが発生しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateFeedback = async () => {
    console.log('=== FEEDBACK GENERATION DEBUG START ===');
    console.log('activeSession:', activeSession?.id);
    console.log('inputHistory length:', inputHistory.length);
    console.log('inputHistory contents:', inputHistory);
    console.log('isGeneratingFeedback:', isGeneratingFeedback);
    console.log('sessions count:', sessions.length);
    console.log('isOfflineMode:', isOfflineMode);
    
    // Check if already generating feedback
    if (isGeneratingFeedback) {
      console.log('Already generating feedback, aborting');
      toast.info('感想・質問を生成中です。しばらくお待ちください。');
      return;
    }

    // Find the current session for feedback generation
    let currentSession = activeSession;
    
    // If no active session, try to find the session that matches current input history
    if (!currentSession) {
      currentSession = sessions.find(s => {
        // Use array comparison based on content, not reference
        return s.inputs.length === inputHistory.length && 
               s.inputs.every((input, index) => input === inputHistory[index]);
      });
      console.log('Found session by input history match:', currentSession?.id);
    }

    // If still no session and we're viewing another user's session, use the viewing session
    if (!currentSession && currentViewingSession) {
      currentSession = currentViewingSession;
      console.log('Using current viewing session:', currentSession.id);
    }

    console.log('Final currentSession:', currentSession?.id);

    // Check if we have inputs to generate feedback from
    if (inputHistory.length === 0) {
      console.log('No input history available');
      toast.info('感想・質問を生成するためのテキストがありません。まずスピーチ内容を入力してください。');
      return;
    }

    if (!currentSession) {
      console.log('No session found for feedback generation');
      toast.error('セッションが見つかりません。ページを再読み込みしてください。');
      return;
    }

    console.log('Starting feedback generation...');
    setIsGeneratingFeedback(true);
    
    try {
      let generatedFeedback: { comments: string[], questions: string[] };
      
      try {
        console.log('Calling API generateFeedback with inputs:', inputHistory);
        generatedFeedback = await api.generateFeedback(inputHistory);
        console.log('API response received:', generatedFeedback);
      } catch (apiError) {
        console.warn('Feedback API call failed, using fallback:', apiError);
        
        const errorMessage = (apiError instanceof Error ? apiError.message : 'Unknown error').toLowerCase();
        
        if (errorMessage.includes('openai') || errorMessage.includes('api key') || errorMessage.includes('rate limit') || isOfflineMode) {
          // Use local fallback when OpenAI API is having issues or in offline mode
          generatedFeedback = api.generateFallbackFeedback(inputHistory);
          if (isOfflineMode) {
            toast.info('オフラインモードで基本的な感想・質問を生成しました');
          } else {
            toast.error('OpenAI APIに接続できません。基本的な感想・質問を表示します。');
          }
        } else {
          throw apiError;
        }
      }
      
      console.log('Setting feedback:', generatedFeedback);
      setFeedback(generatedFeedback);
      toast.success(`感想${generatedFeedback.comments.length}件と質問${generatedFeedback.questions.length}件を生成しました`);

    } catch (error) {
      console.error('Error generating feedback:', error);
      toast.error('感想・質問生成中にエラーが発生しました: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsGeneratingFeedback(false);
      console.log('=== FEEDBACK GENERATION DEBUG END ===');
    }
  };

  const createNewSession = async () => {
    if (isCreatingSession) return; // 重複実行を防ぐ
    
    setIsCreatingSession(true);
    try {
      const newSession: Session = {
        id: Date.now().toString(),
        title: new Date().toLocaleString('ja-JP').replace(/[\/\s]/g, '/'),
        createdAt: new Date(),
        isActive: false,
        inputs: [],
        nodes: [],
        createdBy: currentUserId,
        isPublic: true
      };
      
      const updatedSessions = sessions.map(s => ({ ...s, isActive: false }));
      const newSessions = [...updatedSessions, { ...newSession, isActive: true }];
      setSessions(newSessions);
      setInputHistory([]);
      setFeedback({ comments: [], questions: [] });
      saveSessionsToLocal(newSessions);

      // Try to save new session to database if not in offline mode
      if (!isOfflineMode) {
        try {
          await api.saveSession({ ...newSession, isActive: true });
          toast.success('新しいセッションを作成しました');
        } catch (saveError) {
          console.warn('Failed to save session to server, continuing locally:', saveError);
          toast.success('新しいセッションを作成しました（ローカル保存）');
        }
      } else {
        toast.success('新しいセッションを作成しました（オフライン）');
      }

    } catch (error) {
      console.error('Error creating new session:', error);
      toast.error('セッション作成中にエラーが発生しました');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const sessionToDelete = sessions.find(s => s.id === sessionId);
      if (!sessionToDelete) {
        toast.error('セッションが見つかりません');
        return;
      }

      // Check if user has permission to delete
      if (sessionToDelete.createdBy !== currentUserId) {
        toast.error('このセッションを削除する権限がありません');
        return;
      }

      // Try to delete from database if not in offline mode
      if (!isOfflineMode) {
        try {
          await api.deleteSession(sessionId);
        } catch (deleteError) {
          console.warn('Failed to delete session from server, continuing locally:', deleteError);
        }
      }

      // Remove from local state regardless of server success
      const updatedSessions = sessions.filter(s => s.id !== sessionId);
      
      // If deleted session was active, activate another session
      if (sessionToDelete.isActive && updatedSessions.length > 0) {
        updatedSessions[0].isActive = true;
        setInputHistory(updatedSessions[0].inputs || []);
      } else if (updatedSessions.length === 0) {
        // Create new session if no sessions left
        await createNewSession();
        return;
      }

      setSessions(updatedSessions);
      saveSessionsToLocal(updatedSessions);
      setFeedback({ comments: [], questions: [] });
      toast.success('セッションを削除しました');

    } catch (error) {
      console.error('Error deleting session:', error);
      toast.error('セッション削除中にエラーが発生しました');
    }
  };

  const bulkDeleteSessions = async (sessionIds: string[]) => {
    try {
      if (sessionIds.length === 0) {
        toast.error('削除するセッションが選択されていません');
        return;
      }

      console.log(`🗑️ Starting bulk delete for ${sessionIds.length} sessions...`);
      
      // Delete sessions one by one (more reliable than bulk endpoint)
      let deletedCount = 0;
      if (!isOfflineMode) {
        for (const sessionId of sessionIds) {
          try {
            await api.deleteSession(sessionId);
            deletedCount++;
            console.log(`✅ Deleted session ${sessionId} (${deletedCount}/${sessionIds.length})`);
          } catch (deleteError) {
            console.warn(`⚠️ Failed to delete session ${sessionId}:`, deleteError);
            // Continue with next session even if one fails
          }
        }
        console.log(`✅ Successfully deleted ${deletedCount}/${sessionIds.length} sessions from server`);
      } else {
        deletedCount = sessionIds.length;
        console.log(`📴 Offline mode: marking ${deletedCount} sessions as deleted locally`);
      }

      // Get the sessions being deleted
      const sessionsToDelete = sessions.filter(s => sessionIds.includes(s.id));

      // Remove from local state regardless of server success
      const updatedSessions = sessions.filter(s => !sessionIds.includes(s.id));
      
      // If active session was deleted, activate another session
      const activeSessionWasDeleted = sessionsToDelete.some(s => s.isActive);
      if (activeSessionWasDeleted && updatedSessions.length > 0) {
        const userSessions = updatedSessions.filter(s => s.createdBy === currentUserId);
        if (userSessions.length > 0) {
          userSessions[0].isActive = true;
          setInputHistory(userSessions[0].inputs || []);
        }
      } else if (updatedSessions.filter(s => s.createdBy === currentUserId).length === 0) {
        // Create new session if no user sessions left
        await createNewSession();
        return;
      }

      setSessions(updatedSessions);
      saveSessionsToLocal(updatedSessions);
      setFeedback({ comments: [], questions: [] });
      
      if (deletedCount > 0) {
        toast.success(`${deletedCount}件のセッションを削除しました`);
      } else {
        toast.error('セッションの削除に失敗しました');
      }

    } catch (error) {
      console.error('Error bulk deleting sessions:', error);
      toast.error('セッション一括削除中にエラーが発生しました');
    }
  };

  const switchSession = async (sessionId: string) => {
    try {
      // Save current session if it has data and not in offline mode
      const currentActiveSession = sessions.find(s => s.isActive);
      if (currentActiveSession && (currentActiveSession.inputs.length > 0 || currentActiveSession.nodes.length > 0) && !isOfflineMode) {
        try {
          await api.saveSession(currentActiveSession);
        } catch (saveError) {
          console.warn('Failed to save current session to server, continuing locally:', saveError);
        }
      }

      // Load the selected session
      const selectedSession = sessions.find(s => s.id === sessionId);
      if (selectedSession) {
        // Only user's own sessions can be active for editing
        if (selectedSession.createdBy === currentUserId) {
          const updatedSessions = sessions.map(s => ({ ...s, isActive: s.id === sessionId }));
          setSessions(updatedSessions);
          setInputHistory(selectedSession.inputs);
          setFeedback({ comments: [], questions: [] });
          saveSessionsToLocal(updatedSessions);
        } else {
          // For other users' sessions, just view them without making them active
          setSessions(sessions.map(s => ({ ...s, isActive: s.createdBy === currentUserId ? false : false })));
          setInputHistory(selectedSession.inputs);
          setFeedback({ comments: [], questions: [] });
          toast.info('他のユーザのセッションを閲覧しています（読み取り専用）');
        }
      }

    } catch (error) {
      console.error('Error switching session:', error);
      toast.error('セッション切り替え中にエラーが発生しました');
    }
  };

  // Collaboration handlers
  const handleSessionUpdate = (updatedSession: Session) => {
    setSessions(sessions.map(s => 
      s.id === updatedSession.id ? updatedSession : s
    ));
    if (updatedSession.isActive) {
      setInputHistory(updatedSession.inputs);
    }
  };

  return (
    <div className="speech-flow-app min-h-screen bg-gray-50">
      {/* Header */}
      <header className="speech-flow-header bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl">スピーチフロー可視化ツール</h1>
            <div className="flex items-center gap-2">
              <p className="text-sm text-gray-600">リアルタイムでスピーチ内容をトピック単位に可視化し、感想・質問を生成します</p>
              {isOfflineMode && (
                <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">
                  オフライン
                </span>
              )}
            </div>
          </div>
          <div className="flex-shrink-0">
            <SettingsDialog
              openaiApiKey={openaiApiKey}
              onOpenaiApiKeyChange={handleOpenaiApiKeyChange}
              aiModel={aiModel}
              onAiModelChange={handleAiModelChange}
              supabaseUrl={supabaseUrl}
              onSupabaseUrlChange={handleSupabaseUrlChange}
              supabaseAnonKey={supabaseAnonKey}
              onSupabaseAnonKeyChange={handleSupabaseAnonKeyChange}
            />
          </div>
        </div>
      </header>

      <div className="speech-flow-main flex h-[calc(100vh-80px)]">
        {/* Left Sidebar - Session Management - Fixed 280px */}
        <div className="speech-flow-sidebar flex-shrink-0 w-[280px] bg-white border-r border-gray-200">
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
          />
        </div>

        {/* Main Content Area - Flexible width */}
        <div className="speech-flow-content flex-1 min-w-0 flex flex-col">
          {/* Speech Flow Canvas - Only show for own sessions */}
          {!isViewingOtherUserSession && (
            <div className="speech-flow-canvas-container flex-1 bg-white border-b border-gray-200">
              <SpeechFlowCanvas 
                nodes={activeSession?.nodes || []} 
                currentSession={currentViewingSession || activeSession}
                currentUserId={currentUserId}
              />
            </div>
          )}

          {/* Input Form */}
          <div className={`speech-flow-input-section bg-white p-6 ${isViewingOtherUserSession ? 'flex-1' : ''}`}>
            <TextInputForm
              value={currentInput}
              onChange={setCurrentInput}
              onSubmit={handleAddToFlow}
              onGenerateFeedback={handleGenerateFeedback}
              inputHistory={inputHistory}
              informationLevel={informationLevel}
              onInformationLevelChange={handleInformationLevelChange}
              nodeQuantity={nodeQuantity}
              onNodeQuantityChange={handleNodeQuantityChange}
              textDensity={textDensity}
              onTextDensityChange={handleTextDensityChange}
              isProcessing={isProcessing}
              isGeneratingFeedback={isGeneratingFeedback}
              isInputDisabled={!activeSession || activeSession.createdBy !== currentUserId}
              isFeedbackDisabled={false}
              userRole={isViewingOtherUserSession ? 'viewer' : null}
            />
          </div>
        </div>

        {/* Right Sidebar - Feedback - Fixed 280px */}
        <div className="speech-flow-feedback flex-shrink-0 w-[280px] bg-white border-l border-gray-200">
          <FeedbackGenerator feedback={feedback} />
        </div>
      </div>

      <Toaster />
    </div>
  );
}