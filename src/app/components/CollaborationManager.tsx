import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Users, Share2, UserPlus, Copy, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner@2.0.3';
import { Session } from '../App';
import { 
  RealtimeCollaboration, 
  CollaborationSession, 
  CollaborationParticipant,
  RealtimeSessionUpdate 
} from '../utils/supabase/realtime';

interface CollaborationManagerProps {
  currentSession: Session | undefined;
  onSessionUpdate: (session: Session) => void;
  onFeedbackRequest: () => void;
  isInputDisabled: boolean;
  isFeedbackDisabled: boolean;
}

export function CollaborationManager({ 
  currentSession, 
  onSessionUpdate, 
  onFeedbackRequest,
  isInputDisabled,
  isFeedbackDisabled
}: CollaborationManagerProps) {
  const [collaborationSession, setCollaborationSession] = useState<CollaborationSession | null>(null);
  const [participants, setParticipants] = useState<CollaborationParticipant[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [realtime] = useState(() => new RealtimeCollaboration());
  
  // Dialog states
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isJoinDialogOpen, setIsJoinDialogOpen] = useState(false);
  
  // Form states
  const [ownerName, setOwnerName] = useState('');
  const [participantName, setParticipantName] = useState('');
  const [shareCode, setShareCode] = useState('');
  const [selectedRole, setSelectedRole] = useState<'input' | 'feedback' | 'viewer'>('feedback');

  useEffect(() => {
    return () => {
      realtime.unsubscribeFromSession();
    };
  }, [realtime]);

  const handleCreateCollaboration = async () => {
    if (!currentSession || !ownerName.trim()) {
      toast.error('セッション名を入力してください');
      return;
    }

    try {
      const collabSession = await realtime.createCollaborationSession(currentSession, ownerName.trim());
      setCollaborationSession(collabSession);
      setParticipants(collabSession.participants);
      setIsConnected(true);

      // Subscribe to real-time updates
      realtime.subscribeToSession(collabSession.id, {
        onSessionUpdate: handleSessionUpdate,
        onParticipantsUpdate: setParticipants
      });

      setIsCreateDialogOpen(false);
      setOwnerName('');
      toast.success(`協業セッションを作成しました。共有コード: ${collabSession.shareCode}`);
    } catch (error) {
      console.error('Error creating collaboration session:', error);
      toast.error('協業セッションの作成に失敗しました');
    }
  };

  const handleJoinCollaboration = async () => {
    if (!shareCode.trim() || !participantName.trim()) {
      toast.error('共有コードと名前を入力してください');
      return;
    }

    try {
      const collabSession = await realtime.joinCollaborationSession(
        shareCode.trim().toUpperCase(), 
        participantName.trim(), 
        selectedRole
      );

      if (!collabSession) {
        toast.error('無効な共有コードです');
        return;
      }

      setCollaborationSession(collabSession);
      setParticipants(collabSession.participants);
      setIsConnected(true);

      // Update current session with the collaboration session data
      onSessionUpdate(collabSession.sessionData);

      // Subscribe to real-time updates
      realtime.subscribeToSession(collabSession.id, {
        onSessionUpdate: handleSessionUpdate,
        onParticipantsUpdate: setParticipants
      });

      setIsJoinDialogOpen(false);
      setShareCode('');
      setParticipantName('');
      toast.success('協業セッションに参加しました');
    } catch (error) {
      console.error('Error joining collaboration session:', error);
      toast.error('協業セッションへの参加に失敗しました');
    }
  };

  const handleSessionUpdate = (update: RealtimeSessionUpdate) => {
    if (update.type === 'session_update' && update.data.session) {
      onSessionUpdate(update.data.session);
      toast.success('セッションが更新されました');
    } else if (update.type === 'feedback_generated') {
      toast.success('感想・質問が生成されました');
    }
  };

  const handleCopyShareCode = async () => {
    if (!collaborationSession) return;

    try {
      await navigator.clipboard.writeText(collaborationSession.shareCode);
      toast.success('共有コードをコピーしました');
    } catch (error) {
      toast.error('コピーに失敗しました');
    }
  };

  const handleDisconnect = () => {
    realtime.unsubscribeFromSession();
    setCollaborationSession(null);
    setParticipants([]);
    setIsConnected(false);
    toast.success('協業セッションから切断しました');
  };

  const broadcastSessionUpdate = async (updatedSession: Session) => {
    if (collaborationSession) {
      await realtime.broadcastSessionUpdate(
        collaborationSession.id,
        'session_update',
        { session: updatedSession }
      );
    }
  };

  const getCurrentUserRole = (): string => {
    // This is a simplified way to determine user role
    // In a real implementation, you'd track the current user more carefully
    const currentParticipant = participants.find(p => p.isOnline);
    return currentParticipant?.role || 'viewer';
  };

  return (
    <div className="collaboration-manager p-4 border-b border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4" />
          <span className="font-medium">協業</span>
          {isConnected ? (
            <Badge variant="secondary" className="text-green-600">
              <Wifi className="h-3 w-3 mr-1" />
              接続中
            </Badge>
          ) : (
            <Badge variant="outline">
              <WifiOff className="h-3 w-3 mr-1" />
              未接続
            </Badge>
          )}
        </div>
        
        {isConnected && collaborationSession && (
          <Button variant="outline" size="sm" onClick={handleDisconnect}>
            切断
          </Button>
        )}
      </div>

      {!isConnected ? (
        <div className="flex gap-2">
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1">
                <Share2 className="h-3 w-3 mr-1" />
                セッション作成
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>協業セッションを作成</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="owner-name">あなたの名前</Label>
                  <Input
                    id="owner-name"
                    placeholder="名前を入力"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                  />
                </div>
                <Button onClick={handleCreateCollaboration} className="w-full">
                  作成して共有コードを生成
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={isJoinDialogOpen} onOpenChange={setIsJoinDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="flex-1">
                <UserPlus className="h-3 w-3 mr-1" />
                セッション参加
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>協業セッションに参加</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="share-code">共有コード</Label>
                  <Input
                    id="share-code"
                    placeholder="6文字のコードを入力"
                    value={shareCode}
                    onChange={(e) => setShareCode(e.target.value.toUpperCase())}
                    maxLength={6}
                  />
                </div>
                <div>
                  <Label htmlFor="participant-name">あなたの名前</Label>
                  <Input
                    id="participant-name"
                    placeholder="名前を入力"
                    value={participantName}
                    onChange={(e) => setParticipantName(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="role">役割</Label>
                  <Select value={selectedRole} onValueChange={(value: any) => setSelectedRole(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="input">テキスト入力担当</SelectItem>
                      <SelectItem value="feedback">感想・質問担当</SelectItem>
                      <SelectItem value="viewer">閲覧のみ</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={handleJoinCollaboration} className="w-full">
                  参加
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Share Code Display */}
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded">
            <span className="text-sm text-gray-600">共有コード:</span>
            <code className="bg-white px-2 py-1 rounded text-sm font-mono">
              {collaborationSession?.shareCode}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyShareCode}
              className="h-6 w-6 p-0"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </div>

          {/* Participants List */}
          <div>
            <Label className="text-xs text-gray-600">参加者 ({participants.length}名)</Label>
            <div className="space-y-1 mt-1">
              {participants.map((participant) => (
                <div key={participant.id} className="flex items-center justify-between text-sm">
                  <span className="truncate">{participant.name}</span>
                  <div className="flex items-center gap-1">
                    <Badge 
                      variant={participant.role === 'input' ? 'default' : 
                              participant.role === 'feedback' ? 'secondary' : 'outline'}
                      className="text-xs"
                    >
                      {participant.role === 'input' ? '入力' : 
                       participant.role === 'feedback' ? '感想' : '閲覧'}
                    </Badge>
                    <div className={`w-2 h-2 rounded-full ${participant.isOnline ? 'bg-green-400' : 'bg-gray-300'}`} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Role-based Action Info */}
          <div className="text-xs text-gray-600 p-2 bg-blue-50 rounded">
            {getCurrentUserRole() === 'input' && (
              <span>✏️ あなたはテキスト入力を担当しています</span>
            )}
            {getCurrentUserRole() === 'feedback' && (
              <span>💭 あなたは感想・質問生成を担当しています</span>
            )}
            {getCurrentUserRole() === 'viewer' && (
              <span>👁️ あなたは閲覧専用ユーザーです</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}