import { Hono } from "hono";
import { ok, fail } from "../lib/errors.js";
import { addCalendar, bestTime, calendarIcs, deleteCalendar, listCalendar, patchCalendar } from "../services/calendar.js";

export const calendarRoute = new Hono();
calendarRoute.get("/calendar", async (c) => { try { return ok(c, await listCalendar()); } catch (e) { return fail(c, e); } });
calendarRoute.get("/calendar/best-time", async (c) => { try { return ok(c, await bestTime()); } catch (e) { return fail(c, e); } });
calendarRoute.get("/calendar.ics", async (c) => {
  try { return c.body(await calendarIcs(), 200, { "content-type": "text/calendar; charset=utf-8", "content-disposition": 'attachment; filename="tubestudio-calendar.ics"' }); } catch (e) { return fail(c, e); }
});
calendarRoute.post("/calendar", async (c) => { try { return ok(c, await addCalendar(await c.req.json())); } catch (e) { return fail(c, e); } });
calendarRoute.patch("/calendar/:id", async (c) => { try { return ok(c, await patchCalendar(c.req.param("id"), await c.req.json())); } catch (e) { return fail(c, e); } });
calendarRoute.delete("/calendar/:id", async (c) => { try { return ok(c, await deleteCalendar(c.req.param("id"))); } catch (e) { return fail(c, e); } });
