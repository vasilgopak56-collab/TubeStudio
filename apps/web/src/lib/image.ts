export type LocalImageMetrics = { brightness: number; contrast: number; colorfulness: number; width: number; height: number };
type Local = LocalImageMetrics;

/** Локальные метрики изображения + сжатие до 1280px JPEG */
export async function prepareImage(file: File): Promise<{ url: string; b64: string; local: Local }> {
  const img = await new Promise<HTMLImageElement>((ok, err) => { const i = new Image(); i.onload = () => ok(i); i.onerror = err; i.src = URL.createObjectURL(file); });
  const W = img.naturalWidth, H = img.naturalHeight, k = Math.min(1, 1280 / W);
  const c = document.createElement("canvas"); c.width = Math.round(W * k); c.height = Math.round(H * k);
  const g = c.getContext("2d")!; g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, sL = 0, sL2 = 0, sRg = 0, sRg2 = 0, sYb = 0, sYb2 = 0;
  for (let i = 0; i < d.length; i += 16) { const r = d[i], gg = d[i + 1], b = d[i + 2], L = 0.299 * r + 0.587 * gg + 0.114 * b, rg = r - gg, yb = 0.5 * (r + gg) - b; n++; sL += L; sL2 += L * L; sRg += rg; sRg2 += rg * rg; sYb += yb; sYb2 += yb * yb; }
  const m = sL / n, sd = Math.sqrt(sL2 / n - m * m), mRg = sRg / n, mYb = sYb / n;
  const colorfulness = Math.sqrt(Math.max(0, sRg2 / n - mRg ** 2) + Math.max(0, sYb2 / n - mYb ** 2)) + 0.3 * Math.sqrt(mRg ** 2 + mYb ** 2);
  const url = c.toDataURL("image/jpeg", 0.9);
  return { url, b64: url.split(",")[1], local: { brightness: m, contrast: sd, colorfulness, width: W, height: H } };
}
