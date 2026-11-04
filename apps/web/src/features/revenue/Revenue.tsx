import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle } from "@/components/ui";
type Brief={id:string;title:string;createdAt:string;channel:{id:string;title:string};requested:{startDate:string;endDate:string};rowCount:number};
type Run=Omit<Brief,"rowCount">&{version:1;currency:"USD";source:string;rows:{day:string;views:number|null;estimatedRevenue:number|null;estimatedAdRevenue:number|null}[];status:"empty"|"returned";mayBeLimited:boolean;totals:{returnedViews:number|null;returnedRevenue:number|null;returnedAdRevenue:number|null};warnings:string[]};
const num=(v:number|null)=>v===null?"неизвестно":v.toLocaleString("ru-RU",{maximumFractionDigits:2});
const money=(v:number|null)=>v===null?"неизвестно":num(v)+" USD";
const esc=(s:string)=>s.replace(/[\\`*_{}\[\]#|!]/g,"\\$&").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/[\r\n]/g," ");
export function revenueMarkdown(r:Run){return `# ${esc(r.title)}\n\nКанал: ${esc(r.channel.title)} (${r.channel.id})\nСнимок: ${r.createdAt}\nЗапрошено: ${r.requested.startDate} — ${r.requested.endDate}\nИсточник: YouTube Analytics API; day; views, estimatedRevenue, estimatedAdRevenue; USD\nВозвращены даты: ${r.rows[0]?.day??"нет"} — ${r.rows.at(-1)?.day??"нет"}\nСуммы только возвращённых строк: просмотры ${num(r.totals.returnedViews)}; оценочный доход ${money(r.totals.returnedRevenue)}; из него реклама ${money(r.totals.returnedAdRevenue)}\n\n| День | Просмотры | Оценочный доход USD | Из него реклама USD |\n| --- | ---: | ---: | ---: |\n`+r.rows.map(x=>`| ${x.day} | ${num(x.views)} | ${num(x.estimatedRevenue)} | ${num(x.estimatedAdRevenue)} |`).join("\n")+"\n\n"+r.warnings.map(w=>"- "+esc(w)).join("\n")+"\n";}
function download(name:string,text:string,mime:string){const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export default function Revenue({configured,connected,monetaryGranted,scopeKnown}:{configured:boolean;connected:boolean;monetaryGranted:boolean;scopeKnown:boolean}){
 const qc=useQueryClient(),yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10);
 const [consent,setConsent]=useState(false),[title,setTitle]=useState(""),[startDate,setStart]=useState(()=>new Date(Date.now()-28*86400000).toISOString().slice(0,10)),[endDate,setEnd]=useState(yesterday),[current,setCurrent]=useState<Run|null>(null);
 const history=useQuery({queryKey:["revenue-runs"],queryFn:()=>api<{items:Brief[];warnings:string[]}>("/my-analytics/revenue/runs"),retry:false,refetchOnWindowFocus:false});
 const connect=useMutation({mutationFn:()=>api<{url:string}>("/yt-oauth/start-monetary",{method:"POST",json:{consent:true}}),onSuccess:r=>{window.location.href=r.url;}});
 const save=useMutation({mutationFn:()=>api<Run>("/my-analytics/revenue/runs",{method:"POST",json:{title,startDate,endDate}}),onSuccess:r=>{setCurrent(r);void qc.invalidateQueries({queryKey:["revenue-runs"]});void qc.invalidateQueries({queryKey:["yt-oauth"]});},onError:()=>{void qc.invalidateQueries({queryKey:["yt-oauth"]});}});
 const open=useMutation({mutationFn:(id:string)=>api<Run>(`/my-analytics/revenue/runs/${id}`),onSuccess:r=>{setCurrent(r);save.reset();}}),busy=save.isPending||open.isPending||connect.isPending;
 return <div className="min-w-0 space-y-5" data-testid="revenue">
  <Card className="space-y-4 p-5"><SectionTitle>Финансовый доступ — отдельно</SectionTitle>
   <p className="text-sm text-muted-foreground">Доход своего канала доступен участникам партнёрской программы YouTube с дополнительным разрешением Google только на чтение. Обычная аналитика не требует этого доступа. Денежный отчёт запрашивается только вашей кнопкой, без AI и платных моделей; доступ сам по себе не гарантирует наличие данных.</p>
   <p className="text-sm" role="status">{monetaryGranted?"Финансовое разрешение подтверждено сохранённым токеном.":connected&&!scopeKnown?"Разрешения старого подключения неизвестны. Для дохода подключитесь заново с финансовым доступом.":"Финансовое разрешение не подтверждено. Сохранённые отчёты доступны без него."}</p>
   {!configured&&<p className="text-sm">Сначала сохраните OAuth-клиент на вкладке «Обзор».</p>}
   <label className="flex items-start gap-3 text-sm"><input type="checkbox" aria-label="Разрешить чтение приватного дохода" checked={consent} disabled={busy} onChange={e=>setConsent(e.target.checked)}/>Разрешить чтение приватного дохода моего канала. Далее потребуется подтверждение в Google; можно выбрать другой канал.</label>
   <Button disabled={!configured||!consent||busy} onClick={()=>connect.mutate()}>Подключить финансовый доступ Google</Button>
   {connect.isError&&<ErrorAlert error={connect.error}/>}
   <p className="text-xs text-muted-foreground">После входа откройте вкладку «Доход» снова. Снятие флажка не отзывает уже выданное разрешение. Повторный обычный вход также может сохранить прежние разрешения Google. Отключение TubeStudio и отзыв доступа приложения в аккаунте Google затрагивают всё подключение, не только доход; сохранённые финансовые снимки при этом не удаляются.</p>
  </Card>
  <Card className="space-y-4 p-5"><SectionTitle>Оценочный доход своего канала</SectionTitle>
   <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(connected&&monetaryGranted&&!busy)save.mutate();}}>
    <label className="block"><Label>Название отчёта</Label><Input aria-label="Название отчёта дохода" value={title} maxLength={120} disabled={busy} onChange={e=>setTitle(e.target.value)}/></label>
    <div className="grid min-w-0 gap-4 sm:grid-cols-2"><label className="min-w-0"><Label>Начало периода</Label><Input className="min-w-0 max-w-full" aria-label="Доход: начало периода" type="date" value={startDate} min="2005-01-01" max={endDate} required disabled={busy} onChange={e=>setStart(e.target.value)}/></label><label className="min-w-0"><Label>Конец периода</Label><Input className="min-w-0 max-w-full" aria-label="Доход: конец периода" type="date" value={endDate} min={startDate} max={yesterday} required disabled={busy} onChange={e=>setEnd(e.target.value)}/></label></div>
    <p className="text-xs text-muted-foreground">До 366 дней включительно, не позднее вчерашнего дня UTC. Валюта USD. Пропущенные дни не равны нулю; последние данные могут отставать. При отказе API проверьте разрешения Google и участие канала в партнёрской программе; сам отказ не устанавливает причину.</p>
    <Button type="submit" disabled={!connected||!monetaryGranted||busy}>{save.isPending?"Запрашиваю и сохраняю…":"Запросить доход и сохранить"}</Button>
    {save.isError&&<ErrorAlert error={save.error}/>}
   </form>
  </Card>
  {open.isError&&<ErrorAlert error={open.error}/>}
  {current&&<Card className="min-w-0 space-y-4 p-5" data-testid="revenue-result"><SectionTitle>{current.title}</SectionTitle>
   <p className="break-words text-sm"><b>{current.channel.title}</b> · <span className="break-all">{current.channel.id}</span></p>
   <p className="text-xs text-muted-foreground">Сохранённый снимок {new Date(current.createdAt).toLocaleString("ru-RU")}. Запрошено: {current.requested.startDate} — {current.requested.endDate}. Изменение формы и подключения не меняет снимок или его экспорт.</p>
   <p className="text-sm">Возвращены даты: {current.rows[0]?.day??"нет"} — {current.rows.at(-1)?.day??"нет"}. Это не подтверждение полного покрытия.</p>
   <div className="grid gap-3 sm:grid-cols-3"><div className="rounded border p-3 text-sm">Оценочный доход возвращённых строк<b className="mt-2 block" data-testid="revenue-total">{money(current.totals.returnedRevenue)}</b></div><div className="rounded border p-3 text-sm">Из него от рекламы<b className="mt-2 block">{money(current.totals.returnedAdRevenue)}</b></div><div className="rounded border p-3 text-sm">Просмотры возвращённых строк<b className="mt-2 block">{num(current.totals.returnedViews)}</b></div></div>
   {current.status==="empty"?<p role="status">YouTube не вернул строки. Это не означает нулевой доход.</p>:<div className="overflow-x-auto"><table className="w-full text-left text-sm" data-testid="revenue-table"><thead><tr><th className="p-2">День</th><th className="p-2">Просмотры</th><th className="p-2">Доход USD</th><th className="p-2">Из него реклама USD</th></tr></thead><tbody>{current.rows.map(x=><tr key={x.day} className="border-t"><td className="whitespace-nowrap p-2">{x.day}</td><td className="p-2">{num(x.views)}</td><td className="p-2">{num(x.estimatedRevenue)}</td><td className="p-2">{num(x.estimatedAdRevenue)}</td></tr>)}</tbody></table></div>}
   <ul className="list-disc space-y-2 pl-5 text-xs text-muted-foreground">{current.warnings.map((w,i)=><li className="break-words" key={i}>{w}</li>)}</ul>
   <p className="text-xs text-muted-foreground">Источник: YouTube Analytics API · day · views, estimatedRevenue, estimatedAdRevenue · USD. Не окончательная выплата и не прибыль. Доход от рекламы уже входит в общий, их нельзя складывать.</p>
   <div className="flex flex-wrap gap-3"><CopyButton text={revenueMarkdown(current)} label="Копировать доход"/><Button variant="outline" onClick={()=>download(`revenue-${current.id}.md`,revenueMarkdown(current),"text/markdown;charset=utf-8")}>Доход Markdown</Button><Button variant="outline" onClick={()=>download(`revenue-${current.id}.json`,JSON.stringify(current,null,2),"application/json;charset=utf-8")}>Доход JSON</Button></div>
  </Card>}
  <Card className="p-5"><SectionTitle>История дохода</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50 снимков всех подключавшихся каналов. Открытие и экспорт не вызывают Google или AI. Старые файлы не удаляются. Финансовые снимки входят в общий ZIP данных, но не предоставлены MCP или расширению Chrome. Храните приватно.</p>
   {history.isPending&&<p>Читаю историю…</p>}{history.isError&&<ErrorAlert error={history.error} onRetry={()=>void history.refetch()}/>}
   {history.data?.warnings.map((w,i)=><p key={i} role="status" className="mb-2 text-xs text-accent">{w}</p>)}
   {history.data?.items.length===0&&<p className="text-sm text-muted-foreground">Отчётов пока нет.</p>}
   <div className="space-y-2">{history.data?.items.map(r=><button type="button" key={r.id} disabled={busy} onClick={()=>open.mutate(r.id)} className="block w-full break-words rounded border p-3 text-left text-sm hover:border-primary"><b>{r.title}</b><p className="mt-1 text-xs text-muted-foreground">{r.channel.title} · {new Date(r.createdAt).toLocaleString("ru-RU")} · {r.requested.startDate} — {r.requested.endDate} · строк: {r.rowCount}</p></button>)}</div>
  </Card>
 </div>;
}
