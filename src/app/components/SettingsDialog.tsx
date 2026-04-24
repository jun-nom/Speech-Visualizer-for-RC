import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Badge } from './ui/badge';
import { Settings, Check, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface SettingsDialogProps {
  openaiApiKey: string;
  onOpenaiApiKeyChange: (key: string) => void;
  aiModel: string;
  onAiModelChange: (model: string) => void;
  supabaseUrl: string;
  onSupabaseUrlChange: (url: string) => void;
  supabaseAnonKey: string;
  onSupabaseAnonKeyChange: (key: string) => void;
}

export function SettingsDialog({
  openaiApiKey,
  onOpenaiApiKeyChange,
  aiModel,
  onAiModelChange,
  supabaseUrl,
  onSupabaseUrlChange,
  supabaseAnonKey,
  onSupabaseAnonKeyChange
}: SettingsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openaiStatus, setOpenaiStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [supabaseStatus, setSupabaseStatus] = useState<'idle' | 'checking' | 'connected' | 'error'>('idle');

  // Local state for form inputs
  const [localOpenaiApiKey, setLocalOpenaiApiKey] = useState(openaiApiKey);
  const [localAiModel, setLocalAiModel] = useState(aiModel);
  const [localSupabaseUrl, setLocalSupabaseUrl] = useState(supabaseUrl);
  const [localSupabaseAnonKey, setLocalSupabaseAnonKey] = useState(supabaseAnonKey);

  useEffect(() => {
    setLocalOpenaiApiKey(openaiApiKey);
    setLocalAiModel(aiModel);
    setLocalSupabaseUrl(supabaseUrl);
    setLocalSupabaseAnonKey(supabaseAnonKey);
  }, [openaiApiKey, aiModel, supabaseUrl, supabaseAnonKey]);

  const checkOpenaiApiKey = async (apiKey: string) => {
    if (!apiKey.trim()) {
      setOpenaiStatus('invalid');
      return;
    }

    setOpenaiStatus('checking');
    
    try {
      const response = await fetch('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        setOpenaiStatus('valid');
        toast.success('OpenAI APIキーが有効です');
      } else {
        setOpenaiStatus('invalid');
        toast.error('OpenAI APIキーが無効です');
      }
    } catch (error) {
      setOpenaiStatus('invalid');
      toast.error('OpenAI API接続エラー');
    }
  };

  const checkSupabaseConnection = async (url: string, anonKey: string) => {
    if (!url.trim() || !anonKey.trim()) {
      setSupabaseStatus('error');
      return;
    }

    setSupabaseStatus('checking');
    
    try {
      const response = await fetch(`${url}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok || response.status === 200) {
        setSupabaseStatus('connected');
        toast.success('Supabase接続が確認できました');
      } else {
        setSupabaseStatus('error');
        toast.error('Supabase接続に失敗しました');
      }
    } catch (error) {
      setSupabaseStatus('error');
      toast.error('Supabase接続エラー');
    }
  };

  const handleSave = () => {
    onOpenaiApiKeyChange(localOpenaiApiKey);
    onAiModelChange(localAiModel);
    onSupabaseUrlChange(localSupabaseUrl);
    onSupabaseAnonKeyChange(localSupabaseAnonKey);
    setIsOpen(false);
    toast.success('設定を保存しました');
  };

  const handleCancel = () => {
    // Reset local state to original values
    setLocalOpenaiApiKey(openaiApiKey);
    setLocalAiModel(aiModel);
    setLocalSupabaseUrl(supabaseUrl);
    setLocalSupabaseAnonKey(supabaseAnonKey);
    setIsOpen(false);
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case 'checking':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />確認中</Badge>;
      case 'valid':
      case 'connected':
        return <Badge variant="default" className="bg-green-500"><Check className="w-3 h-3 mr-1" />接続OK</Badge>;
      case 'invalid':
      case 'error':
        return <Badge variant="destructive"><X className="w-3 h-3 mr-1" />エラー</Badge>;
      default:
        return <Badge variant="outline">未確認</Badge>;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Settings className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>アプリケーションの設定を変更してください。</DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6">
          {/* OpenAI Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">OpenAI API設定</h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="openai-api-key">APIキー</Label>
                <div className="flex items-center gap-2">
                  {renderStatus(openaiStatus)}
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => checkOpenaiApiKey(localOpenaiApiKey)}
                    disabled={openaiStatus === 'checking'}
                  >
                    接続確認
                  </Button>
                </div>
              </div>
              <Input
                id="openai-api-key"
                type="password"
                value={localOpenaiApiKey}
                onChange={(e) => setLocalOpenaiApiKey(e.target.value)}
                placeholder="sk-proj-..."
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ai-model">AIモデル</Label>
              <Select value={localAiModel} onValueChange={setLocalAiModel}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Supabase Settings */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Supabase設定</h3>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="supabase-url">プロジェクトURL</Label>
                <div className="flex items-center gap-2">
                  {renderStatus(supabaseStatus)}
                  <Button 
                    type="button" 
                    variant="outline" 
                    size="sm"
                    onClick={() => checkSupabaseConnection(localSupabaseUrl, localSupabaseAnonKey)}
                    disabled={supabaseStatus === 'checking'}
                  >
                    接続確認
                  </Button>
                </div>
              </div>
              <Input
                id="supabase-url"
                type="url"
                value={localSupabaseUrl}
                onChange={(e) => setLocalSupabaseUrl(e.target.value)}
                placeholder="https://your-project.supabase.co"
                className="font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="supabase-anon-key">Anon Key</Label>
              <Input
                id="supabase-anon-key"
                type="password"
                value={localSupabaseAnonKey}
                onChange={(e) => setLocalSupabaseAnonKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="font-mono text-sm"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>
              キャンセル
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}