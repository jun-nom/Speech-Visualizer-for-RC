import { contains, overlaps, type Rect } from '../../../dev/miro-panels';
import { routeArrow } from './miroArrowRouting';
import type { Board, Card } from './rehearsal';

const rank = { title: 0, fact: 1, insight: 2 };

export function layoutSpeechFlow(board: Board, relations: Board['arrows'], area: Rect, obstacles: Rect[]) {
  const groups = new Map<string, Card[]>();
  for (const card of board.cards) {
    const key = card.topicId || card.id;
    const group = groups.get(key) ?? [];
    group.push(card);
    groups.set(key, group);
  }
  const stages = new Map([...groups.keys()].map(key => [key, 0]));
  const accepted: Board['arrows'] = [];
  for (const edge of relations) {
    if (groups.has(edge.from) && groups.has(edge.to) && edge.from !== edge.to &&
        !accepted.some(item => item.from === edge.from && item.to === edge.to)) accepted.push(edge);
  }
  if (!accepted.length) return board;

  for (let pass = 0; pass < groups.size; pass++) {
    let changed = false;
    for (const { from, to } of accepted) {
      const stage = stages.get(from)! + 1;
      if (stage <= stages.get(to)!) continue;
      if (stage >= groups.size) return board;
      stages.set(to, stage);
      changed = true;
    }
    if (!changed) break;
  }

  const linkCards = accepted.flatMap(edge => {
    const from = groups.get(edge.from)!;
    const to = groups.get(edge.to)!;
    const target = to.find(card => card.type === 'title') ?? to[0];
    const sources = [from.find(card => card.type === 'insight'), from.find(card => card.type === 'title'), from[0]];
    return [{ target, sources, label: edge.label }];
  });

  function withArrows(cards: Card[]) {
    const next = { ...board, cards, arrows: [...board.arrows] };
    for (const { target, sources, label } of linkCards) {
      for (const card of sources) {
        if (!card) continue;
        const arrow = { from: card.id, to: target.id, label };
        if (!routeArrow(next, arrow, obstacles)) continue;
        if (!next.arrows.some(edge => edge.from === arrow.from && edge.to === arrow.to)) next.arrows.push(arrow);
        break;
      }
    }
    return next;
  }

  const fallback = withArrows(board.cards);
  const columns = new Map<number, Card[][]>();
  for (const [key, group] of groups) {
    const stage = stages.get(key)!;
    const column = columns.get(stage) ?? [];
    column.push([...group].sort((a, b) => rank[a.type] - rank[b.type]));
    columns.set(stage, column);
  }
  const cardGap = 48;
  const laneGap = 160;
  const stackHeight = (group: Card[]) => group.reduce((sum, card) => sum + card.height, 0) + cardGap * (group.length - 1);
  const widest = Math.max(...board.cards.map(card => card.width));
  const stageCount = Math.max(...columns.keys()) + 1;
  const usableGap = (area.width - widest * stageCount - 96) / Math.max(stageCount - 1, 1);
  if (usableGap < 100) return fallback;
  const cards: Card[] = [];
  for (const [stage, column] of columns) {
    const height = column.reduce((sum, group) => sum + stackHeight(group), 0) + laneGap * (column.length - 1);
    let y = area.y + Math.max(48, (area.height - height) / 2);
    const x = area.x + 48 + stage * (widest + Math.min(usableGap, 360));
    for (const group of column) {
      for (const card of group) {
        const positioned = { ...card, x, y };
        if (!contains(area, positioned) || obstacles.some(item => overlaps(item, positioned))) return fallback;
        cards.push(positioned);
        y += card.height + cardGap;
      }
      y += laneGap - cardGap;
    }
  }
  const arranged = withArrows(cards);
  const clearCount = (candidate: Board) => candidate.arrows.filter(arrow => routeArrow(candidate, arrow, obstacles)).length;
  return clearCount(arranged) && clearCount(arranged) >= clearCount(fallback) ? arranged : fallback;
}
