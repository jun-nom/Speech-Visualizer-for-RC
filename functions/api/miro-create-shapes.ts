const BOARD_ID = 'uXjVHMCUsVk=';
const NODE_WIDTH = 620;
const COLUMN_STEP = 700; // node width + 80px gap
const NODE_GAP = 48;

interface FlowNode {
  id: string;
  type: 'title' | 'fact' | 'insight';
  content: string;
  topicId: string;
}

interface Env {
  MIRO_ACCESS_TOKEN?: string;
}

const STYLES: Record<string, object> = {
  title: {
    fillColor: '#E2EEFD', borderColor: '#2D9BF0', borderStyle: 'normal',
    borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37',
    fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle',
  },
  fact: {
    fillColor: '#FFFFFF', borderColor: '#2D9BF0', borderStyle: 'dotted',
    borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37',
    fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle',
  },
  insight: {
    fillColor: '#0E46AC', borderColor: '#0E46AC', borderStyle: 'normal',
    borderWidth: '1', color: '#FFFFFF', fontFamily: 'noto_sans', fontSize: '37',
    fillOpacity: '1', borderOpacity: '0', textAlign: 'center', textAlignVertical: 'middle',
  },
};

// Japanese full-width chars ≈ fontSize wide; line height ≈ fontSize * 1.4
function estimateHeight(content: string, minHeight: number): number {
  const FONT_SIZE = 37;
  const CHAR_WIDTH = FONT_SIZE;
  const LINE_HEIGHT = Math.round(FONT_SIZE * 1.4);
  const PADDING_H = 50;
  const PADDING_V = 80;
  const charsPerLine = Math.max(1, Math.floor((NODE_WIDTH - PADDING_H) / CHAR_WIDTH));
  let lines = 0;
  for (const segment of content.split('\n')) {
    lines += Math.max(1, Math.ceil(segment.length / charsPerLine));
  }
  return Math.max(minHeight, lines * LINE_HEIGHT + PADDING_V);
}

function toContent(node: FlowNode): string {
  const esc = node.content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return node.type === 'title' ? `<b>${esc}</b>` : esc;
}

async function createShapes(nodes: FlowNode[], columnOffset: number, token: string) {
  const topicOrder: string[] = [];
  const grouped: Record<string, FlowNode[]> = {};
  for (const node of nodes) {
    if (!grouped[node.topicId]) { grouped[node.topicId] = []; topicOrder.push(node.topicId); }
    grouped[node.topicId].push(node);
  }
  const typeOrder: Record<string, number> = { title: 0, fact: 1, insight: 2 };
  for (const id of topicOrder) {
    grouped[id].sort((a, b) => (typeOrder[a.type] ?? 1) - (typeOrder[b.type] ?? 1));
  }

  let successCount = 0;
  let errorCount = 0;

  for (let col = 0; col < topicOrder.length; col++) {
    let y = 0;
    for (const node of grouped[topicOrder[col]]) {
      const minH = node.type === 'title' ? 160 : 200;
      const height = estimateHeight(node.content, minH);
      const res = await fetch(
        `https://api.miro.com/v2/boards/${encodeURIComponent(BOARD_ID)}/shapes`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            data: { shape: 'round_rectangle', content: toContent(node) },
            style: STYLES[node.type] ?? STYLES.fact,
            position: { x: (columnOffset + col) * COLUMN_STEP, y },
            geometry: { width: NODE_WIDTH, height },
          }),
        }
      );
      if (res.ok) {
        successCount++;
      } else {
        const errText = await res.text();
        console.error(`[Miro] ${res.status} (${node.type}):`, errText);
        errorCount++;
      }
      y += height + NODE_GAP;
    }
  }

  return { successCount, errorCount };
}

export async function onRequestPost(context: { request: Request; env: Env }) {
  const token = context.env.MIRO_ACCESS_TOKEN;
  if (!token) {
    return Response.json({ error: 'MIRO_ACCESS_TOKEN not configured' }, { status: 500 });
  }

  const { nodes, columnOffset = 0 } = await context.request.json() as {
    nodes: FlowNode[];
    columnOffset?: number;
  };

  if (!nodes?.length) {
    return Response.json({ error: 'nodes are required' }, { status: 400 });
  }

  const result = await createShapes(nodes, columnOffset, token);
  return Response.json(result);
}
