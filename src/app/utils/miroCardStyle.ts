export type MiroNodeType = 'title' | 'fact' | 'insight';
export const MIRO_NODE_WIDTH = 620;

export const MIRO_STYLES = {
  title:   { fillColor: '#E2EEFD', borderColor: '#2D9BF0', borderStyle: 'normal', borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle' },
  fact:    { fillColor: '#FFFFFF',  borderColor: '#2D9BF0', borderStyle: 'dotted', borderWidth: '5', color: '#305BAB', fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '1', textAlign: 'center', textAlignVertical: 'middle' },
  insight: { fillColor: '#0E46AC', borderColor: '#0E46AC', borderStyle: 'normal', borderWidth: '1', color: '#FFFFFF',  fontFamily: 'noto_sans', fontSize: '37', fillOpacity: '1', borderOpacity: '0', textAlign: 'center', textAlignVertical: 'middle' },
} as const;

export function miroEstimateHeight(content: string, minH: number): number {
  const LINE_HEIGHT = Math.round(37 * 1.4);
  const charsPerLine = Math.max(1, Math.floor((MIRO_NODE_WIDTH - 50) / 37));
  let lines = 0;
  for (const seg of content.split('\n')) lines += Math.max(1, Math.ceil(seg.length / charsPerLine));
  return Math.max(minH, lines * LINE_HEIGHT + 80);
}

export function miroNodeGeometry(content: string, type: MiroNodeType) {
  return { width: MIRO_NODE_WIDTH, height: miroEstimateHeight(content, type === 'title' ? 160 : 200) };
}
