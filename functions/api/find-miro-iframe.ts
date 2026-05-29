export async function onRequestPost(context: { request: Request }) {
  const { url } = await context.request.json() as { url?: string };
  if (!url) return Response.json({ error: 'url is required' }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    if (!res.ok) return Response.json({ error: `HTTP ${res.status}` }, { status: 400 });

    const html = await res.text();
    const seen = new Set<string>();
    const miroUrls: string[] = [];

    const addUrl = (u: string) => {
      if (!seen.has(u)) { seen.add(u); miroUrls.push(u); }
    };

    // 1. <iframe src="...miro.com..."> を検索
    const iframeRegex = /<iframe[^>]+src=['"]([^'"]*miro\.com[^'"]*)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = iframeRegex.exec(html)) !== null) addUrl(m[1]);

    // 2. HTML全体（script含む）からMiro board/live-embed URLを検索
    const urlRegex = /https?:\/\/(?:www\.)?miro\.com\/app\/(?:board|live-embed)\/[^?#'"\s<>]+/gi;
    while ((m = urlRegex.exec(html)) !== null) addUrl(m[0]);

    return Response.json({ miroUrls });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
