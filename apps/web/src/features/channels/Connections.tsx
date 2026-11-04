import {useEffect,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {api} from "@/lib/api";
import {Button,Card,ErrorAlert,SectionTitle} from "@/components/ui";
type Item={id:string;title:string;savedAt:string;verifiedAt:string;active:boolean;clientMatches:boolean;scopeKnown:boolean;monetaryGranted:boolean};
type List={items:Item[];totalFiles:number;limit:number;warnings:string[]};
const when=(s:string)=>new Date(s).toLocaleString("ru-RU");
export default function Connections({connected,configured,disabled,onBusy}:{connected:boolean;configured:boolean;disabled:boolean;onBusy:(v:boolean)=>void}){
 const qc=useQueryClient(),[message,setMessage]=useState("");
 const list=useQuery({queryKey:["oauth-connections"],queryFn:()=>api<List>("/yt-oauth/connections"),retry:false,refetchOnWindowFocus:false});
 const refreshed=()=>{void qc.invalidateQueries({queryKey:["oauth-connections"]});void qc.invalidateQueries({queryKey:["yt-oauth"]});};
 const save=useMutation({mutationFn:()=>api<{channel:{id:string;title:string}}>("/yt-oauth/connections/save",{method:"POST",json:{consent:true}}),onSuccess:r=>{setMessage(`Подключение сохранено: ${r.channel.title} · ${r.channel.id}. Токены не показаны; ZIP данных не включает эту копию.`);refreshed();}});
 const activate=useMutation({mutationFn:(id:string)=>api("/yt-oauth/connections/"+id+"/activate",{method:"POST",json:{consent:true}}),onSuccess:()=>{window.location.assign("/my-analytics?tab=channels");}});
 const forget=useMutation({mutationFn:(id:string)=>api("/yt-oauth/connections/"+id+"/forget",{method:"POST",json:{consent:true}}),onSuccess:()=>{setMessage("Сохранённая копия забыта локально. Активное подключение и снимки не изменены; Google не вызывался и доступ не отзывался.");refreshed();}});
 const pending=save.isPending||activate.isPending||forget.isPending,busy=pending||disabled;
 useEffect(()=>{onBusy(pending);return()=>onBusy(false);},[pending,onBusy]);
 const reset=()=>{setMessage("");save.reset();activate.reset();forget.reset();};
 return <Card className="min-w-0 space-y-4 p-5" data-testid="oauth-connections"><SectionTitle>Сохранённые подключения Google</SectionTitle>
  <p className="text-sm text-muted-foreground">Сохраните подключение каждого своего канала по кнопке — затем можно переключаться без нового входа, пока Google разрешает доступ. Активен только один канал. При сохранении и переключении выполняются обновление токена и проверка ID канала, не запрос статистики и не AI. Новые OAuth-права не запрашиваются.</p>
  <p className="text-xs text-accent">Это локальные копии секретных OAuth-токенов, не просто список названий. Файлы oauth-connections не зашифрованы: защита зависит от прав вашей ОС. Нет передачи токенов браузеру, MCP или расширению. Общий ZIP данных не включает этот каталог, но по-прежнему может содержать активный oauth.json. Не публикуйте резервные копии.</p>
  <Button variant="outline" disabled={!configured||!connected||busy} onClick={()=>{if(confirm("Сохранить или обновить секретное подключение активного канала на этом компьютере? Будут вызваны Google для обновления токена и проверки канала. Копия не зашифрована, в общий ZIP данных не входит. Одна запись на ID канала; прежняя сохранённая копия этого ID заменится.")){reset();save.mutate();}}}>{save.isPending?"Проверяю и сохраняю…":"Запомнить текущее подключение"}</Button>
  {list.isError&&<ErrorAlert error={list.error} onRetry={()=>void list.refetch()}/>}
  {[save,activate,forget].map((m,i)=>m.isError&&<ErrorAlert key={i} error={m.error}/>)}
  {message&&<p role="status" className="break-words text-sm">{message}</p>}
  {list.isPending&&<p className="text-sm">Читаю локальные подключения…</p>}
  {list.data?.warnings.map((w,i)=><p role="status" key={i} className="text-xs text-accent">{w}</p>)}
  {list.data&&<p className="text-xs text-muted-foreground">Доступных записей: {list.data.items.length}, файлов: {list.data.totalFiles}; предел: {list.data.limit}. Список не проверяет Google автоматически.</p>}
  {list.data?.items.length===0&&<p className="text-sm">Сохранённых подключений пока нет. Войдите в Google и явно запомните текущий канал. При новом входе автоматического сохранения нет.</p>}
  <div className="space-y-3">{list.data?.items.map(r=><div key={r.id} className="min-w-0 space-y-2 rounded border p-3" data-testid="oauth-connection"><b className="block break-words text-sm">{r.title}</b><p className="break-all text-xs">{r.id}{r.active?" · активный канал":""}</p><p className="text-xs text-muted-foreground">Сохранено: {when(r.savedAt)}. Последняя проверка: {when(r.verifiedAt)}; не гарантия действующего доступа сейчас.</p><p className="text-xs text-muted-foreground">{!r.clientMatches?"Другой OAuth Client ID — верните прежний клиент или заново подключите канал.":!r.scopeKnown?"Разрешения неизвестны; финансовый доступ не считается подтверждённым.":r.monetaryGranted?"В сохранённом подключении есть финансовое разрешение; статус уточняется при обновлении токена.":"Финансовое разрешение в сохранённом подключении не выдано."}</p>
   <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={!configured||!r.clientMatches||busy} aria-label={`Активировать ${r.id}`} onClick={()=>{if(confirm(`Проверить Google и активировать канал «${r.title}» (${r.id})? Текущее подключение не сохраняется автоматически. Если оно ещё нужно — сначала запомните его. Завершите фоновые задания; несохранённые поля страницы сбросятся после переключения. При ошибке проверки активное подключение останется прежним.`)){reset();activate.mutate(r.id);}}}>Проверить и активировать</Button><Button size="sm" variant="ghost" disabled={busy} aria-label={`Забыть ${r.id}`} onClick={()=>{if(confirm(`Забыть только сохранённую копию подключения «${r.title}» (${r.id})? Активный oauth.json, снимки и разрешения Google не меняются. Для отзыва доступа используйте отключение Google отдельно.`)){reset();forget.mutate(r.id);}}}>Забыть сохранённое</Button></div>
  </div>)}</div>
  <p className="text-xs text-muted-foreground">Переключение заменяет только активный oauth.json после успешной проверки. Прежний активный канал не запоминается автоматически. Снимки/периоды панели не удаляются. Если токен истёк или отозван, войдите в Google и снова запомните канал. Изменение OAuth Client ID требует соответствующего клиента для старых записей. Отключение/отзыв Google может сделать недействительными и другие сохранённые токены того же приложения; записи сами не удаляются.</p>
  <Button size="sm" variant="ghost" disabled={busy||list.isFetching} onClick={()=>void list.refetch()}>Обновить локальный список подключений</Button>
 </Card>;
}
