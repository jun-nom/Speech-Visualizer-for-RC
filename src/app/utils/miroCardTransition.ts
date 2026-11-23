import { contains, overlaps, type Rect } from '../../../dev/miro-panels';
import type { Card } from './rehearsal';

export function planCardMoves(current: Card[], target: Card[], area: Rect, obstacles: Rect[]) {
  const occupied = new Map(current.map(card => [card.id, card]));
  const pending = new Map(target.filter(card => {
    const previous = occupied.get(card.id);
    return !previous || previous.text !== card.text || previous.type !== card.type ||
      previous.x !== card.x || previous.y !== card.y || previous.width !== card.width || previous.height !== card.height;
  }).map(card => [card.id, card]));
  const moves: Card[] = [];
  const parked = new Set<string>();
  const available = (card: Card) => contains(area, card) &&
    !obstacles.some(rect => overlaps(rect, card)) &&
    ![...occupied.values()].some(existing => existing.id !== card.id && overlaps(existing, card));

  while (pending.size) {
    const ready = [...pending.values()].find(available);
    if (ready) {
      pending.delete(ready.id);
      occupied.set(ready.id, ready);
      moves.push(ready);
      continue;
    }

    // Use temporary empty space when cards are exchanging positions.
    const blockedBy = [...occupied.values()].find(card => pending.has(card.id) && !parked.has(card.id) &&
      [...pending.values()].some(destination => destination.id !== card.id && overlaps(destination, card)));
    if (!blockedBy) return;
    const reserved = [...obstacles, ...occupied.values(), ...target];
    const xs = [area.x, ...reserved.map(rect => rect.x + rect.width + 8)];
    const ys = [area.y, ...reserved.map(rect => rect.y + rect.height + 8)];
    let parking: Card | undefined;
    for (const y of ys) {
      const x = xs.find(x => {
        const candidate = { ...blockedBy, x, y };
        return contains(area, candidate) && !reserved.some(rect => overlaps(rect, candidate));
      });
      if (x !== undefined) { parking = { ...blockedBy, x, y }; break; }
    }
    if (!parking) return;
    parked.add(parking.id);
    occupied.set(parking.id, parking);
    moves.push(parking);
  }
  return moves;
}
