import { contains, overlaps, type Panel, type Rect } from '../../../dev/miro-panels';
import { loadMiroLayoutReferences } from '../utils/miroLayoutReferences';
import { layoutSpeechFlow } from '../utils/miroFlowLayout';
import { planCardMoves } from '../utils/miroCardTransition';
import { routeArrow } from '../utils/miroArrowRouting';
import { createMiroOperationQueue } from '../utils/miroOperationQueue';
import { MIRO_NODE_WIDTH } from '../utils/miroCardStyle';
import { renderPanel } from '../utils/miroPanelImage';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { FlowNode } from '../App';
import { TranscriptionButton } from './TranscriptionButton';
import { appendNodes, identifyFrame, MAX_POST_WAIT_SECONDS, proposeBoard, publicationSize, readPlayerTitles, matchVisibleMiroTitle, type Board, type Evidence } from '../utils/rehearsal';

type MiroState = { width: number; height: number; frameId: string; frameTitle: string; board: Board; obstacles: Panel['elements'] };
type EditJob = {
  boardId: string; panelId: string; title: string; area: Rect; panel: Panel; evidence: Evidence[];
  final?: boolean; attempt?: number; availableAt?: number;
};
const editKey = (job: EditJob) => `${job.boardId}:${job.panelId}`;

type MiroUpdate = { next: Board; baseline: Board; area: Rect };

function createMiroClient(token: string) {
  const tracking = new Map<string, unknown>();
  async function request<T>(query: URLSearchParams, update?: MiroUpdate): Promise<T> {
    const key = `${query.get('boardId')}:${query.get('frameId')}`;
    const response = await fetch(`/api/rehearsal-miro?${query}`, import.meta.env.DEV ? update && {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update),
    } : {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ update, tracking: tracking.get(key) }),
    });
    const data = await response.json();
    if (data.tracking) tracking.set(key, data.tracking);
    if (!response.ok) throw Error(data.error || 'Miro への接続に失敗しました。');
    return data;
  }
  return {
    state: (boardId: string, frameId: string, update?: MiroUpdate) =>
      request<Omit<MiroState, 'frameTitle'>>(new URLSearchParams({ boardId, frameId }), update),
    panels: (boardId: string) =>
      request<{ boardId: string; panels: Panel[] }>(new URLSearchParams({ mode: 'panels', boardId })),
  };
}

export function LiveVisualization({ openaiKey, deepgramKey, miroToken, model, onLiveTranscript, onMiroDestination, onLiveState, generateNodes, canStart, sessionId, onManualTranscript, onManualInterimTranscript, onManualFrame, statusTarget, startTarget, venueBoardId, onRecordingState }: {
  openaiKey: string; deepgramKey: string; miroToken: string; model: string;
  onLiveTranscript: (update: { text: string; final: boolean } | { consumed: number } | null) => void;
  onLiveState: (active: boolean) => void;
  onRecordingState: (recording: boolean) => void;
  canStart: boolean;
  venueBoardId: string | null;
  statusTarget: HTMLElement | null;
  startTarget: HTMLElement | null;
  onManualTranscript: (text: string) => void;
  onManualInterimTranscript: (text: string) => void;
  onManualFrame: (base64: string) => void;
  sessionId?: string;
  generateNodes: (sessionId: string, text: string, frame?: string) => Promise<FlowNode[]>;
  onMiroDestination: (boardId: string, viewport: Rect) => void;
}) {
  const client = useMemo(() => createMiroClient(miroToken), [miroToken]);
  const lastTitleEvidence = useRef('');
  const [miro, setMiro] = useState<MiroState>();
  const [status, setStatus] = useState('');
  const [editorStatus, setEditorStatus] = useState('');
  const [deferredCount, setDeferredCount] = useState(0);
  const editQueue = useRef(new Map<string, EditJob>());
  const editorRunning = useRef(new Set<string>());
  const postedBatches = useRef(new Map<string, number>());
  const lastPostedEdit = useRef<EditJob>();
  const writes = useRef(createMiroOperationQueue());
  const focusedPanel = useRef<string>();
  const continueImmediately = useRef(false);
  const areas = useRef(new Map<string, Rect>());
  const [autoMiro, setAutoMiro] = useState(true);
  const [recording, setRecording] = useState(false);
  const recordingMode = useRef(false);
  const [received, setReceived] = useState(0);
  const [audioError, setAudioError] = useState('');
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const liveSession = useRef<string>();
  const liveBoard = useRef<string>();
  const generated = useRef<{ cursor: number; count: number; panelId: string; nodes: FlowNode[] }>();
  useEffect(() => onLiveState(automatic || finishing || busy), [automatic, finishing, busy, onLiveState]);
  const contextStart = useRef(0);
  const start = useRef(Date.now());
  const frame = useRef<{ at: number; image: string }>();
  const titleFrames = useRef<{ at: number; image: string }[]>([]);
  const lastTitleCapture = useRef(-1);
  const titleScannedThrough = useRef(-1);
  const titles = useRef<{ at: number; title: string }[]>([]);
  const deferredPosts = useRef<(() => Promise<void>)[]>([]);
  const evidence = useRef<Evidence[]>([]);
  const processed = useRef(0);
  const running = useRef(false);
  const now = () => Math.round((Date.now() - start.current) / 1000);

  function queueEdit(job: EditJob) {
    const key = editKey(job);
    const queued = editQueue.current.get(key);
    if (!job.final && !queued?.final && (postedBatches.current.get(key) ?? 0) < 2) return;
    editQueue.current.set(key, { ...job, final: job.final || queued?.final });
    queueMicrotask(() => { void editLatest.current(); });
  }

  function finalizePreviousEdit() {
    const previous = lastPostedEdit.current;
    if (!previous) return;
    queueEdit({ ...previous, final: true });
    lastPostedEdit.current = undefined;
  }

  function retryEdit(job: EditJob) {
    const key = editKey(job);
    if (editQueue.current.has(key)) return true;
    const attempt = (job.attempt ?? 0) + 1;
    if (attempt > 3) return false;
    editQueue.current.set(key, { ...job, attempt, availableAt: Date.now() + 5000 * attempt });
    return true;
  }

  async function editBoard() {
    if (editorRunning.current.size >= 2 || !openaiKey) return;
    const job = [...editQueue.current.values()].find(item =>
      !editorRunning.current.has(editKey(item)) && (item.availableAt ?? 0) <= Date.now());
    if (!job) return;
    const key = editKey(job);
    editQueue.current.delete(key);
    editorRunning.current.add(key);
    setEditorStatus(`${job.final ? '最終整理中' : '整理中'}｜${job.title}`);
    try {
      const current = await writes.current(() => client.state(job.boardId, job.panelId), false);
      if (!current.board.cards.length) {
        setEditorStatus('');
        return;
      }
      const panel = { ...job.panel, elements: current.obstacles };
      const references = await loadMiroLayoutReferences().catch(() => []);
      const image = renderPanel(panel, current.board);
      let next = await proposeBoard(openaiKey, model || 'gpt-4o', job.evidence,
        current.board, current.width, current.height, job.area, undefined, image, references, [], [], job.final);
      next = layoutSpeechFlow(next, next.topicRelations ?? [], job.area, panel.elements);
      const blocked = (board: Board) => board.arrows.filter(arrow => !routeArrow(board, arrow, panel.elements));
      const misplaced = (board: Board) => board.cards.filter(card =>
        !contains(job.area, card) || panel.elements.some(element => overlaps(element, card))).map(card => card.id);
      const firstBlocked = blocked(next);
      const firstMisplaced = misplaced(next);
      if (firstBlocked.length || firstMisplaced.length) {
        const repaired = await proposeBoard(openaiKey, model || 'gpt-4o', job.evidence,
          next, current.width, current.height, job.area, undefined, renderPanel(panel, next), references, firstBlocked, firstMisplaced, job.final)
          .catch(() => undefined);
        const clearCount = (board: Board) => board.arrows.length - blocked(board).length;
        if (repaired) {
          const revisedFlow = layoutSpeechFlow(repaired, repaired.topicRelations ?? next.topicRelations ?? [], job.area, panel.elements);
          if (!misplaced(revisedFlow).length && (firstMisplaced.length || clearCount(revisedFlow) > clearCount(next))) next = revisedFlow;
        }
      }
      const keptIds = new Set(next.cards.map(card => card.id));
      const canMove = !misplaced(next).length && (
        planCardMoves(current.board.cards, next.cards, job.area, panel.elements) ||
        planCardMoves(current.board.cards.filter(card => keptIds.has(card.id)), next.cards, job.area, panel.elements)
      );
      const partial = !canMove;
      if (partial) {
        const proposed = new Map(next.cards.map(card => [card.id, card]));
        const cards = current.board.cards.map(card => {
          const candidate = proposed.get(card.id);
          if (!candidate || candidate.width !== card.width || candidate.height !== card.height ||
              !contains(job.area, card) || panel.elements.some(item => overlaps(card, item))) return card;
          return { ...card, text: candidate.text, type: candidate.type };
        });
        const safeBoard = { ...current.board, cards };
        const arrows = new Map(current.board.arrows.map(arrow => [JSON.stringify([arrow.from, arrow.to]), arrow]));
        for (const arrow of next.arrows) {
          if (routeArrow(safeBoard, arrow, panel.elements)) arrows.set(JSON.stringify([arrow.from, arrow.to]), arrow);
        }
        next = { ...safeBoard, arrows: [...arrows.values()] };
        if (misplaced(next).length) throw Error('記入欄に収まる整理案がまだ見つかりません。');
      }
      const changed = await writes.current(async () => {
        if (!job.final && editQueue.current.get(key)?.final) return false;
        const latest = await client.state(job.boardId, job.panelId);
        if (JSON.stringify(latest.board) !== JSON.stringify(current.board)) {
          throw Error('盤面が更新されたため、最新の配置を読み直します。');
        }
        if (JSON.stringify([next.cards, next.arrows]) === JSON.stringify([latest.board.cards, latest.board.arrows])) return false;
        await client.state(job.boardId, job.panelId, { next, baseline: latest.board, area: job.area });
        return true;
      }, false);
      if (partial) {
        const retry = retryEdit(job);
        setEditorStatus(`${changed ? '安全に反映できる部分を整理' : '再配置を保留'}｜${job.title}${retry ? '（再試行予定）' : ''}`);
      } else {
        setEditorStatus(job.final ? `最終整理済み｜${job.title}` : changed ? `整理済み｜${job.title}` : '');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const retry = retryEdit(job);
      setEditorStatus(`${retry ? '整理を再試行予定' : '整理を保留'}｜${job.title}（${message}）`);
    } finally {
      editorRunning.current.delete(key);
      queueMicrotask(() => { void editLatest.current(); });
    }
  }

  async function revise() {
    if (running.current) return;
    if (!openaiKey) { setStatus('設定で OpenAI API キーを登録してください。'); setFinishing(false); return; }
    const pending = evidence.current.slice(processed.current);
    if (!pending.length) { if (finishing) finalizePreviousEdit(); setFinishing(false); return; }
    const titleCaptureAt = lastTitleCapture.current;
    if (!finishing && titleCaptureAt <= pending[0].at && titleCaptureAt > titleScannedThrough.current &&
        now() - pending[0].at < 12) {
      setStatus('動画内の発表タイトルを確認しています…');
      return;
    }
    const deadline = now() - pending[0].at >= MAX_POST_WAIT_SECONDS;
    const signature = `${processed.current}:${evidence.current.length}:${frame.current?.at ?? ''}:${deadline || finishing}:${titles.current.at(-1)?.at ?? ''}`;
    if (lastTitleEvidence.current === signature) { if (finishing) finalizePreviousEdit(); setFinishing(false); return; }
    running.current = true;
    setBusy(true);
    setStatus('発話・画像・盤面を照合しています…');
    try {
      const cursor = processed.current;
      const boardId = liveBoard.current;
      if (!boardId) throw Error('Miro会場に投稿先ボードの URL を入力してください。');
      const data = await writes.current(() => client.panels(boardId));
      if (data.boardId !== boardId || !data.panels?.length) throw Error('Miro ボードで発表の候補領域を確認できません。');
      const context = evidence.current.slice(Math.max(contextStart.current, cursor - 12), cursor);
      const candidates = data.panels;
      const headings = candidates.map(panel => panel.elements.map(element => element.text).filter(Boolean));
      const observations = titles.current.map(item => ({ ...item, matches: matchVisibleMiroTitle(item.title, headings) }))
        .filter(item => item.matches.length === 1);
      const activeTitle = observations.filter(item => item.at <= pending[0].at).at(-1);
      const nextTitle = activeTitle && observations.find(item => item.at > pending[0].at && item.matches[0] !== activeTitle.matches[0]);
      const boundary = nextTitle ? pending.findIndex(item => item.at >= nextTitle.at) : -1;
      const batch = boundary > 0 ? pending.slice(0, boundary) : pending;
      const panelImages = candidates.map(panel => renderPanel(panel));
      const match = await identifyFrame(openaiKey, model || 'gpt-4o', [...context, ...batch], panelImages, context.length, miro?.frameTitle,
        headings, activeTitle?.title);
      if (match.skip) {
        processed.current = cursor + match.skip;
        continueImmediately.current = evidence.current.length > processed.current;
        onLiveTranscript({ consumed: match.skip });
        contextStart.current = processed.current;
        setStatus('発表外の進行案内を除きました。');
        return;
      }
      if (match.index === undefined || !match.area || !match.title || !match.count) {
        lastTitleEvidence.current = signature;
        setStatus(match.ambiguousTitle ? '同じ発表タイトルの Miro 枠が複数あり、投稿先を保留しています。' : '発表と書き込み先を特定できるまで発話を保留しています。');
        if (finishing) finalizePreviousEdit();
        setFinishing(false);
        return;
      }
      const panel = candidates[match.index];
      const region = match.area;
      const width = region.width * panel.rect.width / 1000;
      const leftInset = Math.min(Math.max(0, width - MIRO_NODE_WIDTH - 160), MIRO_NODE_WIDTH * 0.4, panel.rect.width * 0.035);
      const area = areas.current.get(panel.id) ?? {
        x: region.x * panel.rect.width / 1000 + leftInset,
        y: region.y * panel.rect.height / 1000,
        width: width - leftInset,
        height: region.height * panel.rect.height / 1000,
      };
      const samePanel = miro?.frameId === panel.id;
      const switched = !!miro && !samePanel;
      if (switched && focusedPanel.current !== panel.id) {
        focusedPanel.current = panel.id;
        onMiroDestination(boardId, panel.rect);
      }
      if (lastPostedEdit.current && editKey(lastPostedEdit.current) !== `${boardId}:${panel.id}`) finalizePreviousEdit();
      const matchedCount = boundary > 0 ? boundary : match.count;
      const confirmedEnd = cursor + matchedCount;
      const editorEvidence = evidence.current.slice(Math.max(samePanel ? contextStart.current : cursor, confirmedEnd - 70), confirmedEnd);
      const edit = { boardId, panelId: panel.id, title: match.title, area, panel, evidence: editorEvidence };
      const retry = generated.current;
      const retryCount = retry?.cursor === cursor && retry.panelId === panel.id && retry.count <= confirmedEnd
        ? retry.count - cursor : 0;
      const firstPost = !postedBatches.current.has(editKey(edit));
      const publishCount = (boundary > 0 ? boundary : retryCount) || publicationSize(matchedCount, match.topicEnd, now() - pending[0].at, finishing, match.sessionEnd || boundary > 0, firstPost);
      if (!publishCount) {
        lastTitleEvidence.current = signature;
        if (samePanel && lastPostedEdit.current) {
          lastPostedEdit.current = edit;
          queueEdit(edit);
        }
        setStatus('話題の切れ目を確認中。約3分で途中でも投稿します。');
        return;
      }
      const count = cursor + publishCount;
      const chunk = evidence.current.slice(cursor, count);
      let prepared = generated.current;
      if (!prepared || prepared.cursor !== cursor || prepared.count !== count || prepared.panelId !== panel.id) {
        if (!liveSession.current) throw Error('先にスピーチのセッションを選んでください。');
        setStatus('スピーチフローのノードを生成しています…');
        const nodes = await generateNodes(liveSession.current, chunk.map(item => item.text).join('\n'),
          [...chunk].reverse().find(item => item.image)?.image);
        prepared = { cursor, count, panelId: panel.id, nodes };
        generated.current = prepared;
      }
      if (!prepared.nodes.length) throw Error('ノードを生成できませんでした。発話を保留しています。');
      if (samePanel && lastPostedEdit.current) queueEdit(edit);
      const nodes = prepared.nodes.map((node, index) => ({
        id: `live-${start.current}-${cursor}-${index}`, text: node.content, type: node.type,
        topicId: `live-${start.current}-${cursor}-${node.topicId}`,
      }));
      const publish = () => writes.current(async () => {
        const current = await client.state(boardId, panel.id);
        const next = appendNodes(current.board, nodes, area, current.obstacles);
        return client.state(boardId, panel.id, { next, baseline: current.board, area });
      });
      let applied;
      try {
        applied = await publish();
      } catch (error) {
        if (boundary <= 0 || count !== cursor + boundary ||
            !(error instanceof Error) || !error.message.startsWith('話題をまとめて置ける空き')) throw error;
        deferredPosts.current.push(async () => {
          await publish();
          queueEdit({ ...edit, final: true });
        });
        setDeferredCount(value => value + 1);
        finalizePreviousEdit();
        processed.current = count;
        generated.current = undefined;
        contextStart.current = count;
        continueImmediately.current = true;
        onLiveTranscript({ consumed: publishCount });
        setStatus(`前の発表の投稿を保留し、次の発表へ切り替えます｜${nextTitle?.title}`);
        return;
      }
      areas.current.set(panel.id, area);
      const key = editKey(edit);
      postedBatches.current.set(key, (postedBatches.current.get(key) ?? 0) + 1);
      lastPostedEdit.current = edit;
      queueEdit(edit);
      if (!samePanel) {
        contextStart.current = cursor;
        if (focusedPanel.current !== panel.id) {
          focusedPanel.current = panel.id;
          onMiroDestination(boardId, panel.rect);
        }
      }
      setMiro({ ...applied, frameTitle: match.title });
      processed.current = count;
      if (match.sessionEnd || boundary > 0) continueImmediately.current = true;
      generated.current = undefined;
      onLiveTranscript({ consumed: count - cursor });
      setStatus(`Miro に投稿済み｜${match.title}（カード ${applied.board.cards.length} 枚）`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      if (finishing) finalizePreviousEdit();
      setFinishing(false);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  const reviseLatest = useRef(revise);
  reviseLatest.current = revise;
  useEffect(() => {
    if ((!automatic && !finishing) || busy) return;
    if (finishing) {
      const timer = setTimeout(() => { void reviseLatest.current(); }, 0);
      return () => clearTimeout(timer);
    }
    const immediate = continueImmediately.current ? setTimeout(() => { void reviseLatest.current(); }, 0) : undefined;
    continueImmediately.current = false;
    const timer = setInterval(() => { void reviseLatest.current(); }, 5000);
    return () => {
      clearTimeout(immediate);
      clearInterval(timer);
    };
  }, [automatic, finishing, busy]);

  const editLatest = useRef(editBoard);
  editLatest.current = editBoard;
  useEffect(() => {
    const timer = setInterval(() => { void editLatest.current(); }, 5000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!automatic || !openaiKey) return;
    let cancelled = false;
    let reading = false;
    const timer = setInterval(async () => {
      if (reading || !titleFrames.current.length) return;
      reading = true;
      const frames = titleFrames.current.splice(0, 4);
      try {
        const found = await readPlayerTitles(openaiKey, model || 'gpt-4o', frames);
        if (!cancelled) {
          titles.current.push(...found);
          titleScannedThrough.current = frames[frames.length - 1].at;
        }
      } catch {
        if (!cancelled) titleFrames.current.unshift(...frames.slice(-1));
      } finally {
        reading = false;
      }
    }, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [automatic, openaiKey, model]);

  useEffect(() => {
    let retrying = false;
    const timer = setInterval(async () => {
      if (retrying || !deferredPosts.current.length) return;
      const post = deferredPosts.current.shift()!;
      retrying = true;
      try {
        await post();
        setDeferredCount(value => value - 1);
      } catch {
        deferredPosts.current.push(post);
      } finally {
        retrying = false;
      }
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  function reset() {
    setStatus('');
    finalizePreviousEdit();
    areas.current.clear();
    postedBatches.current.clear();
    focusedPanel.current = undefined;
    continueImmediately.current = false;
    setReceived(0);
    setAudioError('');
    onLiveTranscript(null);
    evidence.current = [];
    processed.current = 0;
    generated.current = undefined;
    contextStart.current = 0;
    frame.current = undefined;
    titleFrames.current = [];
    titles.current = [];
    titleScannedThrough.current = -1;
    lastTitleCapture.current = -1;
    lastTitleEvidence.current = '';
    start.current = Date.now();
  }

  return (
    <div className="flex items-center gap-2">
      {statusTarget && (automatic || received > 0 || audioError || status || editorStatus || deferredCount > 0) && createPortal(
        <div role="status" className="space-y-1 text-xs leading-relaxed text-slate-600">
          {(automatic || received > 0 || audioError) && (
            <p>{audioError || (received ? `文字起こしを ${received} 件受信` : 'YouTube の発話を待機中')}</p>
          )}
          {status && <p>{status}</p>}
          {deferredCount > 0 && <p>前の発表で空き待ちの投稿 {deferredCount} 件を再試行中</p>}
          {editorStatus && <p>{editorStatus}</p>}
        </div>,
        statusTarget,
      )}
      <label className="flex items-center gap-1.5 whitespace-nowrap text-sm">
        <input type="checkbox" checked={autoMiro} disabled={recording || busy || finishing}
          onChange={event => setAutoMiro(event.target.checked)} />
        自動Miro描画
      </label>
      {startTarget && createPortal(<TranscriptionButton frameIntervalMs={autoMiro ? 2000 : 10000} deepgramApiKey={deepgramKey}
        startLabel="ライブ可視化を開始"
        beforeStart={() => {
          if (!venueBoardId) {
            setStatus('Connect で Miro の URL を確定してください。');
            return false;
          }
          if (autoMiro && !import.meta.env.DEV && !miroToken) {
            setStatus('設定で Miro のアクセストークンを登録してください。');
            return false;
          }
          liveBoard.current = autoMiro ? venueBoardId ?? undefined : undefined;
          return true;
        }}
        startDisabled={busy || finishing || !venueBoardId || (autoMiro && !canStart)}
        onRecordingChange={active => {
          setRecording(active);
          onRecordingState(active);
          if (active) {
            recordingMode.current = autoMiro;
            reset();
            if (recordingMode.current) {
              liveSession.current = sessionId;
              setMiro(undefined);
              setStatus(openaiKey ? '発表を判定しています。' : '設定で OpenAI API キーを登録してください。');
            }
          }
          setAutomatic(active && recordingMode.current);
          setFinishing(!active && recordingMode.current);
        }}
        onError={setAudioError}
        onInterimTranscript={text => {
          if (recordingMode.current) onLiveTranscript({ text, final: false });
          else onManualInterimTranscript(text);
        }}
        onTranscript={text => {
          if (!recordingMode.current) {
            onManualTranscript(text);
            return;
          }
          setReceived(count => count + 1);
          onLiveTranscript({ text, final: true });
          const at = now();
          evidence.current.push({ at, text, image: frame.current?.image, imageAt: frame.current?.at });
        }}
        onTitleFrame={autoMiro ? base64 => {
          if (!recordingMode.current) return;
          const at = now();
          lastTitleCapture.current = at;
          titleFrames.current.push({ at, image: `data:image/jpeg;base64,${base64}` });
          if (titleFrames.current.length > 12) titleFrames.current.shift();
        } : undefined}
        onNewFrame={base64 => {
          if (recordingMode.current) frame.current = { at: now(), image: `data:image/jpeg;base64,${base64}` };
          else onManualFrame(base64);
        }} />, startTarget)}

    </div>
  );
}
