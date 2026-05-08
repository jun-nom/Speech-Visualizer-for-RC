import React from 'react';
import { FlowNode as FlowNodeType, Session } from '../App';
import { Button } from './ui/button';
import { Copy, User, Users } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

interface SpeechFlowCanvasProps {
  nodes: FlowNodeType[];
  currentSession?: Session | null;
  currentUserId?: string;
}

export function SpeechFlowCanvas({ nodes, currentSession, currentUserId }: SpeechFlowCanvasProps) {
  // Group nodes by topic for proper DIV structure
  const groupedNodes = React.useMemo(() => {
    const groups: { [topicId: string]: FlowNodeType[] } = {};
    nodes.forEach(node => {
      if (!groups[node.topicId]) {
        groups[node.topicId] = [];
      }
      groups[node.topicId].push(node);
    });
    
    // Sort nodes within each group: title first, then facts, then insights
    Object.keys(groups).forEach(topicId => {
      groups[topicId].sort((a, b) => {
        const order: Record<string, number> = { title: 0, fact: 1, insight: 2 };
        return (order[a.type] ?? 1) - (order[b.type] ?? 1);
      });
    });

    return groups;
  }, [nodes]);

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

  const topicIds = Object.keys(groupedNodes);

  return (
    <div className="speech-flow-canvas h-full flex flex-col bg-gray-50">
      <div className="speech-flow-canvas-header p-4 bg-white border-b border-gray-200 flex-shrink-0">
        <h2>スピーチフロー</h2>
        <p className="text-sm text-gray-600">
          トピック別ノードが表示されます（水色：タイトル、点線白：ファクト、濃青：インサイト）・クリックでコピー
        </p>
      </div>
      
      <div className="speech-flow-canvas-area flex-1 overflow-auto p-6 flex flex-col flex-wrap">
        {nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <div className="text-center">
              <div className="text-lg mb-2">スピーチフローがここに表示されます</div>
              <div className="text-sm">テキストを入力してフローを開始してください</div>
            </div>
          </div>
        ) : (
          <div className="speech-flow-topics-container flex flex-col flex-wrap gap-8 min-h-full">
            {topicIds.map((topicId) => (
              <TopicColumn 
                key={topicId} 
                nodes={groupedNodes[topicId]} 
                onCopy={handleCopyToClipboard}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TopicColumnProps {
  nodes: FlowNodeType[];
  onCopy: (content: string) => void;
}

function TopicColumn({ nodes, onCopy }: TopicColumnProps) {
  return (
    <div className="topic-column flex-shrink-0 w-[240px] flex flex-col gap-3">
      {nodes.map((node) => (
        <FlowNode key={node.id} node={node} onCopy={onCopy} />
      ))}
    </div>
  );
}

interface FlowNodeProps {
  node: FlowNodeType;
  onCopy: (content: string) => void;
}

function FlowNode({ node, onCopy }: FlowNodeProps) {
  const getNodeStyles = () => {
    switch (node.type) {
      case 'title':
        // トピックタイトルノード（薄い水色背景、青色枠つき、太字）
        return 'bg-blue-100 border-2 border-blue-300 font-semibold text-gray-900';
      case 'fact':
        // 客観的な事実や背景、結果などのノード（白背景、青い点線の枠つき）
        return 'bg-white border-2 border-dashed border-blue-400 text-gray-900';
      case 'insight':
        // 主観的な感想や洞察、結論的な内容（#3640A5背景、白文字）
        return 'bg-[#3640A5] border-[#3640A5] text-white';
      default:
        return 'bg-white border-gray-200 text-gray-900';
    }
  };
  
  const lines = node.content.split('\n');

  return (
    <div
      className={`speech-flow-node select-none cursor-pointer ${getNodeStyles()} border rounded-lg p-3 shadow-sm hover:shadow-md transition-all hover:bg-opacity-80`}
      style={{
        fontSize: '12px',
        lineHeight: '1.6',
        minHeight: node.type === 'title' ? '40px' : '45px',
        wordBreak: 'break-word'
      }}
      onClick={() => onCopy(node.content)}
      title="クリックでコピー"
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}