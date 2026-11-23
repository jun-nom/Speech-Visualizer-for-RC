const statusLine = document.getElementById('status');
const worker = crypto.randomUUID();
let started = false;

async function request(data) {
  const response = await fetch('/api/miro-viewport', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(data.wait ? 25000 : 5000),
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error), { status: response.status });
  return result;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Miro SDK の応答がありません。')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function showsTarget(view, target) {
  const xMargin = target.width * 0.06;
  const yMargin = target.height * 0.06;
  return view.x <= target.x + xMargin && view.y <= target.y + yMargin &&
    view.x + view.width >= target.x + target.width - xMargin &&
    view.y + view.height >= target.y + target.height - yMargin &&
    Math.min(view.width / target.width, view.height / target.height) < 1.65;
}

async function moveViewport(viewport) {
  const api = miro.board.viewport;
  try {
    await withTimeout(api.set({ viewport, animationDurationInMs: 1,
      padding: { top: 16, bottom: 16, left: 16, right: 16 } }), 6500);
  } catch {
    const actual = await withTimeout(api.get(), 5000);
    if (!showsTarget(actual, viewport)) throw new Error('Miro が指定の発表枠を表示できませんでした。');
  }
}

async function connect() {
  const { id: boardId } = await miro.board.getInfo();
  const identity = { worker, boardId };
  await request({ ...identity, action: 'claim' });
  let previous;
  async function poll() {
    let retryDelay = 0;
    try {
      const result = await request({ ...identity, action: 'poll', wait: true });
      statusLine.textContent = 'Speech Visualizer に接続中';
      if (result.move) {
        const { id, viewport } = result.move;
        if (previous?.id !== id) {
          const complete = { ...identity, action: 'complete', id };
          try {
            await moveViewport(viewport);
          } catch (error) {
            complete.error = error instanceof Error ? error.message : 'Miro が画面の移動を完了できませんでした。';
          }
          previous = complete;
        }
        await request(previous);
      }
    } catch (error) {
      statusLine.textContent = error.message;
      if (error.status === 409) {
        started = false;
        return;
      }
      retryDelay = 1000;
    }
    if (retryDelay) setTimeout(poll, retryDelay);
    else void poll();
  }
  void poll();
}

if (window.parent === window || !window.miro) {
  statusLine.textContent = '対象のボードから Speech Visualizer アプリを開いてください。';
} else {
  void miro.board.ui.on('icon:click', async () => {
    if (started) return;
    started = true;
    try {
      await connect();
      await miro.board.notifications.showInfo('Speech Visualizer に接続しました');
    } catch (error) {
      started = false;
      const reason = error instanceof Error ? error.message : '';
      await miro.board.notifications.showError(reason || 'Speech Visualizer に接続できませんでした');
    }
  });
}
