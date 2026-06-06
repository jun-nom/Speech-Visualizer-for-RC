import React, { useRef, useEffect, useState, useCallback } from 'react';
import { FlowNode as FlowNodeType, Session } from '../App';
import { Button } from './ui/button';
import { Copy, User, Users } from 'lucide-react';
import { toast } from 'sonner@2.0.3';

const MIRO_EMBED_BASE = 'https://miro.com/app/live-embed/uXjVHMCUsVk=/';

interface SpeechFlowCanvasProps {
  nodes: FlowNodeType[];
  currentSession?: Session | null;
  currentUserId?: string;
  horizontalScroll?: boolean;
  onHorizontalScrollChange?: (val: boolean) => void;
  venueUrl: string;
  onVenueUrlChange: (url: string) => void;
  venueIframeSrc: string;
  onVenueGo: () => void;
  onVenueDisconnect: () => void;
  venueError?: string;
  activeTab: 'html' | 'miro' | 'venue';
}

export function SpeechFlowCanvas({ nodes, currentSession, currentUserId, horizontalScroll = false, onHorizontalScrollChange, venueUrl, onVenueUrlChange, venueIframeSrc, onVenueGo, onVenueDisconnect, venueError, activeTab }: SpeechFlowCanvasProps) {
  const groupedNodes = React.useMemo(() => {
    const groups: { [topicId: string]: FlowNodeType[] } = {};
    nodes.forEach(node => {
      if (!groups[node.topicId]) {
        groups[node.topicId] = [];
      }
      groups[node.topicId].push(node);
    });

    Object.keys(groups).forEach(topicId => {
      groups[topicId].sort((a, b) => {
        const order: Record<string, number> = { title: 0, fact: 1, insight: 2 };
        return (order[a.type] ?? 1) - (order[b.type] ?? 1);
      });
    });

    return groups;
  }, [nodes]);

  const copyToClipboard = useCallback(async (content: string) => {
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
        textArea.setSelectionRange(0, 99999);
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

    const canUseClipboardAPI = async () => {
      if (!navigator.clipboard || !navigator.clipboard.writeText) return false;
      try {
        if (navigator.permissions) {
          const permission = await navigator.permissions.query({ name: 'clipboard-write' as PermissionName });
          return permission.state !== 'denied';
        }
        return true;
      } catch {
        return false;
      }
    };

    if (await canUseClipboardAPI()) {
      try {
        await navigator.clipboard.writeText(content);
        toast.success('クリップボードにコピーしました');
        return;
      } catch (error) {
        console.warn('Clipboard API failed, using fallback:', error.message);
      }
    }
    fallbackCopy(content);
  }, []);

  const topicIds = Object.keys(groupedNodes);

  const canvasAreaRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to newest content
  useEffect(() => {
    if (!canvasAreaRef.current) return;
    if (horizontalScroll) {
      canvasAreaRef.current.scrollTo({ left: canvasAreaRef.current.scrollWidth, behavior: 'smooth' });
    } else {
      canvasAreaRef.current.scrollTo({ top: canvasAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [topicIds.length, nodes.length, horizontalScroll]);

  // Drag-select state
  const [dragRect, setDragRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  // Set true on drag completion so the subsequent click event on a node is suppressed
  const wasDraggingRef = useRef(false);

  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (!isDraggingRef.current && Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      isDraggingRef.current = true;
      setDragRect({
        x1: dragStartRef.current.x,
        y1: dragStartRef.current.y,
        x2: e.clientX,
        y2: e.clientY,
      });
    };

    const handleMouseUp = async (e: MouseEvent) => {
      if (!isDraggingRef.current || !dragStartRef.current) {
        dragStartRef.current = null;
        return;
      }

      const x1 = Math.min(dragStartRef.current.x, e.clientX);
      const y1 = Math.min(dragStartRef.current.y, e.clientY);
      const x2 = Math.max(dragStartRef.current.x, e.clientX);
      const y2 = Math.max(dragStartRef.current.y, e.clientY);

      const nodeDivs = canvasAreaRef.current?.querySelectorAll<HTMLElement>('[data-node-id]');
      const selectedTexts: string[] = [];

      nodeDivs?.forEach((div) => {
        const rect = div.getBoundingClientRect();
        const intersects = rect.right >= x1 && rect.left <= x2 && rect.bottom >= y1 && rect.top <= y2;
        if (intersects) {
          const nodeId = div.getAttribute('data-node-id');
          const node = nodes.find(n => n.id === nodeId);
          if (node) selectedTexts.push(node.content);
        }
      });

      if (selectedTexts.length > 0) {
        await copyToClipboard(selectedTexts.join('\n\n'));
      }

      wasDraggingRef.current = true;
      dragStartRef.current = null;
      isDraggingRef.current = false;
      setDragRect(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [nodes, copyToClipboard]);

  return (
    <div className="speech-flow-canvas h-full flex flex-col bg-gray-50">
      {/* HTML tab — always in DOM, hidden when Miro tab is active */}
      <div className={`flex flex-col flex-1 min-h-0 ${activeTab !== 'html' ? 'hidden' : ''}`}>
        <div className="px-4 py-2 bg-white border-b border-gray-100 flex-shrink-0 flex items-center justify-between gap-4">
          <p className="text-sm text-gray-600 min-w-0">
            トピック別ノードが表示されます（水色：タイトル、点線白：ファクト、濃青：インサイト）・クリックまたはドラッグ範囲選択でコピー
          </p>
          {onHorizontalScrollChange && (
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none whitespace-nowrap shrink-0">
              <input
                type="checkbox"
                checked={horizontalScroll}
                onChange={e => onHorizontalScrollChange(e.target.checked)}
                className="w-3.5 h-3.5 cursor-pointer"
              />
              横スクロール
            </label>
          )}
        </div>

        {dragRect && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(dragRect.x1, dragRect.x2),
              top: Math.min(dragRect.y1, dragRect.y2),
              width: Math.abs(dragRect.x2 - dragRect.x1),
              height: Math.abs(dragRect.y2 - dragRect.y1),
              border: '1.5px solid rgba(54, 64, 165, 0.7)',
              backgroundColor: 'rgba(54, 64, 165, 0.08)',
              pointerEvents: 'none',
              zIndex: 50,
            }}
          />
        )}

        <div
          ref={canvasAreaRef}
          className="speech-flow-canvas-area flex-1 overflow-auto select-none"
          onMouseDown={handleCanvasMouseDown}
        >
          {nodes.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400 p-6">
              <div className="text-center">
                <div className="text-lg mb-2">スピーチフローがここに表示されます</div>
                <div className="text-sm">テキストを入力してフローを開始してください</div>
              </div>
            </div>
          ) : (
            <div className={horizontalScroll
              ? "speech-flow-topics-container flex flex-col flex-wrap gap-8 p-6 h-full content-start"
              : "speech-flow-topics-container flex flex-row flex-wrap gap-8 p-6 content-start"
            }>
              {topicIds.map((topicId, i) => (
                <TopicColumn
                  key={topicId}
                  nodes={groupedNodes[topicId]}
                  onCopy={copyToClipboard}
                  wasDragging={wasDraggingRef}
                  isLast={horizontalScroll && i === topicIds.length - 1}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Miro tab — always in DOM, hidden when not active */}
      <iframe
        src={MIRO_EMBED_BASE}
        className={`flex-1 w-full ${activeTab !== 'miro' ? 'hidden' : ''}`}
        style={{ border: 'none' }}
        allow="fullscreen; clipboard-read; clipboard-write"
        allowFullScreen
        title="Miroボード"
      />

      {/* Miro会場 tab */}
      <div className={`flex flex-col flex-1 min-h-0 ${activeTab !== 'venue' ? 'hidden' : ''}`}>
        {(() => {
          const unconnected = !venueIframeSrc;
          const barH = unconnected ? 'py-3' : 'py-2';
          const inputH = unconnected ? 'h-14 text-xl' : 'h-7 text-xs';
          const btnH = unconnected ? 'h-14 px-4 text-xl' : 'h-7 px-3 text-xs';
          const blinkClass = unconnected ? 'venue-url-blink' : '';
          return (
            <div className={`px-3 ${barH} bg-white border-b border-gray-100 flex-shrink-0 flex items-center gap-2`}>
              <input
                type="text"
                value={venueUrl}
                onChange={e => onVenueUrlChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && onVenueGo()}
                placeholder="https://miro.com/app/board/..."
                className={`flex-1 border border-gray-300 rounded px-2 min-w-0 ${inputH} ${blinkClass}`}
              />
              {venueIframeSrc ? (
                <Button size="sm" variant="outline" onClick={onVenueDisconnect} className={`shrink-0 ${btnH}`}>Disconnect</Button>
              ) : (
                <Button size="sm" onClick={onVenueGo} className={`shrink-0 ${btnH}`}>Connect</Button>
              )}
            </div>
          );
        })()}
        {venueIframeSrc ? (
          <iframe
            src={venueIframeSrc}
            className="flex-1 w-full"
            style={{ border: 'none' }}
            allow="fullscreen; clipboard-read; clipboard-write"
            allowFullScreen
            title="Miro会場"
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            {venueError ? (
              <p className="text-sm text-red-500 text-center">{venueError}</p>
            ) : (
              <p className="text-sm text-gray-400">URLを入力してConnectを押してください</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface TopicColumnProps {
  nodes: FlowNodeType[];
  onCopy: (content: string) => void;
  wasDragging: React.RefObject<boolean>;
  isLast?: boolean;
}

function TopicColumn({ nodes, onCopy, wasDragging, isLast }: TopicColumnProps) {
  return (
    <div className={`topic-column flex-shrink-0 flex flex-col gap-3 ${isLast ? 'w-[272px] pr-8' : 'w-[240px]'}`}>
      {nodes.map((node) => (
        <FlowNode key={node.id} node={node} onCopy={onCopy} wasDragging={wasDragging} />
      ))}
    </div>
  );
}

interface FlowNodeProps {
  node: FlowNodeType;
  onCopy: (content: string) => void;
  wasDragging: React.RefObject<boolean>;
}

function FlowNode({ node, onCopy, wasDragging }: FlowNodeProps) {
  const getNodeStyles = () => {
    switch (node.type) {
      case 'title':
        return 'bg-blue-100 border-2 border-blue-300 font-semibold text-gray-900';
      case 'fact':
        return 'bg-white border-2 border-dashed border-blue-400 text-gray-900';
      case 'insight':
        return 'bg-[#3640A5] text-white ring-2 ring-white';
      default:
        return 'bg-white border-gray-200 text-gray-900';
    }
  };

  const lines = node.content.split('\n');

  return (
    <div
      data-node-id={node.id}
      className={`speech-flow-node cursor-pointer ${getNodeStyles()} border rounded-lg p-3 shadow-sm hover:shadow-md transition-all hover:bg-opacity-80`}
      style={{
        fontSize: '12px',
        lineHeight: '1.6',
        minHeight: node.type === 'title' ? '40px' : '45px',
        wordBreak: 'break-word'
      }}
      onClick={() => {
        if (wasDragging.current) {
          wasDragging.current = false;
          return;
        }
        onCopy(node.content);
      }}
      title="クリックでコピー・ドラッグで範囲選択コピー"
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
