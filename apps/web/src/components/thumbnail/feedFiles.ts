import { type Picture, type FeedDraft, type FeedSnapshot, MAX_FEED_JSON, MAX_FEED_PNG, parseFeedSnapshot, orderedFeed } from "./feedSnapshot";

/** Local raster only. Temporary decode URLs are released even when decoding fails. */
export async function readFeedPicture(file: File): Promise<Picture> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw Error("Нужен JPG, PNG или WebP. SVG и GIF не поддерживаются.");
  if (!file.size || file.size > 5 * 1024 * 1024) throw Error("Изображение должно быть непустым и не больше 5 МиБ.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (a: number, b: number) => String.fromCharCode(...bytes.slice(a, b));
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (!(file.type === "image/png" ? png : file.type === "image/jpeg" ? jpg : webp)) throw Error("Содержимое файла не соответствует выбранному формату изображения.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw Error("Не удалось прочитать изображение. Предыдущая обложка сохранена."); }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width > 8192 || height > 8192 || width * height > 20_000_000) throw Error("Размер изображения: до 8192 px по стороне и до 20 мегапикселей.");
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw Error("Браузер не поддерживает локальную обработку изображения.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { src: canvas.toDataURL("image/png"), width, height };
  } finally { URL.revokeObjectURL(url); }
}


async function decodePng(p: Picture): Promise<Picture> {
  const encoded = p.src.slice(22);
  let binary: string;
  try { binary = atob(encoded); } catch { throw Error("Повреждённый PNG в JSON. Предыдущий черновик сохранён."); }
  if (binary.length > MAX_FEED_PNG || btoa(binary) !== encoded) throw Error("PNG в JSON — до 5 МиБ, без посторонних данных.");
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  // Inspect dimensions before asking the browser to allocate a decoded raster.
  const view = new DataView(bytes.buffer);
  if (bytes.length < 33 || ![137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b) || view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || view.getUint32(16) !== p.width || view.getUint32(20) !== p.height) throw Error("Размер или содержимое PNG не соответствует JSON. Предыдущий черновик сохранён.");
  return readFeedPicture(new File([bytes], "feed.png", { type: "image/png" }));
}
export async function importFeedFile(file: File): Promise<FeedSnapshot> {
  if (!file.size || file.size > MAX_FEED_JSON) throw Error("Нужен непустой JSON макета до 16 МиБ. Предыдущий черновик сохранён.");
  const snapshot = parseFeedSnapshot(await file.text());
  // Decode sequentially. Apply nothing until every image has passed validation.
  for (const entry of [snapshot.own, ...snapshot.peers]) if (entry.picture) entry.picture = await decodePng(entry.picture);
  return snapshot;
}
async function portablePicture(p: Picture): Promise<Picture> {
  if (p.src.startsWith("data:image/png;base64,")) {
    // Uploaded pictures retain original dimensions in the editor; portable dimensions describe the normalized raster.
    const scale = Math.min(1, 1280 / Math.max(p.width, p.height));
    return decodePng({ src: p.src, width: Math.max(1, Math.round(p.width * scale)), height: Math.max(1, Math.round(p.height * scale)) });
  }
  const url = new URL(p.src, location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith("/files/") || url.username || url.password) throw Error("Экспорт разрешён только для выбранных локальных изображений.");
  const response = await fetch(url.pathname + url.search, { redirect: "error" });
  if (!response.ok || !response.body) throw Error("Сохранённый вариант недоступен. Загрузите изображение заново; макет не изменён.");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > MAX_FEED_PNG) throw Error("Сохранённое изображение больше 5 МиБ."); chunks.push(value); }
  } finally { await reader.cancel(); reader.releaseLock(); }
  const blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type")?.split(";")[0] || "" });
  const picture = await readFeedPicture(new File([blob], "variant", { type: blob.type }));
  const scale = Math.min(1, 1280 / Math.max(picture.width, picture.height));
  return decodePng({ ...picture, width: Math.max(1, Math.round(picture.width * scale)), height: Math.max(1, Math.round(picture.height * scale)) });
}
export async function prepareFeedSnapshot(draft: FeedDraft): Promise<FeedSnapshot> {
  const snapshot: FeedSnapshot = { ...structuredClone(draft), format: "tubestudio-feed", version: 1, createdAt: new Date().toISOString() };
  for (const entry of [snapshot.own, ...snapshot.peers]) if (entry.picture) entry.picture = await portablePicture(entry.picture);
  // Enforce the same aggregate limit on export and import. No partial exports.
  parseFeedSnapshot(JSON.stringify(snapshot));
  return snapshot;
}

/** Deterministic export layout: 3 × 360px grid or one 360px column, independent of viewport. */
export async function renderFeedPng(snapshot: FeedSnapshot): Promise<Blob> {
  await document.fonts.ready;
  const entries = orderedFeed(snapshot), cols = snapshot.mobile ? 1 : Math.min(3, entries.length);
  const margin = 24, cardW = 360, gap = 20, cardH = 356, header = 120;
  const canvas = document.createElement("canvas");
  canvas.width = margin * 2 + cols * cardW + (cols - 1) * gap;
  canvas.height = header + Math.ceil(entries.length / cols) * cardH + 64;
  const c = canvas.getContext("2d");
  if (!c) throw Error("Браузер не поддерживает экспорт PNG.");
  const fg = snapshot.light ? "#09090b" : "#ffffff", muted = snapshot.light ? "#52525b" : "#a1a1aa";
  c.fillStyle = snapshot.light ? "#ffffff" : "#0f0f0f"; c.fillRect(0, 0, canvas.width, canvas.height);
  c.textBaseline = "top";
  // Break at grapheme boundaries, including CJK/emoji and unspaced titles. Canvas handles bidi shaping per line.
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const draw = (text: string, x: number, y: number, width: number, maxLines: number, font: string, color: string, lineH: number) => {
    c.save(); c.beginPath(); c.rect(x, y, width, maxLines * lineH); c.clip();
    c.font = font; c.fillStyle = color;
    const chars = [...segmenter.segment(text.replace(/[\r\n\t]/g, " "))].map(s => s.segment);
    let line = "", lines: string[] = [];
    for (const char of chars) {
      if (line && c.measureText(line + char).width > width) {
        const space = line.lastIndexOf(" ");
        if (space > 0) { lines.push(line.slice(0, space)); line = (line.slice(space + 1) + char).trimStart(); }
        else { lines.push(line); line = char.trimStart(); }
      } else line += char;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); let last = lines[maxLines - 1]; while (last && c.measureText(last + "…").width > width) last = [...segmenter.segment(last)].slice(0, -1).map(s => s.segment).join(""); lines[maxLines - 1] = last + "…"; }
    for (let i = 0; i < lines.length; i++) {
      const rtl = /^[^\p{L}]*[\p{Script=Hebrew}\p{Script=Arabic}]/u.test(text);
      c.direction = rtl ? "rtl" : "ltr"; c.textAlign = rtl ? "right" : "left";
      c.fillText(lines[i], rtl ? x + width : x, y + i * lineH);
    }
    c.direction = "ltr"; c.textAlign = "left"; c.restore();
  };
  draw("TubeStudio · Макет ленты", margin, 24, canvas.width - 48, 2, "600 22px Arial", fg, 26);
  draw("Локальное сравнение · не выдача YouTube, не A/B-тест и не прогноз CTR", margin, 64, canvas.width - 48, 3, "14px Arial", muted, 18);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], x = margin + (i % cols) * (cardW + gap), y = header + Math.floor(i / cols) * cardH;
    c.fillStyle = snapshot.light ? "#f4f4f5" : "#18181b"; c.fillRect(x, y, cardW, 203);
    if (e.picture) {
      const image = new Image(); image.src = e.picture.src;
      try { await image.decode(); } catch { throw Error("Не удалось подготовить PNG. Макет не изменён."); }
      const scale = Math.min(cardW / image.naturalWidth, 203 / image.naturalHeight), w = image.naturalWidth * scale, h = image.naturalHeight * scale;
      c.drawImage(image, x + (cardW - w) / 2, y + (203 - h) / 2, w, h);
    } else draw(e.id === "own" ? "Загрузите свою обложку" : "Загрузите обложку конкурента", x + 16, y + 86, cardW - 32, 2, "14px Arial", muted, 18);
    draw(e.title || (e.id === "own" ? "Заголовок своего видео" : "Заголовок конкурента"), x, y + 215, cardW, 2, "600 16px Arial", fg, 22);
    draw(e.channel || "Название канала не указано", x, y + 263, cardW, 2, "14px Arial", muted, 20);
    if (snapshot.mark && e.id === "own") draw("Своя карточка", x, y + 311, cardW, 1, "600 14px Arial", snapshot.light ? "#1d4ed8" : "#93c5fd", 20);
  }
  draw("Изображения целиком в рамке 16:9 · без оценки победителя", margin, canvas.height - 48, canvas.width - 48, 2, "14px Arial", muted, 18);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(Error("Не удалось создать PNG.")), "image/png"));
}
export function downloadFeedFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a);
  try { a.click(); } finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
