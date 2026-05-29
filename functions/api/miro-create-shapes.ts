const BOARD_ID = 'uXjVHMCUsVk=';
const NODE_WIDTH = 480;
const COLUMN_STEP = 560; // node width + 80px gap
const HEIGHT_TITLE = 140;
const HEIGHT_DEFAULT = 200;
const NODE_GAP = 24;

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
    fillColor: '#DBEAFE', borderColor: '#93C5FD', borderStyle: 'normal',
    borderWidth: '3', color: '#111827', fontFamily: 'noto sans', fontSize: '28',
    fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle',
  },
  fact: {
    fillColor: '#FFFFFF', borderColor: '#60A5FA', borderStyle: 'dashed',
    borderWidth: '3', color: '#111827', fontFamily: 'noto sans', fontSize: '28',
    fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle',
  },
  insight: {
    fillColor: '#3640A5', borderColor: '#3640A5', borderStyle: 'normal',
    borderWidth: '3', color: '#FFFFFF', fontFamily: 'noto sans', fontSize: '28',
    fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle',
  },
};

function toContent(node: FlowNode): string {
  const esc = node.content
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `<b>${esc}</b>`;
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
      const height = node.type === 'title' ? HEIGHT_TITLE : HEIGHT_DEFAULT;
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
      if (res.ok) successCount++; else errorCount++;
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
