// Сверка операций без цены и ответы AnyModel без данных о расходе. Сеть подменена, настоящих ключей и трат нет.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ts-usage-reconcile-"));
process.env.DATA_DIR = dir;
process.env.ENV_FILE = path.join(dir, "absent.env");
process.env.ANYMODEL_API_KEY = "fake-reconcile-only";

const { capturePrice } = await import("../src/services/usagePricing.js");
const { updateSettings } = await import("../src/services/settings.js");
const { recordOperation, getUsage, unpricedOperations, reconcileOperation, retryUsageAccounting } = await import("../src/services/usage.js");
const { amCatalog, resetAmCatalog, amChat } = await import("../src/services/anymodel.js");
const { generateText } = await import("../src/services/llm.js");

const original = fetch;
const billing = { unit: "token", base_tokens: 10, coefficient: { input: 2, output: 3 } };
let calls: string[] = [];
let reply: () => Response = () => Response.json({ choices: [{ message: { content: "answer text" } }] });
const budget = (e: any) => e.code === "BUDGET_LIMIT";
const price = () => capturePrice("openai", "same", "text");

beforeEach(async () => {
  resetAmCatalog();
  await fs.rm(path.join(dir, "usage.json"), { force: true });
  calls = [];
  reply = () => Response.json({ choices: [{ message: { content: "answer text" } }] });
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return String(url).endsWith("/models") ? Response.json({ data: [{ id: "same", billing }] }) : reply();
  }) as typeof fetch;
  await updateSettings({
    budget: { monthlyUsd: 100, mode: "block", warnPct: 80, prices: [{ match: "same", input: 1, output: 2, image: 0.1 }] },
    anymodel: { enabled: true, priority: "first", text: "same", textAlt: "alt", fast: "same", image: "same", imageAlt: "alt", usdPerMillion: 0.05 },
  });
});
after(async () => {
  globalThis.fetch = original;
  const { flushLogs } = await import("../src/lib/logging.js");
  await flushLogs();
  await fs.rm(dir, { force: true, recursive: true });
});

async function unknownInJob(job = "job-1") {
  await recordOperation(await price(), { input: 100, output: 200, known: true }, job);
  await recordOperation(await price(), { input: 1000, output: 3000, known: true }, job);
  await recordOperation(await price(), { input: 0, output: 0, known: false }, job);
}

test("операция без цены не блокирует вызовы, а оценка берётся по самой крупной похожей", async () => {
  await unknownInJob();
  await amCatalog();
  await amChat({ model: "same", system: "", user: "" });
  assert.ok(calls.some((c) => c.endsWith("/chat/completions")));
  const [op] = await unpricedOperations();
  assert.equal(op.estimateUsd, (1000 * 1 + 3000 * 2) / 1e6);
  assert.equal((await getUsage()).cost.complete, false);
});

test("сверка записывает только подтверждённую сумму", async () => {
  await unknownInJob();
  const [op] = await unpricedOperations();
  await assert.rejects(reconcileOperation(op.id, 123), (e: any) => e.status === 409);
  assert.equal((await getUsage()).cost.complete, false);
  assert.deepEqual(await reconcileOperation(op.id, op.estimateUsd as number), { id: op.id, usd: op.estimateUsd });
  const u = await getUsage();
  assert.equal(u.cost.complete, true);
  assert.equal(u.cost.unknownRows, 0);
  assert.ok(u.cost.rows.some((r: any) => r.operationId === op.id && r.estimated === true && r.usd === op.estimateUsd));
  assert.deepEqual(await unpricedOperations(), []);
});

test("повторная сверка той же операции запрещена", async () => {
  await unknownInJob();
  const [op] = await unpricedOperations();
  await reconcileOperation(op.id, op.estimateUsd as number);
  await assert.rejects(reconcileOperation(op.id, op.estimateUsd as number), /нет оценки/);
});

test("без похожих операций оценки нет, запись остаётся неизвестной", async () => {
  await recordOperation(await price(), { input: 0, output: 0, known: false }, "lonely");
  await recordOperation(await price(), { input: 10, output: 10, known: true }, "other-job");
  const [op] = await unpricedOperations();
  assert.equal(op.estimateUsd, null);
  await assert.rejects(reconcileOperation(op.id, 0), /нет оценки/);
  assert.equal((await getUsage()).cost.complete, false);
});

test("несуществующая операция не меняет журнал", async () => {
  await unknownInJob();
  const before = await fs.readFile(path.join(dir, "usage.json"), "utf8");
  await assert.rejects(reconcileOperation("00000000-0000-4000-8000-000000000000", 1), (e: any) => e.status === 404);
  assert.equal(await fs.readFile(path.join(dir, "usage.json"), "utf8"), before);
});

test("ответ без usage оценивается по длине текста и не блокирует следующие вызовы", async () => {
  await amCatalog();
  await amChat({ model: "same", system: "ab", user: "cd" });
  const u = await getUsage();
  assert.equal(u.cost.complete, true);
  const row: any = u.cost.rows.find((r: any) => r.model === "same");
  assert.equal(row.estimated, true);
  assert.equal(row.in, 2);
  assert.equal(row.out, 6);
  assert.equal(row.usd, (2 * 2 + 6 * 3) * 0.05 / 1e6);
  await amChat({ model: "same", system: "ab", user: "cd" });
});

test("ответ с usage остаётся точным, без отметки оценки", async () => {
  reply = () => Response.json({ choices: [{ message: { content: "answer text" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  await amCatalog();
  await amChat({ model: "same", system: "ab", user: "cd" });
  const row: any = (await getUsage()).cost.rows.find((r: any) => r.model === "same");
  assert.equal(row.in, 10);
  assert.equal(row.out, 5);
  assert.equal(row.estimated, undefined);
});

test("запрос с картинкой без usage не оценивается, но следующие вызовы проходят", async () => {
  await amCatalog();
  await amChat({ model: "same", system: "ab", user: "cd", images: [{ mime: "image/png", b64: "AAAA" }] });
  assert.equal((await getUsage()).cost.complete, false);
  await amChat({ model: "same", system: "ab", user: "cd" });
});

test("ответ с текстом и нулевым usage считается оценкой, а не бесплатным", async () => {
  reply = () => Response.json({ choices: [{ message: { content: "answer text" } }], usage: { prompt_tokens: 0, completion_tokens: 0 } });
  await amCatalog();
  await amChat({ model: "same", system: "ab", user: "cd" });
  const row: any = (await getUsage()).cost.rows.find((r: any) => r.model === "same");
  assert.equal(row.estimated, true);
  assert.ok(row.usd > 0);
});

test("незавершённая запись журнала по-прежнему останавливает вызовы", async () => {
  await amCatalog();
  await fs.rm(path.join(dir, "usage.json"), { force: true });
  await fs.mkdir(path.join(dir, "usage.json"));
  try {
    await recordOperation(await price(), { input: 1, output: 1, known: true }, "job-x");
    calls = [];
    await assert.rejects(amChat({ model: "same", system: "", user: "" }), budget);
    assert.equal(calls.length, 0);
  } finally {
    await fs.rm(path.join(dir, "usage.json"), { recursive: true, force: true });
    await retryUsageAccounting();
  }
});

test("без резервной модели пустой ответ не уходит другой модели", async () => {
  reply = () => Response.json({ choices: [{ message: { content: "" } }] });
  await amCatalog();
  calls = [];
  await assert.rejects(generateText({ system: "", user: "x", model: "same", noFallback: true, singleAttempt: true }), /пустой ответ/);
  assert.equal(calls.filter((c) => c.endsWith("/chat/completions")).length, 1);
});

test("пустой ответ без usage не оценивается", async () => {
  reply = () => Response.json({ choices: [{ message: { content: "" } }] });
  await amCatalog();
  await assert.rejects(amChat({ model: "same", system: "ab", user: "cd", singleAttempt: true }), /пустой ответ/);
  assert.equal((await getUsage()).cost.complete, false);
});
