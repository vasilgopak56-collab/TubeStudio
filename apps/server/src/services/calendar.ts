import crypto from "node:crypto";
import { z } from "zod";
import { ApiError } from "../lib/errors.js";
import { readJson, writeJson } from "../lib/storage.js";
import { listReports, loadReport } from "./analysis.js";
import { getSettings } from "./settings.js";
import { getProject } from "./projects.js";
import { checkCancelled } from "../lib/taskContext.js";

export const CAL_STATUS = ["plan", "script", "ready", "published"] as const;
export const CalInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  title: z.string().trim().min(1).max(300),
  status: z.enum(CAL_STATUS).default("plan"),
  format: z.enum(["long", "short"]).default("long"),
  projectId: z.string().max(80).optional().or(z.literal("")),
  notes: z.string().max(4000).optional(),
  remindDays: z.number().int().min(0).max(14).default(1),
});
// Zod 4 applies defaults inside partial(); PATCH must not reset omitted fields.
export const CalPatchInput = CalInput.partial().extend({
  status: CalInput.shape.status.unwrap().optional(),
  format: CalInput.shape.format.unwrap().optional(),
  remindDays: CalInput.shape.remindDays.unwrap().optional(),
});
export type CalItem = z.infer<typeof CalInput> & { id: string; createdAt: string; updatedAt: string };
const FILE = "calendar.json";

export const listCalendar = async () => (await readJson<CalItem[]>(FILE, [])).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? "")));
let calendarTail:Promise<unknown>=Promise.resolve();
function calendarMutation<T>(f:()=>Promise<T>):Promise<T>{const work=calendarTail.catch(()=>{}).then(f);calendarTail=work;return work;}
export function addCalendar(input: unknown) { return calendarMutation(async()=>{
  const d = CalInput.parse(input); const all = await listCalendar(); const now = new Date().toISOString();
  const it: CalItem = { ...d, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  all.push(it); await writeJson(FILE, all); return it;
});}
export function patchCalendar(id: string, patch: unknown) { return calendarMutation(async()=>{
  const all = await listCalendar(); const i = all.findIndex((x) => x.id === id);
  if (i < 0) throw new ApiError("NOT_FOUND", "Запись не найдена", 404);
  all[i] = { ...all[i], ...CalPatchInput.parse(patch), updatedAt: new Date().toISOString() };
  await writeJson(FILE, all); return all[i];
});}
export function deleteCalendar(id: string) { return calendarMutation(async()=>{
  const all = await listCalendar(); await writeJson(FILE, all.filter((x) => x.id !== id)); return { id };
});}

/** Лучший день/час по последнему отчёту анализа канала (индексы: 0 = Пн) */
export async function bestTime() {
  for (const row of (await listReports()).slice(0, 5)) {
    const r = await loadReport(row.id);
    if (!r?.schedule) continue;
    const s = r.schedule;
    const topDays = s.byDay.map((d, i) => ({ i, avg: d.avg, label: d.label })).filter((d) => d.avg > 0).sort((a, b) => b.avg - a.avg).slice(0, 3);
    return { day: s.bestDay, hour: s.bestHour, label: `${s.byDay[s.bestDay].label}, ${String(s.bestHour).padStart(2, "0")}:00`, topDays: topDays.map((d) => d.i), channel: row.title, reportId: row.id, createdAt: row.createdAt };
  }
  return null;
}

// ── iCalendar (.ics): импорт в Google Календарь / телефон — там и напоминания ──
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const fold = (line: string) => { const out: string[] = []; let s = line; while (Buffer.byteLength(s) > 74) { let n = 74; while (Buffer.byteLength(s.slice(0, n)) > 74) n--; out.push(s.slice(0, n)); s = " " + s.slice(n); } out.push(s); return out.join("\r\n"); };
const STATUS_RU: Record<string, string> = { plan: "План", script: "Сценарий", ready: "Готово к публикации", published: "Опубликовано" };

export async function calendarIcs(items?: CalItem[]) {
  const all = items ?? await listCalendar();
  const tz = (await getSettings()).timezone;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//TubeStudio//Calendar//RU", "CALSCALE:GREGORIAN", "X-WR-CALNAME:TubeStudio — публикации", `X-WR-TIMEZONE:${tz}`];
  for (const it of all) {
    const d = it.date.replace(/-/g, "");
    const timed = !!it.time;
    const start = timed ? `DTSTART;TZID=${tz}:${d}T${it.time!.replace(":", "")}00` : `DTSTART;VALUE=DATE:${d}`;
    const endDate = new Date(`${it.date}T00:00:00Z`); endDate.setUTCDate(endDate.getUTCDate() + 1);
    const end = timed ? `DURATION:PT30M` : `DTEND;VALUE=DATE:${endDate.toISOString().slice(0, 10).replace(/-/g, "")}`;
    lines.push("BEGIN:VEVENT", `UID:${it.id}@tubestudio`, `DTSTAMP:${stamp}`, start, end,
      `SUMMARY:${esc(`${it.format === "short" ? "[Shorts] " : "▶ "}${it.title}`)}`,
      `DESCRIPTION:${esc(`Статус: ${STATUS_RU[it.status]}${it.notes ? `\n${it.notes}` : ""}\nTubeStudio`)}`,
      `CATEGORIES:YouTube,${STATUS_RU[it.status]}`);
    if (it.remindDays > 0 && it.status !== "published") lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(`Публикация: ${it.title}`)}`, `TRIGGER:-P${it.remindDays}D`, "END:VALARM");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Separate preview/confirmation for 12 draft calendar entries; no publishing or external calendar.
const actualDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;});
const CalendarPlanItem=z.object({date:actualDay,title:z.string().trim().min(1).max(180),pillar:z.string().trim().min(1).max(100),thumbnailText:z.string().trim().min(1).max(120),hook:z.string().trim().min(1).max(700),whyNow:z.string().trim().min(1).max(700),shortsIdea:z.string().trim().min(1).max(700),slot:z.enum(['pilot','flexible','planned'])}).strict();
export const BrainstormCalendarAsk=z.object({projectId:z.string().uuid(),planId:z.string().uuid(),items:z.array(CalendarPlanItem).length(12)}).strict().refine(d=>new Set(d.items.map(i=>i.date)).size===12,'Нужны 12 разных дат');
export const BrainstormCalendarSend=BrainstormCalendarAsk.extend({previewHash:z.string().regex(/^[a-f0-9]{64}$/),confirmed:z.literal(true)}).strict();
const calendarDigest=(x:unknown)=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function planCalendarId(planId:string,index:number){const h=calendarDigest({planId,index});return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
async function previewPlan(input:z.infer<typeof BrainstormCalendarAsk>){
 const d=BrainstormCalendarAsk.parse(input),[project,existing]=await Promise.all([getProject(d.projectId),listCalendar()]);
 const existingIds=new Set(existing.map(x=>x.id)),ids=d.items.map((_,i)=>planCalendarId(d.planId,i));
 if(ids.some(id=>existingIds.has(id)))throw new ApiError('VALIDATION','Этот план уже добавлялся или совпадает с существующей записью. Ничего не изменено.',409);
 const collisions=existing.filter(x=>d.items.some(i=>i.date===x.date)).map(x=>({id:x.id,date:x.date,title:x.title}));
 const entries=d.items.map((i,index)=>({id:ids[index],...CalInput.parse({date:i.date,title:i.title,status:'plan',format:'long',projectId:d.projectId,notes:`Рубрика: ${i.pillar}\nТип слота: ${i.slot}\nТекст превью: ${i.thumbnailText}\nХук: ${i.hook}\nПочему сейчас (гипотеза): ${i.whyNow}\nИдея Shorts: ${i.shortsIdea}`,remindDays:1})}));
 const hash=calendarDigest({input:d,project:{id:project.id,title:project.title},calendar:existing,entries});
 return {input:d,project:{id:project.id,title:project.title},entries,collisions,hash,calendarSnapshot:calendarDigest(existing),notice:'Будет добавлено 12 записей на целый день без времени публикации. Совпадения по датам показаны отдельно. Публикация и внешний календарь не запускаются; существующие записи не изменяются.'};
}
export function previewBrainstormCalendar(raw:z.infer<typeof BrainstormCalendarAsk>){return previewPlan(BrainstormCalendarAsk.parse(raw));}
export function addBrainstormCalendar(raw:z.infer<typeof BrainstormCalendarSend>){const {previewHash,confirmed,...ask}=BrainstormCalendarSend.parse(raw);return calendarMutation(async()=>{checkCancelled();const p=await previewPlan(ask);if(p.hash!==previewHash)throw new ApiError('VALIDATION','Календарь, проект или план изменились. Повторите просмотр; ничего не добавлено.',409);const existing=await listCalendar();if(calendarDigest(existing)!==p.calendarSnapshot)throw new ApiError('VALIDATION','Календарь изменился. Повторите просмотр; ничего не добавлено.',409);const now=new Date().toISOString(),items=p.entries.map(e=>({...e,createdAt:now,updatedAt:now}));checkCancelled();await writeJson(FILE,[...existing,...items]);return {projectId:p.project.id,ids:items.map(i=>i.id),added:items.length};});}
