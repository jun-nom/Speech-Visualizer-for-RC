export async function onRequestPost(context: { request: Request }) {
  const { url } = await context.request.json() as { url?: string };
  if (!url) return Response.json({ error: 'url is required' }, { status: 400 });

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
    });
    if (!res.ok) return Response.json({ error: `HTTP ${res.status}` }, { status: 400 });

    const html = await res.text();
    const miroUrls: string[] = [];
    const regex = /<iframe[^>]+src=['"]([^'"]*miro\.com[^'"]*)['"]/gi;
    let match;
    while ((match = regex.exec(html)) !== null) miroUrls.push(match[1]);

    return Response.json({ miroUrls });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
