import { planCardMoves } from '../src/app/utils/miroCardTransition';
import { isMiroBoardId } from '../src/app/utils/miroBoardId';
import { arrowKey, routeArrow, visibleArrowLabel, type ArrowRoute } from '../src/app/utils/miroArrowRouting';
import { validateBoard, emptyBoard, type Board, type Card } from '../src/app/utils/rehearsal';

import { MIRO_STYLES, miroNodeGeometry } from '../src/app/utils/miroCardStyle';
import { bounds, contains, getPanels, overlaps, plain, normalizeMiroText, type MiroItem, type Panel, type Rect } from './miro-panels';

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

export function createMiroHandler(token: string) {
  type FrameState = {
    shapeIds: Map<string, string>;
    edgeIds: Map<string, { id: string; label: string; fromSide: ArrowRoute['fromSide']; toSide: ArrowRoute['toSide']; shape: ArrowRoute['shape'] }>;
    board: Board;
  };
  const boardStates = new Map<string, Map<string, FrameState>>();
  const busyBoards = new Set<string>();

  async function request<T>(boardId: string, path: string, method = 'GET', payload?: object): Promise<T> {
    const url = `https://api.miro.com/v2/boards/${encodeURIComponent(boardId)}${path}`;
    const body = payload && JSON.stringify(payload);
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' };
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(15000) });
      } catch (error) {
        // A lost POST response does not tell us whether the object already exists.
        if (method === 'POST' || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
        continue;
      }
      if (response.ok) return response.status === 204 ? undefined as T : response.json();
      const retryable = response.status === 429 || (method !== 'POST' && [500, 502, 503, 504].includes(response.status));
      const retryAfter = response.headers.get('Retry-After');
      const seconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1000 : NaN;
      const dateDelay = retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      const delay = Math.max(500 * 2 ** attempt, Number.isFinite(seconds) ? seconds : Number.isFinite(dateDelay) ? dateDelay : 0);
      if (retryable && attempt < 2 && delay <= 60000) {
        await response.body?.cancel().catch(() => {});
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      const upstream = await response.json().catch(() => null);
      const code = upstream && typeof upstream.code === 'string' && /^[\w.-]{1,80}$/.test(upstream.code) ? ` ${upstream.code}` : '';
      throw Object.assign(Error(`Miro ${method} ${path.split('?')[0]} (${response.status}${code})`), { status: response.status });
    }
  }

  async function readBoard(boardId: string, states: Map<string, FrameState>) {
    const items: MiroItem[] = [];
    let cursor: string | undefined;
    do {
      const page: { data: MiroItem[]; cursor?: string } = await request(boardId, `/items?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...page.data);
      cursor = page.cursor;
    } while (cursor);
    return { items, panels: panelsFor(items, states) };
  }

  function panelsFor(items: MiroItem[], states: Map<string, FrameState>) {
    const generated = new Set(Array.from(states.values()).flatMap(state => [...state.shapeIds.values()]));
    return getPanels(items, generated);
  }

  async function snapshot(boardId: string, states: Map<string, FrameState>, panel: Panel, { shapeIds, edgeIds, board }: FrameState, items: MiroItem[]) {
    const remote = new Map(items.map(item => [item.id, item]));
    const cards: Card[] = [];
    for (const [id, remoteId] of shapeIds) {
      let item = remote.get(remoteId);
      if (!item) {
        try {
          item = await request<MiroItem>(boardId, `/shapes/${remoteId}`);
          items.push(item);
        } catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
        }
      }
      const rect = item && bounds(item);
      const last = board.cards.find(card => card.id === id);
      const relative = item?.position?.relativeTo === 'parent_top_left';
      const expectedParent = panel.native ? relative && item?.parent?.id === panel.id : !relative && !item?.parent;
      const local = rect && { ...rect, x: rect.x - (relative ? 0 : panel.rect.x), y: rect.y - (relative ? 0 : panel.rect.y) };
      if (!local || !item || !last || !expectedParent || (item.geometry?.rotation ?? 0) !== 0 ||
          !contains({ x: 0, y: 0, width: panel.rect.width, height: panel.rect.height }, local) ||
          local.width !== last.width || local.height !== last.height ||
          plain(item.data?.content) !== normalizeMiroText(last.text)) {
        shapeIds.delete(id);
        continue;
      }
      cards.push({ ...last, ...local });
    }
    const arrows = board.arrows.filter(arrow => {
      if (shapeIds.has(arrow.from) && shapeIds.has(arrow.to)) return true;
      edgeIds.delete(arrowKey(arrow));
      return false;
    });
    const updatedPanel = panelsFor(items, states).find(candidate => candidate.id === panel.id) ?? panel;
    return { width: panel.rect.width, height: panel.rect.height, frameId: panel.id, obstacles: updatedPanel.elements,
      board: { ...board, cards, arrows } };
  }

  function shapePayload(card: Card, panel: Panel) {
    return {
      data: { shape: 'round_rectangle', content: card.type === 'title' ? `<b>${escape(card.text)}</b>` : escape(card.text) },
      style: MIRO_STYLES[card.type],
      position: { x: card.x + card.width / 2 + (panel.native ? 0 : panel.rect.x),
        y: card.y + card.height / 2 + (panel.native ? 0 : panel.rect.y),
        origin: 'center' },
      geometry: { width: card.width, height: card.height },
    };
  }

  async function deleteIfPresent(boardId: string, path: string) {
    try {
      await request(boardId, path, 'DELETE');
    } catch (error) {
      if ((error as { status?: number }).status !== 404) throw error;
    }
  }

  async function apply(boardId: string, panel: Panel, next: Board, current: Board, state: FrameState, area: Rect) {
    const { shapeIds, edgeIds } = state;
    const targetIds = new Set(next.cards.map(card => card.id));
    const remaining = current.cards.filter(card => targetIds.has(card.id));
    let moves = planCardMoves(current.cards, next.cards, area, panel.elements);
    const removeFirst = !moves;
    if (!moves) moves = planCardMoves(remaining, next.cards, area, panel.elements);
    if (!moves) throw Error('カードが重ならない移動順序を作れなかったため、今回の再配置は保留しました。');
    state.board = current;
    function rememberCard(card: Card) {
      state.board = { ...state.board,
        cards: state.board.cards.some(item => item.id === card.id)
          ? state.board.cards.map(item => item.id === card.id ? card : item)
          : [...state.board.cards, card] };
    }
    function rememberArrow(edge: Board['arrows'][number]) {
      const key = arrowKey(edge);
      state.board = { ...state.board,
        arrows: [...state.board.arrows.filter(item => arrowKey(item) !== key), edge] };
    }
    async function removeUnusedCards() {
      for (const [id, remoteId] of shapeIds) {
        if (targetIds.has(id)) continue;
        await deleteIfPresent(boardId, `/items/${remoteId}`);
        shapeIds.delete(id);
        for (const edge of state.board.arrows) {
          if (edge.from === id || edge.to === id) edgeIds.delete(arrowKey(edge));
        }
        state.board = { ...state.board, cards: state.board.cards.filter(card => card.id !== id),
          arrows: state.board.arrows.filter(edge => edge.from !== id && edge.to !== id) };
      }
    }
    if (removeFirst) await removeUnusedCards();
    for (const card of moves) {
      const remoteId = shapeIds.get(card.id);
      if (remoteId) await request(boardId, `/shapes/${remoteId}`, 'PATCH', shapePayload(card, panel));
      else {
        const created = await request<{ id: string }>(boardId, '/shapes', 'POST', { ...shapePayload(card, panel), ...(panel.native && { parent: { id: panel.id } }) });
        shapeIds.set(card.id, created.id);
      }
      rememberCard(card);
    }
    const edges = new Map(next.arrows.map(arrow => [arrowKey(arrow), arrow]));
    for (const [key, existing] of edgeIds) {
      if (edges.has(key)) continue;
      await deleteIfPresent(boardId, `/connectors/${existing.id}`);
      edgeIds.delete(key);
      state.board = { ...state.board, arrows: state.board.arrows.filter(arrow => arrowKey(arrow) !== key) };
    }
    for (const [key, edge] of edges) {
      const route = routeArrow(next, edge, panel.elements)!;
      const { fromSide, toSide, shape } = route;
      const label = visibleArrowLabel(route, edge.label, [...next.cards, ...panel.elements]);
      let existing = edgeIds.get(key);
      if (existing?.label === label && existing.fromSide === fromSide && existing.toSide === toSide && existing.shape === shape) continue;
      const captions = label ? [{ content: escape(label), position: '50%' }] : [];
      const style = { endStrokeCap: 'arrow', textOrientation: 'horizontal' };
      const geometry = {
        startItem: { id: shapeIds.get(edge.from), snapTo: fromSide },
        endItem: { id: shapeIds.get(edge.to), snapTo: toSide },
        shape,
      };
      if (existing) {
        try {
          await request(boardId, `/connectors/${existing.id}`, 'PATCH', { ...geometry, captions, style });
          edgeIds.set(key, { ...existing, label, fromSide, toSide, shape });
        } catch (error) {
          if ((error as { status?: number }).status !== 404) throw error;
          edgeIds.delete(key);
          state.board = { ...state.board, arrows: state.board.arrows.filter(arrow => arrowKey(arrow) !== key) };
          existing = undefined;
        }
      }
      if (!existing) {
        const created = await request<{ id: string }>(boardId, '/connectors', 'POST', {
          ...geometry, style, captions,
        });
        edgeIds.set(key, { id: created.id, label, fromSide, toSide, shape });
      }
      rememberArrow(edge);
    }
    if (!removeFirst) await removeUnusedCards();
    state.board = next;
  }

  return async (req: Request, tracking?: unknown, includeTracking = false): Promise<Response> => {
    const send = (status: number, body: object) => Response.json(body, { status });
    if (!token) return send(503, { error: 'Miro のアクセストークンを設定してください。' });
    if (req.method !== 'GET' && req.method !== 'PUT') return send(405, { error: 'Unsupported method' });
    const query = new URL(req.url).searchParams;
    const boardId = query.get('boardId') ?? '';
    if (!isMiroBoardId(boardId)) return send(400, { error: 'Miro会場に投稿先ボードの URL を入力してください。' });
    if (busyBoards.has(boardId)) return send(409, { error: 'この Miro ボードの更新が進行中です。' });
    const expectedId = query.get('frameId');
    const listing = req.method === 'GET' && query.get('mode') === 'panels';
    if (!listing && !expectedId) return send(400, { error: '書き込み先を特定できません。' });
    busyBoards.add(boardId);
    const states = boardStates.get(boardId) ?? new Map<string, FrameState>();
    boardStates.set(boardId, states);
    if (includeTracking && tracking && expectedId) {
      try {
        const incoming = tracking as { board: Board; shapes: [string, string][]; edges: [string, FrameState['edgeIds'] extends Map<string, infer Edge> ? Edge : never][] };
        if (incoming.shapes.length > 64 || incoming.edges.length > 96 ||
            incoming.shapes.some(([, id]) => typeof id !== 'string' || !/^\d+$/.test(id)) ||
            incoming.edges.some(([, edge]) => typeof edge.id !== 'string' || !/^\d+$/.test(edge.id))) {
          throw Error('Invalid tracking');
        }
        validateBoard(incoming.board, Infinity, Infinity);
        states.set(expectedId, { board: incoming.board, shapeIds: new Map(incoming.shapes), edgeIds: new Map(incoming.edges) });
      } catch {
        busyBoards.delete(boardId);
        return send(400, { error: 'Miro カードの追跡情報を読み込めません。' });
      }
    }
    try {
      const { items, panels } = await readBoard(boardId, states);
      if (listing) return send(200, { boardId, panels });
      const panel = panels.find(candidate => candidate.id === expectedId);
      if (!panel) return send(409, { error: '選んだ書き込み先を現在の盤面で確認できません。' });
      let state = states.get(panel.id);
      if (!state) {
        state = { shapeIds: new Map(), edgeIds: new Map(), board: emptyBoard };
        states.set(panel.id, state);
      }
      const respond = (status: number, body: object) => send(status, {
        ...body,
        ...(includeTracking && { tracking: { board: state.board, shapes: [...state.shapeIds], edges: [...state.edgeIds] } }),
      });
      const current = await snapshot(boardId, states, panel, state, items);
      const currentPanel = { ...panel, elements: current.obstacles };
      if (req.method === 'GET') return respond(200, current);
      const body = await req.text();
      if (body.length > 48000) return send(413, { error: '編集案が大きすぎます。' });
      const { next, baseline, area } = JSON.parse(body) as { next: Board; baseline: Board; area: Rect };
      const geometry = (value: Board) => [...value.cards].sort((a, b) => a.id.localeCompare(b.id)).map(c => [c.id,c.x,c.y,c.width,c.height,c.text]);
      if (!baseline || JSON.stringify(geometry(baseline)) !== JSON.stringify(geometry(current.board))) {
        return send(409, { error: '編集案を作成中に Miro の配置が変わりました。再度実行してください。' });
      }
      validateBoard(next, current.width, current.height);
      if (next.cards.some(card => {
        const geometry = miroNodeGeometry(card.text, card.type);
        return card.width !== geometry.width || card.height !== geometry.height;
      })) return send(409, { error: 'カードの寸法が既存の書式と一致しません。' });
      if (!area || ![area.x, area.y, area.width, area.height].every(Number.isFinite) ||
          area.width <= 0 || area.height <= 0 || !contains({ x: 0, y: 0, width: current.width, height: current.height }, area) ||
          next.cards.some(card => !contains(area, card) || currentPanel.elements.some(item => overlaps(item, card)))) {
        return send(409, { error: '編集案が書き込み領域をはみ出すか、既存の要素と重なっています。' });
      }
      const cleared = { ...next, arrows: next.arrows.filter(edge => routeArrow(next, edge, currentPanel.elements)) };
      try {
        await apply(boardId, currentPanel, cleared, current.board, state, area);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        return respond(502, { error: `Miro の一部更新に失敗しました。反映済みの内容を保持しました（${detail}）。` });
      }
      try {
        const fresh = await readBoard(boardId, states);
        return respond(200, await snapshot(boardId, states, panel, state, fresh.items));
      } catch {
        return respond(502, { error: 'Miro への反映後に盤面を取得できませんでした。' });
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403 || status === 404) return send(status, { error: 'この Miro ボードにアクセスできません。URL とアクセストークンの権限を確認してください。' });
      return send(502, { error: error instanceof Error ? error.message : String(error) });
    } finally { busyBoards.delete(boardId); }
  };
}
