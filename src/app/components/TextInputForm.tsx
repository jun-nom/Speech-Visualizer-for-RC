import React from 'react';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

export type InformationLevel = 'high' | 'medium' | 'low';
export type TextDensity = 'high' | 'medium' | 'low';
export type NodeQuantity = 'high' | 'medium' | 'low';

interface TextInputFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string, informationLevel: InformationLevel) => void;
  onGenerateFeedback: () => void;
  inputHistory: string[];
  informationLevel: InformationLevel;
  onInformationLevelChange: (level: InformationLevel) => void;
  nodeQuantity?: NodeQuantity;
  onNodeQuantityChange?: (quantity: NodeQuantity) => void;
  textDensity?: TextDensity;
  onTextDensityChange?: (density: TextDensity) => void;
  isProcessing?: boolean;
  isGeneratingFeedback?: boolean;
  isInputDisabled?: boolean;
  isFeedbackDisabled?: boolean;
  userRole?: 'input' | 'feedback' | 'viewer' | null;
}

export function TextInputForm({
  value,
  onChange,
  onSubmit,
  onGenerateFeedback,
  inputHistory,
  informationLevel,
  onInformationLevelChange,
  nodeQuantity = 'medium',
  onNodeQuantityChange,
  textDensity = 'medium',
  onTextDensityChange,
  isProcessing = false,
  isGeneratingFeedback = false,
  isInputDisabled = false,
  isFeedbackDisabled = false,
  userRole = null
}: TextInputFormProps) {
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (value.trim()) {
      onSubmit(value, informationLevel);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim()) {
        onSubmit(value, informationLevel);
      }
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      // First try the modern clipboard API
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          toast.success('コピーしました');
          return;
        } catch (clipboardError) {
          // If clipboard API fails due to permissions, fall back to execCommand
          console.log('Clipboard API failed, trying fallback:', clipboardError);
        }
      }
      
      // Fallback method using document.execCommand
      const textArea = document.createElement('textarea');
      textArea.value = text;
      
      // Make the textarea invisible but still accessible
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      
      try {
        const successful = document.execCommand('copy');
        if (successful) {
          toast.success('コピーしました');
        } else {
          throw new Error('execCommand failed');
        }
      } catch (execError) {
        console.error('execCommand copy failed:', execError);
        
        // Final fallback - prompt user to manually copy
        if (window.prompt) {
          window.prompt('以下のテキストをコピーしてください:', text);
        } else {
          toast.error('コピーに失敗しました。手動でテキストを選択してコピーしてください。');
        }
      } finally {
        document.body.removeChild(textArea);
      }
      
    } catch (err) {
      console.error('Copy operation failed:', err);
      toast.error('コピーに失敗しました');
    }
  };

  // Check if current user can perform input actions
  const canInput = userRole === null || userRole === 'input';
  const canGenerateFeedback = userRole === null || userRole === 'feedback' || userRole === 'viewer';

  // Determine if input is disabled based on role
  const inputDisabled = isInputDisabled || (userRole !== null && !canInput);
  const feedbackDisabled = isFeedbackDisabled;

  return (
    <div className="text-input-form space-y-4">
      {/* Permission Notice */}
      {userRole && (
        <div className="p-2 rounded-lg text-xs">
          {userRole === 'input' && (
            <div className="bg-blue-50 text-blue-700 p-2 rounded">
              ✏️ あなたはテキスト入力担当です。スピーチフローにテキストを追加できます。
            </div>
          )}
          {userRole === 'feedback' && (
            <div className="bg-green-50 text-green-700 p-2 rounded">
              💭 あなたは感想・質問担当です。セッション内容から��想と質問を生成できます。
            </div>
          )}
          {userRole === 'viewer' && (
            <div className="bg-gray-50 text-gray-600 p-2 rounded">
              👁️ 他のユーザーのセッションを閲覧しています。感想・質問は生成できます。
            </div>
          )}
        </div>
      )}

      {/* Form Header with Buttons */}
      <div className="flex items-center justify-start">
        <div className="flex items-center gap-2">
          {/* Only show "Add to Speech Flow" button for non-viewers */}
          {userRole !== 'viewer' && (
            <>
              <Button 
                onClick={() => onSubmit(value, informationLevel)}
                disabled={!value.trim() || isProcessing || inputDisabled}
                size="sm"
                title={inputDisabled && userRole !== 'input' ? 'テキスト入力担当者のみ使用できます' : ''}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    処理中...
                  </>
                ) : (
                  'スピーチフローに追加'
                )}
              </Button>
              <Select value={informationLevel} onValueChange={onInformationLevelChange}>
                <SelectTrigger className="w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">トピック量：多</SelectItem>
                  <SelectItem value="medium">トピック量：中</SelectItem>
                  <SelectItem value="low">トピック量：少</SelectItem>
                </SelectContent>
              </Select>
              <Select value={nodeQuantity} onValueChange={onNodeQuantityChange}>
                <SelectTrigger className="w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">ノード量：多</SelectItem>
                  <SelectItem value="medium">ノード量：中</SelectItem>
                  <SelectItem value="low">ノード量：少</SelectItem>
                </SelectContent>
              </Select>
              <Select value={textDensity} onValueChange={onTextDensityChange}>
                <SelectTrigger className="w-[120px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">テキスト量：多</SelectItem>
                  <SelectItem value="medium">テキスト量：中</SelectItem>
                  <SelectItem value="low">テキスト量：少</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          <Button 
            onClick={onGenerateFeedback}
            variant="outline"
            size="sm"
            disabled={isGeneratingFeedback || feedbackDisabled}
            title={feedbackDisabled && userRole !== 'feedback' ? '感想・質問担当者のみ使用できます' : ''}
          >
            {isGeneratingFeedback ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              '感想と質問を生成'
            )}
          </Button>
        </div>
      </div>

      {userRole !== 'viewer' && (
        <p className="text-sm text-gray-600">
          スピーチ内容を入力してフローに追加できます
        </p>
      )}

      {/* Input Form - Only show for non-viewers */}
      {userRole !== 'viewer' && (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Textarea
            id="rc_speech_text_inptut"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={inputDisabled ? 'テキスト入力権限がありません' : 'スピーチ内容を入力してください...'}
            className="h-[80px] resize-none"
            disabled={inputDisabled}
          />
          <p className="text-xs text-gray-500">
            Ctrl+Enter または Cmd+Enter で送信できます
          </p>
        </form>
      )}

      {/* Input History */}
      {inputHistory.length > 0 && (
        <div className="input-history space-y-2">
          <h4 className="text-sm">入力履歴</h4>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {inputHistory.map((item, index) => (
              <div 
                key={index}
                className="input-history-item flex items-start gap-2 p-3 bg-gray-50 rounded-lg text-sm"
              >
                <div className="flex-1 text-gray-700">
                  <div className="text-xs text-gray-500 mb-1">
                    {String(index + 1).padStart(2, '0')}:{String(Math.floor(Math.random() * 60)).padStart(2, '0')}
                  </div>
                  <div className="line-clamp-3">{item}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(item)}
                  className="flex-shrink-0 p-1 h-8 w-8"
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}