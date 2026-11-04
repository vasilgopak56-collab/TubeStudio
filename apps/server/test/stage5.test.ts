// Дайджест, оценка перед публикацией, настройки комментариев
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ts-s5-"));
const { localChecks } = await import("../src/services/scorecard.js");
const { pickHits } = await import("../src/services/digest.js");
const { ResearchSettings } = await import("../src/services/settings.js");

const base = { description: "", tags: [] as string[], keywords: [] as string[], hook: "", format: "long" as const, minutes: undefined as number | undefined };

test("scorecard: длинный заголовок, ключ, приветствие в хуке", () => {
  const r = localChecks({ ...base, title: "x".repeat(105), keywords: ["психология"], hook: "Привет, меня зовут Паша, сегодня поговорим" });
  assert.ok(r.title.some((c) => c.level === "error" && /100/.test(c.text)));
  assert.ok(r.title.some((c) => /нет в заголовке/.test(c.text)));
  assert.ok(r.hook.some((c) => c.level === "error" && /приветств/.test(c.text)));
  assert.ok(r.seo.some((c) => c.level === "error" && /пустое/.test(c.text)));
});

test("scorecard: хорошая упаковка получает высокие локальные баллы", () => {
  const tags = ["психология сна", "сны", "мозг", "память", "наука", "факты о снах"];
  const r = localChecks({ ...base, title: "Психология сна: 7 причин, почему мы забываем сны", keywords: ["психология сна"], tags,
    description: "Психология сна объясняет, почему мы забываем сны уже через пять минут после пробуждения. " + "Разбираем исследования и простые техники запоминания. ".repeat(4) + "\n0:00 Вступление\n1:20 Почему забываем",
    hook: "Через пять минут после пробуждения вы забудете девяносто процентов сна. Психология сна знает, почему это происходит и как это остановить.", minutes: 10 });
  assert.ok(r.scores.title >= 80, `title ${r.scores.title}`);
  assert.ok(r.scores.seo >= 80, `seo ${r.scores.seo}`);
  assert.ok(r.scores.hook >= 75, `hook ${r.scores.hook}`);
});

test("scorecard: > 15 хэштегов и > 500 символов тегов — ошибки", () => {
  const r = localChecks({ ...base, title: "Нормальный заголовок для проверки", description: "a".repeat(300) + " " + Array.from({ length: 16 }, (_, i) => `#t${i}`).join(" "), tags: Array.from({ length: 60 }, (_, i) => `длинный тег номер ${i}`) });
  assert.ok(r.seo.some((c) => c.level === "error" && /хэштег/.test(c.text)));
  assert.ok(r.seo.some((c) => c.level === "error" && /500/.test(c.text)));
});

test("digest: отбор хитов за период по Outlier", () => {
  const now = Date.now(), D = 86400_000;
  const pt = (v: number) => [{ t: now, v, l: 0, c: 0, viewsKnown: true }];
  const mk = (id: string, ageD: number, views: number) => ({ id, title: id, publishedAt: new Date(now - ageD * D).toISOString(), durationSec: 600, durationKnown: true, sourceChannelId: "c1", isShort: false, points: pt(views), alerted: [] });
  const ch = { id: "c1", title: "Канал", uploadsPlaylistId: "UU", addedAt: "", history: [], videos: [mk("old1", 40, 1000), mk("old2", 50, 1000), mk("old3", 60, 1000), mk("hit", 3, 9000), mk("norm", 4, 1100), mk("ancient", 20, 50000)] };
  const { all, hits } = pickHits([ch as any], 7, 2, now);
  assert.deepEqual(all.map((v) => v.id).sort(), ["hit", "norm"]);
  assert.equal(hits[0].id, "hit");
  assert.ok((hits[0].outlier ?? 0) >= 5);
});

test("настройки: дефолты дайджеста и комментариев", () => {
  const s = ResearchSettings.parse({});
  assert.equal(s.competitors.digestAuto, false);
  assert.equal(s.competitors.digestDays, 7);
  assert.equal(s.comments.perVideo, 200);
  assert.equal(s.comments.channelVideos, 3);
});
