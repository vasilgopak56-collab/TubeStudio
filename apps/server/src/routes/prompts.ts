import { Hono } from "hono";
import { ok, fail } from "../lib/errors.js";
import { listPrompts, listVersions, readPromptFile, readVersion, restoreVersion, writePromptFile } from "../services/promptStudio.js";

export const promptsRoute = new Hono();
promptsRoute.get("/prompts", async (c) => { try { return ok(c, await listPrompts()); } catch (e) { return fail(c, e); } });
promptsRoute.get("/prompts/file", async (c) => { try { return ok(c, await readPromptFile(c.req.query("path") ?? "")); } catch (e) { return fail(c, e); } });
promptsRoute.put("/prompts/file", async (c) => { try { const b = await c.req.json(); return ok(c, await writePromptFile(b.path, b.content, !!b.force)); } catch (e) { return fail(c, e); } });
promptsRoute.get("/prompts/versions", async (c) => { try { return ok(c, await listVersions(c.req.query("path") ?? "")); } catch (e) { return fail(c, e); } });
promptsRoute.get("/prompts/version", async (c) => { try { return ok(c, { content: await readVersion(c.req.query("path") ?? "", c.req.query("id") ?? "") }); } catch (e) { return fail(c, e); } });
promptsRoute.post("/prompts/restore", async (c) => { try { const b = await c.req.json(); return ok(c, await restoreVersion(b.path, b.id)); } catch (e) { return fail(c, e); } });
