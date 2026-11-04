import { Hono } from "hono";
import { z } from "zod";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { ok, fail, ApiError } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { runScript, ScriptInput, SCRIPT_STYLES, loadStructures } from "../services/script.js";
import { reviewDonorScript, ReviewScriptInput } from "../services/donorReview.js";
import { bodyLimit } from "hono/body-limit";
import { checkScript } from "../services/scriptCheck.js";

const parse = <T>(schema: z.ZodType<T, unknown>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new ApiError("VALIDATION", r.error.issues.map((i) => i.message).join("; "), 400);
  return r.data;
};
const CheckInput = z.object({ profile: z.enum(["standard", "donor"]).optional(), script: z.string().min(1).max(300000), language: z.string().default("ru"), unit: z.enum(["words", "chars"]).default("words"), target: z.number().int().positive().optional(),
  headings: z.boolean().optional(), visualCues: z.boolean().optional(), cta: z.boolean().optional(), actNames: z.array(z.string()).optional() });

export const scriptRoute = new Hono();
scriptRoute.get("/script/styles", (c) => ok(c, SCRIPT_STYLES()));
scriptRoute.get("/script/structures", async (c) => ok(c, (await loadStructures()).map(({ id, name, body }) => ({ id, name, hint: body.replace(/\*\*/g, "").slice(0, 220) }))));
scriptRoute.post("/script", async (c) => {
  try { const input = parse(ScriptInput, await c.req.json()); return ok(c, { jobId: startJob((ctx) => runScript(input, ctx)) }); } catch (e) { return fail(c, e); }
});
scriptRoute.post("/script/donor-review", bodyLimit({ maxSize: 600000, onError: c => fail(c, new ApiError("VALIDATION", "Запрос слишком большой", 413)) }), async c => {
  try { const input = parse(ReviewScriptInput, await c.req.json()); return ok(c, { jobId: startJob(ctx => reviewDonorScript(input, ctx)) }); } catch (e) { return fail(c, e); }
});
scriptRoute.post("/script/check", async (c) => {
  try { const i = parse(CheckInput, await c.req.json()); return ok(c, checkScript(i.script, i)); } catch (e) { return fail(c, e); }
});
scriptRoute.post("/script/docx", async (c) => {
  try {
    const { title, script } = parse(z.object({ title: z.string().max(300).default("Сценарий"), script: z.string().min(1).max(300000) }), await c.req.json());
    const doc = new Document({ styles: { default: { document: { run: { font: "Arial", size: 24 } } } }, sections: [{ children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(title)] }),
      ...script.split(/\n\s*\n/).map((p) => new Paragraph({ spacing: { after: 200, line: 320 }, children: [new TextRun(p.replace(/\n/g, " ").trim())] })),
    ] }] });
    const buf = await Packer.toBuffer(doc);
    const name = `${title.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "script"}.docx`;
    return new Response(new Uint8Array(buf), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } });
  } catch (e) { return fail(c, e); }
});
