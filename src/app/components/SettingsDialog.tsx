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
  deepgramApiKey: string;
  onDeepgramApiKeyChange: (key: string) => void;
}

export function SettingsDialog({
  openaiApiKey,
  onOpenaiApiKeyChange,
  aiModel,
  onAiModelChange,
  deepgramApiKey,
  onDeepgramApiKeyChange,
}: SettingsDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [openaiStatus, setOpenaiStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');
  const [deepgramStatus, setDeepgramStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>('idle');

  const [localOpenaiApiKey, setLocalOpenaiApiKey] = useState(openaiApiKey);
  const [localAiModel, setLocalAiModel] = useState(aiModel);
  const [localDeepgramApiKey, setLocalDeepgramApiKey] = useState(deepgramApiKey);

  useEffect(() => {
    setLocalOpenaiApiKey(openaiApiKey);
    setLocalAiModel(aiModel);
    setLocalDeepgramApiKey(deepgramApiKey);
  }, [openaiApiKey, aiModel, deepgramApiKey]);

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

  const checkDeepgramApiKey = async (apiKey: string) => {
    if (!apiKey.trim()) {
      setDeepgramStatus('invalid');
      return;
    }

    setDeepgramStatus('checking');

    try {
      const response = await fetch('https://api.deepgram.com/v1/projects', {
        method: 'GET',
        headers: {
          'Authorization': `Token ${apiKey}`,
        },
      });

      if (response.ok) {
        setDeepgramStatus('valid');
        toast.success('Deepgram APIキーが有効です');
      } else {
        setDeepgramStatus('invalid');
        toast.error('Deepgram APIキーが無効です');
      }
    } catch (error) {
      setDeepgramStatus('invalid');
      toast.error('Deepgram API接続エラー');
    }
  };

  const handleSave = () => {
    onOpenaiApiKeyChange(localOpenaiApiKey);
    onAiModelChange(localAiModel);
    onDeepgramApiKeyChange(localDeepgramApiKey);
    setIsOpen(false);
    toast.success('設定を保存しました');
  };

  const handleCancel = () => {
    setLocalOpenaiApiKey(openaiApiKey);
    setLocalAiModel(aiModel);
    setLocalDeepgramApiKey(deepgramApiKey);
    setIsOpen(false);
  };

  const renderStatus = (status: string) => {
    switch (status) {
      case 'checking':
        return <Badge variant="secondary"><Loader2 className="w-3 h-3 mr-1 animate-spin" />確認中</Badge>;
      case 'valid':
        return <Badge variant="default" className="bg-green-500"><Check className="w-3 h-3 mr-1" />接続OK</Badge>;
      case 'invalid':
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>設定</DialogTitle>
          <DialogDescription>アプリケーションの設定を変更してください。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="openai-api-key">OpenAI APIキー</Label>
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="deepgram-api-key">Deepgram APIキー</Label>
              <div className="flex items-center gap-2">
                {renderStatus(deepgramStatus)}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => checkDeepgramApiKey(localDeepgramApiKey)}
                  disabled={deepgramStatus === 'checking'}
                >
                  接続確認
                </Button>
              </div>
            </div>
            <Input
              id="deepgram-api-key"
              type="password"
              value={localDeepgramApiKey}
              onChange={(e) => setLocalDeepgramApiKey(e.target.value)}
              placeholder="..."
              className="font-mono text-sm"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button variant="outline" onClick={handleCancel}>キャンセル</Button>
            <Button onClick={handleSave}>保存</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
