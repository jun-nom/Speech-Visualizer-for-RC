const referenceUrls = [
  new URL('../../assets/layout-references/branch-and-merge.png', import.meta.url).href,
  new URL('../../assets/layout-references/parallel-topics.png', import.meta.url).href,
];

let cached: Promise<string[]> | undefined;

export function loadMiroLayoutReferences() {
  cached ??= Promise.all(referenceUrls.map(async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error('レイアウトの参考画像を読み込めませんでした。');
    const file = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  })).catch(error => {
    cached = undefined;
    throw error;
  });
  return cached;
}
