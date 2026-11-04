import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getJob, cancelJob, type JobEvent } from "../lib/jobs.js";

export const jobsRoute = new Hono();

jobsRoute.get("/jobs/:id/stream", (c) => {
  const job = getJob(c.req.param("id"));
  if (!job) return c.json({ ok: false, error: { code: "NOT_FOUND", message: "Задача не найдена" } }, 404);
  return streamSSE(c, async (s) => {
    await new Promise<void>((resolve) => {
      let chain: Promise<unknown> = Promise.resolve(), finished = false;
      const finish = () => { if (finished) return; finished = true; clearInterval(ping); job.listeners.delete(l); resolve(); };
      const l = (e: JobEvent) => {
        if (finished) return;
        chain = chain.then(() => s.writeSSE({ event: e.type, data: JSON.stringify(e) })).catch(finish);
        if (e.type === "done" || e.type === "error") void chain.then(finish);
      };
      const ping = setInterval(() => { chain = chain.then(() => s.writeSSE({ event: "ping", data: "{}" })).catch(finish); }, 15_000);
      // Subscribe and enqueue the snapshot without awaiting: no terminal-event gap.
      job.listeners.add(l);
      for (const e of [...job.events]) l(e);
      if (job.done) void chain.then(finish);
      s.onAbort(finish);
    });
  });
});

jobsRoute.post("/jobs/:id/cancel", (c) => c.json({ ok: true, data: { cancelled: cancelJob(c.req.param("id")) } }));
