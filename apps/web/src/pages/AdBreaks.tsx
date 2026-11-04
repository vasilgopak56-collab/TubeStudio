import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AudioLines, History } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Card, CopyButton, ErrorAlert, Input, Label, SectionTitle, Select, ToolHeader } from "@/components/ui";
import { AdBasis } from "@/features/ad-breaks/AdBasis";
import { adTime, adText, type AdPlan, type AdBrief, type AdSourceBrief } from "@/features/ad-breaks/types";
function download(name:string,text:string,mime:string){const u=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
export default function AdBreaks(){
  const [sp]=useSearchParams(),qc=useQueryClient();
  const [audioId,setAudioId]=useState(sp.get("audioId")??""),[title,setTitle]=useState("");
  const [minPause,setMinPause]=useState("0.5"),[intro,setIntro]=useState("60"),[outro,setOutro]=useState("30"),[minGap,setMinGap]=useState("120"),[targetCount,setTargetCount]=useState("3");
  const [current,setCurrent]=useState<AdPlan|null>(null),[selected,setSelected]=useState<number[]>([]);
  const sources=useQuery({queryKey:["ad-sources"],queryFn:()=>api<AdSourceBrief[]>("/ad-breaks/sources"),refetchOnWindowFocus:false});
  const history=useQuery({queryKey:["ad-runs"],queryFn:()=>api<AdBrief[]>("/ad-breaks/runs")});
  const dirty=!!current&&JSON.stringify([...selected].sort((a,b)=>a-b))!==JSON.stringify([...current.selectedN].sort((a,b)=>a-b));
  function apply(r:AdPlan){setCurrent(r);setSelected(r.selectedN);void qc.invalidateQueries({queryKey:["ad-runs"]});}
  function discard(){return !dirty||window.confirm("Отменить несохранённый выбор точек?");}
  const create=useMutation({mutationFn:(json:unknown)=>api<AdPlan>("/ad-breaks/plan",{method:"POST",json}),onSuccess:apply});
  const save=useMutation({mutationFn:()=>api<AdPlan>("/ad-breaks/selection",{method:"POST",json:{id:current!.id,selectedN:selected}}),onSuccess:apply});
  const open=useMutation({mutationFn:(id:string)=>api<AdPlan>(`/ad-breaks/runs/${id}`),onSuccess:apply});
  const busy=create.isPending||save.isPending||open.isPending,source=sources.data?.find(s=>s.id===audioId);
  function numeric(label:string,value:string,set:(v:string)=>void,max:number,min=0,step="any"){return <label className="block min-w-0"><Label>{label}</Label><Input aria-label={label} type="number" required value={value} min={min} max={max} step={step} disabled={busy} onChange={e=>set(e.target.value)}/></label>;}
  return <div><ToolHeader icon={AudioLines} title="Рекламные паузы" eyebrow="AD BREAK PLANNER" subtitle="Сегменты озвучки → кандидаты → ваш выбор. Локальный план для монтажа, без вставки рекламы"/>
    <Card className="mb-5"><SectionTitle>Исходная озвучка</SectionTitle><p className="mb-4 text-sm text-muted-foreground">Сначала загрузите аудио, найдите паузы и сохраните границы в разделе <Link className="text-primary" to="/audio-storyboard">Из озвучки</Link>. Распознавание речи не обязательно. Здесь нет вызовов AI, FFmpeg или YouTube.</p>
      <form className="space-y-4" onSubmit={e=>{e.preventDefault();if(source&&discard()){save.reset();create.mutate({audioId:source.id,revision:source.revision,title,options:{minPause:Number(minPause),intro:Number(intro),outro:Number(outro),minGap:Number(minGap),targetCount:Number(targetCount)}});}}}>
        <label className="block"><Label>Озвучка из истории</Label><Select aria-label="Озвучка из истории" required disabled={busy||sources.isFetching} value={audioId} onChange={e=>setAudioId(e.target.value)}><option value="">— выберите файл —</option>{sources.data?.map(s=><option key={s.id} value={s.id}>{s.name} · {adTime(s.duration)} · версия {s.revision}</option>)}</Select></label>
        <p className="text-xs text-muted-foreground">Последние 30 корректных сохранённых файлов. {source?`Сегментов: ${source.fragments}. Версия ${source.revision}; сохранено ${new Date(source.updatedAt).toLocaleString("ru-RU")}.`:audioId?"Этот файл отсутствует в списке. Откройте его и сохраните в разделе «Из озвучки» либо выберите другой.":"Выберите озвучку для нового плана."}</p>
        <Button type="button" variant="outline" disabled={busy||sources.isFetching} onClick={()=>void sources.refetch()}>Обновить список озвучек</Button>{sources.isError&&<ErrorAlert error={sources.error}/>}
        <label className="block"><Label>Название плана</Label><Input aria-label="Название плана" maxLength={120} value={title} disabled={busy} onChange={e=>setTitle(e.target.value)} placeholder="Например: паузы для монтажа"/></label>
        <div className="grid gap-4 md:grid-cols-2">{numeric("Минимальная пауза, с",minPause,setMinPause,60,.01)}{numeric("Не раньше от начала, с",intro,setIntro,1800)}{numeric("Отступ от конца, с",outro,setOutro,1800)}{numeric("Минимальный интервал точек, с",minGap,setMinGap,1800,.01)}{numeric("Цель: число точек",targetCount,setTargetCount,20,1,"1")}</div>
        <p className="text-xs text-muted-foreground">Это ваши ограничения, не правила YouTube. Кандидат — середина сохранённой паузы внутри зазора между соседними речевыми сегментами. Автовыбор предпочитает длинные паузы с заданным интервалом; точек может быть меньше цели. Равномерные таймкоды не придумываются.</p>
        <Button type="submit" disabled={busy||!source||sources.isFetching||sources.isError||source.fragments<2}>Подобрать и сохранить план</Button>{create.isError&&<ErrorAlert error={create.error}/>}
      </form></Card>
    {open.isError&&<ErrorAlert error={open.error}/>}
    {current&&<Card className="mb-5" data-testid="ad-result"><SectionTitle>{current.title}</SectionTitle><p className="mb-3 break-words text-xs text-muted-foreground">Снимок {new Date(current.createdAt).toLocaleString("ru-RU")} · {current.source.name} · версия {current.source.revision} · {adTime(current.source.duration)}. Изменение формы или исходной озвучки не меняет этот план. Проверяйте соответствие версии файла.</p>
      <Link className="text-sm text-primary" to={`/audio-storyboard?audioId=${current.source.id}`} onClick={e=>{if(!discard())e.preventDefault();}}>Открыть озвучку для проверки →</Link>
      <ul className="my-4 list-disc space-y-2 pl-5 text-xs text-muted-foreground">{current.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>
      <AdBasis key={current.id} plan={current}/><p className="mb-3 text-sm" data-testid="ad-count">Кандидатов: {current.candidates.length} · выбрано: {selected.length} · цель: {current.options.targetCount} · интервал ≥ {current.options.minGap} с.</p>
      {!current.candidates.length&&<p className="mb-4 text-sm">Подходящих пауз нет. Проверьте границы и ограничения; программа не вставляет точку в речь.</p>}
      <div className="space-y-3">{current.candidates.map(c=><label key={c.n} className="flex gap-3 rounded border p-3 text-sm"><input type="checkbox" className="mt-1 shrink-0" aria-label={`Точка ${c.n}`} disabled={busy} checked={selected.includes(c.n)} onChange={e=>{save.reset();setSelected(e.target.checked?[...selected,c.n]:selected.filter(n=>n!==c.n));}}/><span className="min-w-0 break-words"><b>{adTime(c.at)}</b> · интервал {(c.end-c.start).toFixed(3)} с · сегменты {c.before} → {c.after}<span className="mt-1 block text-xs text-muted-foreground">{adTime(c.start)}–{adTime(c.end)}{c.beforeText&&<> · До: {c.beforeText}</>}{c.afterText&&<> · После: {c.afterText}</>}</span></span></label>)}</div>
      {dirty&&<p role="status" className="my-4 text-sm text-accent">Выбор не сохранён. Экспорт недоступен до сохранения. Можно снять все точки; максимум 20, расстояние — из настроек этого снимка.</p>}
      <div className="my-4 flex flex-wrap gap-3"><Button disabled={busy||!dirty} onClick={()=>save.mutate()}>Сохранить выбор</Button><Button variant="outline" disabled={busy||!dirty} onClick={()=>{setSelected(current.selectedN);save.reset();}}>Отменить выбор</Button></div>{save.isError&&<ErrorAlert error={save.error}/>}
      <p className="mb-3 text-xs text-muted-foreground">Сохранение выбора создаёт новый снимок; старый не перезаписывается. TXT содержит только сохранённые таймкоды; Markdown и JSON также включают основание первоначального автовыбора, а JSON — всех кандидатов. Никакой отправки в YouTube.</p>
      <div className="flex flex-wrap gap-3">{!dirty&&<CopyButton text={adText(current)} label="Копировать таймкоды"/>}<Button variant="outline" disabled={dirty||busy} onClick={()=>download(`ad-breaks-${current.id}.txt`,adText(current),"text/plain;charset=utf-8")}>Таймкоды TXT</Button><Button variant="outline" disabled={dirty||busy} onClick={()=>download(`ad-breaks-${current.id}.md`,adText(current,true),"text/markdown;charset=utf-8")}>План Markdown</Button><Button variant="outline" disabled={dirty||busy} onClick={()=>download(`ad-breaks-${current.id}.json`,JSON.stringify(current,null,2),"application/json;charset=utf-8")}>План JSON</Button></div>
    </Card>}
    <Card><SectionTitle icon={<History className="h-4 w-4"/>}>История планов пауз</SectionTitle><p className="mb-3 text-xs text-muted-foreground">Последние 50 снимков; более старые файлы не удаляются. Открытие не пересчитывает точки. История входит в общий ZIP-перенос и может содержать приватные фрагменты текста; храните экспорт приватно.</p>{history.isError&&<ErrorAlert error={history.error}/>}<div className="space-y-2">{history.data?.length===0&&<p>Планов пока нет.</p>}{history.data?.map(r=><button key={r.id} disabled={busy} className="block w-full rounded border p-3 text-left text-sm hover:border-primary" onClick={()=>{if(discard()){save.reset();create.reset();open.mutate(r.id);}}}><b className="break-words">{r.title}</b><span className="mt-1 block break-words text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString("ru-RU")} · {r.sourceName} · точек: {r.selected}</span></button>)}</div></Card>
  </div>;
}
