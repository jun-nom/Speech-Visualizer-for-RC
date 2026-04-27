import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Session } from '../App';
import * as api from '../utils/api';
import { toast } from 'sonner@2.0.3';
import { ChevronDown, ChevronRight, Trash2, RefreshCw } from 'lucide-react';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
  supabaseStatus: api.SupabaseStatus | null;
  onSupabaseStatusChange: (status: api.SupabaseStatus) => void;
}

export function LogViewer({ isOpen, onClose, supabaseStatus, onSupabaseStatusChange }: LogViewerProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loadSessions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.loadAllSessionsFromSupabase();
      setSessions(data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
    } catch (err: any) {
      if (err?.isQuotaExceeded) {
        onSupabaseStatusChange('quota_exceeded');
        setError('Supabaseのデータ転送量超過のため読み込めません。');
      } else {
        setError('ログの読み込みに失敗しました。');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadSessions();
  }, [isOpen]);

  const handleCleanup = async () => {
    setIsCleaning(true);
    try {
      const result = await api.cleanupDummySessions();
      toast.success(`${result.deletedCount}件の空セッションを削除しました`);
      await loadSessions();
    } catch (err: any) {
      if (err?.isQuotaExceeded) onSupabaseStatusChange('quota_exceeded');
      toast.error('クリーンアップに失敗しました');
    } finally {
      setIsCleaning(false);
    }
  };

  const handleDelete = async (sessionId: string) => {
    try {
      await api.deleteSessionFromSupabase(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      toast.success('ログを削除しました');
    } catch (err: any) {
      if (err?.isQuotaExceeded) onSupabaseStatusChange('quota_exceeded');
      toast.error('削除に失敗しました');
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>ログ</DialogTitle>
        </DialogHeader>

        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {isLoading ? '読み込み中...' : `${sessions.length}件のセッション`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadSessions} disabled={isLoading}>
              <RefreshCw className="w-3 h-3 mr-1" />
              更新
            </Button>
            <Button variant="outline" size="sm" onClick={handleCleanup} disabled={isCleaning || isLoading}>
              クリーンアップ
            </Button>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded p-2">{error}</p>
        )}

        <div className="overflow-y-auto flex-1 space-y-2 pr-1">
          {!isLoading && !error && sessions.length === 0 && (
            <p className="text-sm text-gray-500 py-4 text-center">ログがありません</p>
          )}

          {sessions.map(session => {
            const isExpanded = expandedIds.has(session.id);
            return (
              <div key={session.id} className="border rounded-md overflow-hidden">
                <div
                  className="flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50"
                  onClick={() => toggleExpand(session.id)}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    }
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{session.title}</div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {session.createdAt.toLocaleString('ja-JP')}
                        {' · '}入力 {session.inputs.length}件
                        {' · '}ノード {session.nodes.length}件
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-shrink-0 ml-2 text-gray-400 hover:text-red-500"
                    onClick={(e) => { e.stopPropagation(); handleDelete(session.id); }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                {isExpanded && session.inputs.length > 0 && (
                  <div className="border-t px-3 py-2 bg-gray-50 space-y-1">
                    {session.inputs.map((input, i) => (
                      <div key={i} className="text-xs text-gray-700 bg-white rounded border px-2 py-1.5">
                        {input}
                      </div>
                    ))}
                  </div>
                )}

                {isExpanded && session.inputs.length === 0 && (
                  <div className="border-t px-3 py-2 bg-gray-50">
                    <p className="text-xs text-gray-400">入力なし</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
