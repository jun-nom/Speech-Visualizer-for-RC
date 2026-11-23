import type { Panel } from '../../../dev/miro-panels';
import { MIRO_STYLES } from './miroCardStyle';
import { routeArrow, visibleArrowLabel } from './miroArrowRouting';
import type { Board } from './rehearsal';

export function renderPanel(panel: Panel, board?: Board) {
  const scale = Math.min(1, 1280 / Math.max(panel.rect.width, panel.rect.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(panel.rect.width * scale);
  canvas.height = Math.ceil(panel.rect.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw Error('Miro の盤面画像を描画できませんでした。');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  for (const element of panel.elements) {
    if (element.fill && element.fill !== 'transparent') {
      ctx.fillStyle = element.fill;
      ctx.fillRect(element.x, element.y, element.width, element.height);
    }
    if (element.border && element.border !== 'transparent') {
      ctx.strokeStyle = element.border;
      ctx.strokeRect(element.x, element.y, element.width, element.height);
    }
    if (!element.text) continue;
    ctx.fillStyle = element.color || (element.fill && element.fill !== '#ffffff' && element.fill !== 'transparent' ? '#fff' : '#111');
    const size = Math.min(element.height * 0.64, element.width / Math.max(3, element.text.length) * 1.2, 29 / scale);
    ctx.font = `600 ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(element.text.replace(/\n/g, ' '), element.x + element.width / 2, element.y + element.height / 2, element.width);
  }
  if (board) {
    ctx.strokeStyle = '#64748b';
    ctx.fillStyle = '#64748b';
    ctx.lineWidth = 1.4 / scale;
    for (const arrow of board.arrows) {
      const route = routeArrow(board, arrow, panel.elements);
      if (!route) continue;
      const { start, end } = route;
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      if (route.controls) {
        const [a, b] = route.controls;
        ctx.bezierCurveTo(a.x, a.y, b.x, b.y, end.x, end.y);
      } else ctx.lineTo(end.x, end.y);
      ctx.stroke();
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const tip = 6 / scale;
      ctx.beginPath();
      ctx.moveTo(end.x, end.y);
      ctx.lineTo(end.x - tip * Math.cos(angle - 0.5), end.y - tip * Math.sin(angle - 0.5));
      ctx.lineTo(end.x - tip * Math.cos(angle + 0.5), end.y - tip * Math.sin(angle + 0.5));
      ctx.fill();
      const label = visibleArrowLabel(route, arrow.label, [...board.cards, ...panel.elements]);
      if (label) {
        ctx.font = `${Math.max(14, 8 / scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, (start.x + end.x) / 2, (start.y + end.y) / 2);
      }
    }
    for (const card of board.cards) {
      const style = MIRO_STYLES[card.type];
      ctx.fillStyle = style.fillColor;
      ctx.strokeStyle = style.borderColor;
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash(card.type === 'fact' ? [2 / scale, 2 / scale] : []);
      ctx.beginPath();
      ctx.roundRect(card.x, card.y, card.width, card.height, 16);
      ctx.fill();
      if (style.borderOpacity !== '0') ctx.stroke();
      const textSize = Math.max(Number(style.fontSize), 9 / scale);
      ctx.font = `${card.type === 'title' ? '700' : '400'} ${textSize}px sans-serif`;
      ctx.fillStyle = style.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines: string[] = [];
      for (const paragraph of card.text.split('\n')) {
        let line = '';
        for (const char of paragraph) {
          if (line && ctx.measureText(line + char).width > card.width - 36) {
            lines.push(line);
            line = '';
          }
          line += char;
        }
        lines.push(line);
      }
      const lineHeight = Math.min(textSize * 1.3, card.height / Math.max(1, lines.length));
      for (const [index, line] of lines.entries()) {
        ctx.fillText(line, card.x + card.width / 2, card.y + card.height / 2 + (index - (lines.length - 1) / 2) * lineHeight, card.width - 36);
      }
    }
  }
  return canvas.toDataURL('image/jpeg', 0.92);
}
