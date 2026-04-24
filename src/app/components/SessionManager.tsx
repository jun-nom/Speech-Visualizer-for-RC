import React, { useState } from 'react';
import { Button } from './ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';
import { Plus, Circle, Trash2, User, Users, Loader2 } from 'lucide-react';
import { Session } from '../App';
import { Checkbox } from './ui/checkbox';
import { ScrollArea } from './ui/scroll-area';

interface SessionManagerProps {
  sessions: Session[];
  currentUserId: string;
  currentViewingSession?: Session | null;
  onCreateSession: () => void;
  onSwitchSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onBulkDeleteSessions?: (sessionIds: string[]) => void;
  isLoading?: boolean;
  isCreatingSession?: boolean;
}

export function SessionManager({ 
  sessions, 
  currentUserId,
  currentViewingSession,
  onCreateSession, 
  onSwitchSession, 
  onDeleteSession,
  onBulkDeleteSessions,
  isLoading = false,
  isCreatingSession = false 
}: SessionManagerProps) {
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isCleanupDialogOpen, setIsCleanupDialogOpen] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [isDeletingEmpty, setIsDeletingEmpty] = useState(false);
  
  // Group sessions by ownership and activity
  const mySessions = sessions
    .filter(s => s.createdBy === currentUserId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const othersSessions = sessions
    .filter(s => s.createdBy !== currentUserId && s.isPublic)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  const handleDeleteClick = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingSessionId(sessionId);
  };

  const confirmDelete = () => {
    if (deletingSessionId) {
      onDeleteSession(deletingSessionId);
      setDeletingSessionId(null);
    }
  };

  const handleBulkDelete = () => {
    if (onBulkDeleteSessions) {
      onBulkDeleteSessions(Array.from(selectedSessionIds));
      setSelectedSessionIds(new Set());
      setIsCleanupDialogOpen(false);
    }
  };

  const toggleSessionSelection = (sessionId: string) => {
    const newSet = new Set(selectedSessionIds);
    if (newSet.has(sessionId)) {
      newSet.delete(sessionId);
    } else {
      newSet.add(sessionId);
    }
    setSelectedSessionIds(newSet);
  };

  const selectAllSessions = () => {
    const allIds = sessions.map(s => s.id);
    setSelectedSessionIds(new Set(allIds));
  };

  const deselectAllSessions = () => {
    setSelectedSessionIds(new Set());
  };

  // Delete empty sessions (inputs.length === 0)
  const handleDeleteEmptySessions = async () => {
    setIsDeletingEmpty(true);
    
    const emptySessions = sessions.filter(s => s.inputs.length === 0);
    
    if (emptySessions.length === 0) {
      alert('削除する空のセッションがありません');
      setIsDeletingEmpty(false);
      return;
    }
    
    const emptySessionIds = emptySessions.map(s => s.id);
    
    if (onBulkDeleteSessions) {
      await onBulkDeleteSessions(emptySessionIds);
    }
    
    setIsDeletingEmpty(false);
  };

  if (isLoading) {
    return (
      <div className="session-manager h-full flex flex-col">
        <div className="session-manager-header p-4 border-b border-gray-200">
          <Button disabled className="w-full bg-black text-white">
            <Plus className="w-4 h-4 mr-2" />
            新規セッション
          </Button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">セッション読み込み中...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="session-manager h-full flex flex-col">
      {/* Header */}
      <div className="session-manager-header p-4 border-b border-gray-200">
        <Button 
          onClick={onCreateSession} 
          disabled={isCreatingSession}
          className="w-full bg-black text-white"
        >
          {isCreatingSession ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <Plus className="w-4 h-4 mr-2" />
          )}
          {isCreatingSession ? 'セッション作成中...' : '新規セッション'}
        </Button>
      </div>

      {/* Tabs for My Sessions and Others' Sessions */}
      <div className="session-tabs flex-1 overflow-hidden">
        <Tabs defaultValue="my-sessions" className="h-full flex flex-col">
          <TabsList className="grid w-full grid-cols-2 mx-4 mt-4">
            <TabsTrigger value="my-sessions" className="flex items-center gap-2">
              <User className="w-4 h-4" />
              自分のセッション
            </TabsTrigger>
            <TabsTrigger value="others-sessions" className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              他のユーザー
            </TabsTrigger>
          </TabsList>

          <TabsContent value="my-sessions" className="flex-1 overflow-y-auto mt-0 px-4 pb-4">
            <div className="space-y-2 mt-4">
              {mySessions.map((session) => (
                <SessionItem
                  key={session.id}
                  session={session}
                  currentUserId={currentUserId}
                  isActive={session.isActive}
                  onClick={() => onSwitchSession(session.id)}
                  onDelete={(e) => handleDeleteClick(session.id, e)}
                />
              ))}
              {mySessions.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-8">
                  セッションがありません
                  <br />
                  「新規セッション」ボタンで作成してください
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="others-sessions" className="flex-1 overflow-y-auto mt-0 px-4 pb-4">
            <div className="space-y-2 mt-4">
              {othersSessions.map((session) => {
                const isCurrentlyViewing = currentViewingSession && currentViewingSession.id === session.id;
                return (
                  <SessionItem
                    key={session.id}
                    session={session}
                    currentUserId={currentUserId}
                    isActive={false}
                    isViewing={isCurrentlyViewing}
                    onClick={() => onSwitchSession(session.id)}
                    onDelete={null}
                  />
                );
              })}
              {othersSessions.length === 0 && (
                <div className="text-xs text-gray-500 text-center py-8">
                  他のユーザーのセッションがありません
                  <br />
                  他のユーザーがセッションを作成すると表示されます
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Session Info */}
      <div className="session-info p-4 border-t border-gray-200 text-xs text-gray-500">
        タブを切り替えてセッションを確認できます。
        <br />
        他のユーザーのセッションは読み取り専用です。
        <br />
        <button 
          onClick={() => setIsCleanupDialogOpen(true)}
          className="text-xs text-blue-600 hover:text-blue-800 underline mt-1 cursor-pointer"
        >
          セッションをクリーンアップ
        </button>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingSessionId} onOpenChange={() => setDeletingSessionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>セッションを削除しますか?</AlertDialogTitle>
            <AlertDialogDescription>
              この操作は取り消せません。セッションとその中のすべてのデータが永久に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingSessionId(null)}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              削除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={isCleanupDialogOpen} onOpenChange={(open) => {
        setIsCleanupDialogOpen(open);
        if (!open) {
          setSelectedSessionIds(new Set());
        }
      }}>
        <AlertDialogContent className="!w-[80vw] !max-w-[80vw] h-[90vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>セッションをクリーンアップ</AlertDialogTitle>
            <AlertDialogDescription>
              削除したいセッションを選択してください。選択したセッションとその中のすべてのデータが永久に削除されます。
            </AlertDialogDescription>
          </AlertDialogHeader>
          
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex justify-between items-center mb-2 flex-shrink-0">
              <span className="text-sm text-gray-600">
                {selectedSessionIds.size > 0 ? `${selectedSessionIds.size}件のセッションが選択されています` : 'セッションを選択してください'}
              </span>
              <div className="space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={selectAllSessions}
                  disabled={sessions.length === 0}
                >
                  全て選択
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={deselectAllSessions}
                  disabled={selectedSessionIds.size === 0}
                >
                  選択解除
                </Button>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 border rounded-md overflow-auto">
              <div className="p-4">
                <div className="space-y-1">
                  {sessions
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map((session) => {
                    const isOwner = session.createdBy === currentUserId;
                    const creatorLabel = isOwner ? '自分' : `${session.createdBy?.slice(-8) || 'Unknown'}`;
                    const firstInputPreview = session.inputs.length > 0 
                      ? session.inputs[0].slice(0, 30) + (session.inputs[0].length > 30 ? '...' : '')
                      : '（入力なし）';
                    return (
                      <div
                        key={session.id}
                        onClick={() => toggleSessionSelection(session.id)}
                        className={`p-2 rounded border cursor-pointer transition-colors ${
                          selectedSessionIds.has(session.id)
                            ? 'bg-red-50 border-red-300'
                            : 'bg-white border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-[800px]">
                          <Checkbox
                            checked={selectedSessionIds.has(session.id)}
                            onCheckedChange={() => toggleSessionSelection(session.id)}
                          />
                          <div className="flex-1 min-w-0 flex items-center gap-4">
                            <div className="text-sm font-medium truncate w-[180px]">{session.title}</div>
                            <div className="text-xs text-gray-500 w-[80px]">
                              {creatorLabel}
                              {!isOwner && (
                                <span className="ml-1 text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded">
                                  他
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 w-[140px]">
                              入力: {session.inputs.length} / ノード: {session.nodes?.length || 0}
                            </div>
                            <div className="text-xs text-gray-600 flex-1 truncate">
                              💬 {firstInputPreview}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {sessions.length === 0 && (
                    <div className="text-center text-sm text-gray-500 py-8">
                      削除可能なセッションがありません
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setIsCleanupDialogOpen(false);
              setSelectedSessionIds(new Set());
            }}>
              キャンセル
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleBulkDelete} 
              className="bg-red-600 hover:bg-red-700"
              disabled={selectedSessionIds.size === 0}
            >
              {selectedSessionIds.size > 0 ? `${selectedSessionIds.size}件削除` : '削除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SessionItemProps {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  onDelete?: ((e: React.MouseEvent) => void) | null;
  currentUserId?: string;
  isViewing?: boolean;
}

function SessionItem({ session, isActive, onClick, onDelete, currentUserId, isViewing }: SessionItemProps) {
  const isOwner = currentUserId && session.createdBy === currentUserId;
  const creatorInfo = isOwner ? '自分' : `${session.createdBy?.slice(-8) || 'Unknown'}`;

  return (
    <div
      onClick={onClick}
      className={`session-item p-3 rounded-lg border cursor-pointer transition-colors relative group ${
        isActive 
          ? 'bg-green-50 border-green-200' 
          : isViewing
          ? 'bg-blue-50 border-blue-200'
          : 'bg-white border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Circle className={`w-2 h-2 flex-shrink-0 ${
            isActive 
              ? 'fill-green-500 text-green-500' 
              : isViewing 
              ? 'fill-blue-500 text-blue-500'
              : 'fill-gray-400 text-gray-400'
          }`} />
          <span className="text-sm truncate">{session.title}</span>
          {isActive && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded flex-shrink-0">
              アクティブ
            </span>
          )}
          {isViewing && !isActive && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded flex-shrink-0">
              閲覧中
            </span>
          )}
        </div>
        {onDelete && isOwner && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 transition-opacity h-6 w-6 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
            title="セッションを削除"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>
      
      <div className="text-xs text-gray-500">
        <div>作成者: {creatorInfo}</div>
        <div>作成: {session.createdAt.toLocaleString('ja-JP')}</div>
        <div>入力数: {session.inputs.length} / ノード数: {session.nodes?.length || 0}</div>
      </div>
      
      {session.inputs.length > 0 && (
        <div className="mt-2 text-xs text-gray-600">
          <div className="truncate">
            💬 最新: {session.inputs[session.inputs.length - 1]?.slice(0, 30)}
            {session.inputs[session.inputs.length - 1]?.length > 30 ? '...' : ''}
          </div>
        </div>
      )}
    </div>
  );
}