import { overlaps, type Rect } from '../../../dev/miro-panels';
import type { Board } from './rehearsal';

type Point = { x: number; y: number };
type Side = 'right' | 'bottom' | 'left' | 'top';
export type ArrowRoute = { fromSide: Side; toSide: Side; start: Point; end: Point; shape: 'straight' | 'curved'; controls?: [Point, Point] };

const sides = [
  { name: 'right', x: 1, y: 0 },
  { name: 'bottom', x: 0, y: 1 },
  { name: 'left', x: -1, y: 0 },
  { name: 'top', x: 0, y: -1 },
] as const;

function anchor(rect: Rect, side: typeof sides[number]): Point {
  return { x: rect.x + rect.width * (1 + side.x) / 2, y: rect.y + rect.height * (1 + side.y) / 2 };
}

function hitsRect(start: Point, end: Point, rect: Rect, margin = 16) {
  let entry = 0;
  let exit = 1;
  for (const [from, to, min, max] of [
    [start.x, end.x, rect.x - margin, rect.x + rect.width + margin],
    [start.y, end.y, rect.y - margin, rect.y + rect.height + margin],
  ]) {
    const delta = to - from;
    if (!delta) {
      if (from < min || from > max) return false;
      continue;
    }
    const first = (min - from) / delta;
    const last = (max - from) / delta;
    entry = Math.max(entry, Math.min(first, last));
    exit = Math.min(exit, Math.max(first, last));
    if (entry > exit) return false;
  }
  return true;
}

export function routeArrow(board: Board, arrow: Board['arrows'][number], obstacles: Rect[] = []): ArrowRoute | undefined {
  const from = board.cards.find(card => card.id === arrow.from);
  const to = board.cards.find(card => card.id === arrow.to);
  if (!from || !to || from === to) return;
  const blockers = [...obstacles, ...board.cards.filter(card => card !== from && card !== to)];
  let best: ArrowRoute | undefined;
  let shortest = Infinity;
  for (const fromSide of sides) {
    const start = anchor(from, fromSide);
    for (const toSide of sides) {
      const end = anchor(to, toSide);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      if (dx * fromSide.x + dy * fromSide.y <= 0 || dx * toSide.x + dy * toSide.y >= 0) continue;
      const distance = Math.hypot(dx, dy);
      const tangent = Math.min(distance * 0.42, 480);
      const controls: [Point, Point] = [
        { x: start.x + fromSide.x * tangent, y: start.y + fromSide.y * tangent },
        { x: end.x + toSide.x * tangent, y: end.y + toSide.y * tangent },
      ];
      let curved = Math.abs(dx) >= 24 && Math.abs(dy) >= 24;
      let last = start;
      for (let step = 1; curved && step <= 24; step++) {
        const t = step / 24;
        const u = 1 - t;
        const point = {
          x: u ** 3 * start.x + 3 * u ** 2 * t * controls[0].x + 3 * u * t ** 2 * controls[1].x + t ** 3 * end.x,
          y: u ** 3 * start.y + 3 * u ** 2 * t * controls[0].y + 3 * u * t ** 2 * controls[1].y + t ** 3 * end.y,
        };
        curved = !blockers.some(rect => hitsRect(last, point, rect)) &&
          !(step > 1 && hitsRect(last, point, from, 0)) && !(step < 24 && hitsRect(last, point, to, 0));
        last = point;
      }
      if (!curved && blockers.some(rect => hitsRect(start, end, rect))) continue;
      const score = distance * (curved ? 0.6 : 1);
      if (score >= shortest) continue;
      best = { fromSide: fromSide.name, toSide: toSide.name, start, end, shape: curved ? 'curved' : 'straight',
        ...(curved && { controls }) };
      shortest = score;
    }
  }
  return best;
}

export function arrowKey(arrow: Board['arrows'][number]) {
  return JSON.stringify([arrow.from, arrow.to]);
}

export function visibleArrowLabel(route: ArrowRoute, label: string, obstacles: Rect[] = []) {
  if (!label.trim()) return '';
  const width = [...label].reduce((sum, char) => sum + (/^[\x00-\x7f]$/.test(char) ? 9 : 16), 24);
  const height = 34;
  const bounds = { x: (route.start.x + route.end.x - width) / 2, y: (route.start.y + route.end.y - height) / 2, width, height };
  return obstacles.some(rect => overlaps(rect, bounds)) ? '' : label;
}
