export type Rect = { x: number; y: number; width: number; height: number };
export type MiroItem = {
  id: string; type: string; parent?: { id: string };
  data?: { title?: string; content?: string; shape?: string };
  geometry?: { width: number; height?: number; rotation?: number };
  position?: { x: number; y: number; relativeTo: string };
  style?: { fillColor?: string; color?: string; borderColor?: string; fontSize?: string };
};
export type Panel = {
  id: string; native: boolean; rect: Rect;
  elements: (Rect & { text: string; fill?: string; color?: string; border?: string })[];
};

export function normalizeMiroText(value: string) {
  return value.replace(/[\u00ad\u200b-\u200d\ufeff]/g, '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function plain(value = '') {
  return normalizeMiroText(value.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
      if (code.startsWith('#')) {
        const hex = code[1]?.toLowerCase() === 'x';
        const value = Number.parseInt(code.slice(hex ? 2 : 1), hex ? 16 : 10);
        return value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : entity;
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[code.toLowerCase()] ?? entity;
    }));
}

export function bounds(item: MiroItem): Rect | undefined {
  const { position, geometry } = item;
  if (!position || !geometry || !(geometry.width > 0)) return;
  const height = geometry.height ?? (Number(item.style?.fontSize) || 32) * 1.6;
  if (!(height > 0)) return;
  return { x: position.x - geometry.width / 2, y: position.y - height / 2, width: geometry.width, height };
}

export function contains(outer: Rect, inner: Rect) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

export function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function getPanels(items: MiroItem[], generated: Set<string>): Panel[] {
  const positioned = items.filter(item => !generated.has(item.id)).flatMap(item => {
    const rect = bounds(item);
    return rect ? [{ item, rect }] : [];
  });
  return positioned.flatMap(({ item, rect }) => {
    if (item.parent || item.position?.relativeTo !== 'canvas_center' || (item.geometry?.rotation ?? 0) !== 0) return [];
    const native = item.type === 'frame';
    if (!native && (item.type !== 'shape' || !['rectangle', 'round_rectangle'].includes(item.data?.shape ?? '') || plain(item.data?.content))) return [];
    const elements = positioned.flatMap(({ item: child, rect: childRect }) => {
      if (child.id === item.id) return [];
      const r = child.parent?.id === item.id && child.position?.relativeTo === 'parent_top_left' ? childRect
        : !child.parent && contains(rect, childRect) ? { ...childRect, x: childRect.x - rect.x, y: childRect.y - rect.y } : undefined;
      if (!r) return [];
      return [{ ...r, text: plain(child.data?.content || child.data?.title), fill: child.style?.fillColor,
        color: child.style?.color, border: child.style?.borderColor }];
    });
    if (!native && (rect.height < rect.width * 0.16 || !elements.some(child => child.text))) return [];
    return [{ id: item.id, rect, native, elements }];
  });
}
