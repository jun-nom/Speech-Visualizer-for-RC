export function isMiroBoardId(value: string) {
  return /^[A-Za-z0-9_-]{6,128}={0,2}$/.test(value);
}

export function extractMiroBoardId(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !['miro.com', 'www.miro.com'].includes(url.hostname)) return null;
    const segment = url.pathname.match(/^\/app\/(?:board|live-embed)\/([^/]+)\/?$/)?.[1];
    const id = segment ? decodeURIComponent(segment) : '';
    return isMiroBoardId(id) ? id : null;
  } catch {
    return null;
  }
}
