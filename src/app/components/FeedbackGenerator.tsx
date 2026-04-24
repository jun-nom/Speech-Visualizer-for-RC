import React from 'react';
import { MessageCircle, HelpCircle, MoreHorizontal } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface FeedbackGeneratorProps {
  feedback: {
    comments: string[];
    questions: string[];
  };
}

export function FeedbackGenerator({ feedback }: FeedbackGeneratorProps) {
  const hasContent = feedback.comments.length > 0 || feedback.questions.length > 0;

  const handleCopyToClipboard = async (content: string) => {
    const fallbackCopy = (text: string) => {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        textArea.style.opacity = '0';
        textArea.setAttribute('readonly', '');
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        textArea.setSelectionRange(0, 99999); // For mobile devices
        
        const result = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (result) {
          toast.success('クリップボードにコピーしました');
          return true;
        } else {
          toast.error('コピーに失敗しました');
          return false;
        }
      } catch (error) {
        console.error('Fallback copy failed:', error);
        toast.error('コピーに失敗しました');
        return false;
      }
    };

    // Check if we can use clipboard API
    const canUseClipboardAPI = async () => {
      if (!navigator.clipboard || !navigator.clipboard.writeText) {
        return false;
      }
      
      // Check if we have permission to use clipboard
      try {
        if (navigator.permissions) {
          const permission = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
          return permission.state !== 'denied';
        }
        return true; // If permissions API is not available, assume we can try
      } catch (error) {
        return false; // If permission check fails, use fallback
      }
    };

    // Try clipboard API only if we have permission
    if (await canUseClipboardAPI()) {
      try {
        await navigator.clipboard.writeText(content);
        toast.success('クリップボードにコピーしました');
        return;
      } catch (error) {
        // Only log if we expected it to work
        console.warn('Clipboard API failed, using fallback:', error.message);
      }
    }

    // Use fallback method
    fallbackCopy(content);
  };

  return (
    <div className="feedback-generator h-full flex flex-col">
      {/* Header */}
      <div className="feedback-header p-4 border-b border-gray-200">
        <h3>感想・質問</h3>
        <p className="text-sm text-gray-600">
          様々な立場の参加者の感想と質問が表示されます（クリックでコピー）
        </p>
      </div>

      {/* Content */}
      <div className="feedback-content flex-1 overflow-y-auto p-4">
        {!hasContent ? (
          <div className="text-center text-gray-400 mt-12">
            <MoreHorizontal className="w-12 h-12 mx-auto mb-4 text-gray-300" />
            <p>「感想と質問を生成」ボタンを押すと</p>
            <p>ここに表示されます</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Comments Section */}
            {feedback.comments.length > 0 && (
              <div className="feedback-section">
                <div className="flex items-center gap-2 mb-3">
                  <MessageCircle className="w-4 h-4 text-blue-500" />
                  <h4 className="text-sm">感想</h4>
                </div>
                <div className="space-y-3">
                  {feedback.comments.map((comment, index) => (
                    <FeedbackCard key={`comment-${index}`} content={comment} type="comment" onCopy={handleCopyToClipboard} />
                  ))}
                </div>
              </div>
            )}

            {/* Questions Section */}
            {feedback.questions.length > 0 && (
              <div className="feedback-section">
                <div className="flex items-center gap-2 mb-3">
                  <HelpCircle className="w-4 h-4 text-purple-500" />
                  <h4 className="text-sm">質問</h4>
                </div>
                <div className="space-y-3">
                  {feedback.questions.map((question, index) => (
                    <FeedbackCard key={`question-${index}`} content={question} type="question" onCopy={handleCopyToClipboard} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface FeedbackCardProps {
  content: string;
  type: 'comment' | 'question';
  onCopy: (content: string) => void;
}

function FeedbackCard({ content, type, onCopy }: FeedbackCardProps) {
  // Extract persona and message from content (format: "persona: message")
  const [persona, ...messageParts] = content.split(': ');
  const message = messageParts.join(': ');

  const borderColor = type === 'comment' ? 'border-blue-200' : 'border-purple-200';
  const bgColor = type === 'comment' ? 'bg-blue-50' : 'bg-purple-50';
  const textColor = type === 'comment' ? 'text-blue-700' : 'text-purple-700';

  return (
    <div 
      className={`feedback-card cursor-pointer p-3 rounded-lg border ${borderColor} ${bgColor} hover:bg-opacity-80 transition-all`}
      onClick={() => onCopy(content)}
      title="クリックでコピー"
    >
      <div className={`text-xs mb-2 ${textColor}`}>
        {persona}
      </div>
      <div className="text-sm text-gray-700 leading-relaxed">
        {message}
      </div>
    </div>
  );
}