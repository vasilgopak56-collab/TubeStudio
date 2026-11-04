// Генерирует «TubeStudio — Документация.docx»: npx tsx scripts/build-docs.ts [out.docx]
import fs from "node:fs";
import {
  AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, PageBreak, Paragraph, ShadingType,
  Table, TableCell, TableOfContents, TableRow, TextRun, WidthType, Footer, PageNumber, ExternalHyperlink,
} from "docx";
import { NAV } from "../apps/web/src/lib/nav.tsx";
const navLabel = (r: string) => { for (const g of NAV) { const it = g.items.find((x) => x.to === r); if (it) return `${g.title} → ${it.label}`; } };
import { HELP, type HelpSection } from "../apps/web/src/lib/help.ts";

const ORANGE = "E8711A", GRAY = "666666", FONT = "Arial";

/** **жирный** и `код` → TextRun[] */
function runs(text: string, base: { bold?: boolean; color?: string; size?: number; italics?: boolean } = {}) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((p) =>
    p.startsWith("**") ? new TextRun({ ...base, text: p.slice(2, -2), bold: true })
    : p.startsWith("`") ? new TextRun({ ...base, text: p.slice(1, -1), font: "Consolas", shading: { type: ShadingType.CLEAR, fill: "F2F2F2", color: "auto" } })
    : new TextRun({ ...base, text: p }));
}
const P = (text: string, o: { after?: number; color?: string; italics?: boolean; size?: number } = {}) =>
  new Paragraph({ children: runs(text, { color: o.color, italics: o.italics, size: o.size }), spacing: { after: o.after ?? 120, line: 300 } });
const H1 = (t: string, pageBreak = true) => new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: pageBreak, children: [new TextRun(t)] });
const H2 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = (t: string) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const bullet = (t: string) => new Paragraph({ numbering: { reference: "bul", level: 0 }, children: runs(t), spacing: { after: 60, line: 290 } });
let olN = 0;
const olist = (items: string[]) => { const ref = `ol${++olN}`; numberingRefs.push(ref); return items.map((t) => new Paragraph({ numbering: { reference: ref, level: 0 }, children: runs(t), spacing: { after: 80, line: 290 } })); };
const numberingRefs: string[] = [];
const code = (lines: string[]) => lines.map((l, i) => new Paragraph({
  children: [new TextRun({ text: l || " ", font: "Consolas", size: 20 })],
  keepNext: i < lines.length - 1, keepLines: true,
  shading: { type: ShadingType.CLEAR, fill: "F3F3F3", color: "auto" },
  spacing: { before: i === 0 ? 80 : 0, after: i === lines.length - 1 ? 160 : 0 },
  indent: { left: 200, right: 200 },
}));
const callout = (title: string, text: string, fill = "FFF4EA") => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 24, color: ORANGE }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
  rows: [new TableRow({ children: [new TableCell({ shading: { type: ShadingType.CLEAR, fill, color: "auto" }, margins: { top: 100, bottom: 100, left: 160, right: 160 },
    children: [new Paragraph({ children: [new TextRun({ text: title + " ", bold: true }), ...runs(text)], spacing: { line: 290 } })] })] })],
});
const gap = () => new Paragraph({ text: "", spacing: { after: 80 } });
function pairs(rows: [string, string][], head?: [string, string]) {
  const cell = (t: string, bold = false, fill?: string) => new TableCell({
    shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ children: runs(t, { bold }), spacing: { line: 276 } })],
  });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [3000, 6400],
    rows: [
      ...(head ? [new TableRow({ tableHeader: true, children: [cell(head[0], true, "FBE3CF"), cell(head[1], true, "FBE3CF")] })] : []),
      ...rows.map(([a, b]) => new TableRow({ cantSplit: true, children: [cell(a, true, "FAFAFA"), cell(b)] })),
    ],
  });
}
const link = (text: string, url: string) => new Paragraph({ children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink" })] })], spacing: { after: 100 } });

function section(s: HelpSection): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [H2(s.title)];
  if (s.route) out.push(P(`Где: меню → ${navLabel(s.route) ?? s.title.replace(/ \(.+\)$/, "")} (адрес ${s.route})`, { color: GRAY, italics: true, size: 20 }));
  out.push(P(`**${s.short}**`));
  out.push(H3("Простыми словами"), P(s.what));
  if (s.analogy) out.push(callout("Это как…", s.analogy), gap());
  if (s.when?.length) out.push(H3("Когда пригодится"), ...s.when.map(bullet));
  if (s.steps) out.push(H3("Как пользоваться"), ...olist(s.steps));
  if (s.fields) out.push(H3(s.id === "glossary" ? "Слова" : "Что значат настройки"), pairs(s.fields), gap());
  if (s.results) out.push(H3("Что вы увидите"), pairs(s.results), gap());
  if (s.example) out.push(H3(`Пример`), pairs([["Вы вводите", s.example.input], ["Получаете", s.example.output]]), gap());
  if (s.codeExample) out.push(H3(s.codeExample.title), ...code(s.codeExample.code.split("\n")));
  if (s.tips?.length) out.push(H3("Советы"), ...s.tips.map(bullet));
  if (s.problems) out.push(H3("Если не получается"), pairs(s.problems), gap());
  if (s.details?.length) out.push(H3("Точная методика и ограничения"), ...s.details.map(t => P(t)));
  if (s.cost) out.push(P(`Что тратит: ${s.cost}`, { color: GRAY, italics: true }));
  return out;
}
// ───────────────────────── Сборка ─────────────────────────
const today = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const title = [
  new Paragraph({ text: "", spacing: { before: 2400 } }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "TubeStudio", bold: true, size: 72, color: ORANGE })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: "Личная AI-студия для YouTube", size: 32, color: GRAY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Документация", bold: true, size: 44 })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 1200 }, children: [new TextRun({ text: "59 глав · простые шаги · учебные примеры", size: 26, color: GRAY })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: `Версия ${JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version} · ${today}`, size: 22, color: GRAY })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: "Содержание", bold: true, size: 36, color: ORANGE })] }),
  P("Если оглавление пустое — щёлкните по нему правой кнопкой → «Обновить поле» (в Word) или откройте документ заново.", { color: GRAY, italics: true, size: 20 }),
  new TableOfContents("Содержание", { hyperlink: true, headingStyleRange: "1-2" }),
];

const styles = {
    default: { document: { run: { font: FONT, size: 23 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 36, bold: true, color: ORANGE, font: FONT }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 240, after: 200 } } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 29, bold: true, color: "222222", font: FONT }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 300, after: 120 } } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 24, bold: true, color: ORANGE, font: FONT }, paragraph: { keepNext: true, keepLines: true, spacing: { before: 200, after: 80 } } },
    ],
  };


const body = HELP.flatMap(g => [H1(g.title), ...g.sections.flatMap(section)]);
const final = new Document({
  creator: "TubeStudio", title: "TubeStudio — Документация", features: { updateFields: true },
  styles,
  numbering: {
    config: [
      { reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 260 } } } }] },
      ...numberingRefs.map((reference) => ({ reference, levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 500, hanging: 300 } } } }] })),
    ],
  },
  sections: [{
    properties: { page: { margin: { top: 1100, bottom: 1100, left: 1200, right: 1100 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "TubeStudio · Документация · стр. ", color: GRAY, size: 18 }), new TextRun({ children: [PageNumber.CURRENT], color: GRAY, size: 18 })] })] }) },
    children: [...title, ...body],
  }],
});
const out = process.argv[2] || "TubeStudio — Документация.docx";
fs.writeFileSync(out, await Packer.toBuffer(final));
console.log("saved", out);
