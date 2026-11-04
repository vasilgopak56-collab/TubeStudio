import {useEffect, useRef, useState} from 'react';
import {api} from '@/lib/api';
import {Button, ErrorAlert, Select} from '@/components/ui';
import type {StoryboardSource} from './AssistantStoryboard';

type ScriptList = {scripts:{id:string; title:string; version:number|null}[]};
type Draft = {script:string; projectId?:string};

/** Explicit, read-only selection and comparison; applying only updates the browser draft. */
export function StoryboardProjectPicker({projects,draft,draftFingerprint,getDraft,running,onApply}:{
 projects:{id:string;title:string}[]; draft:Draft; draftFingerprint:string;
 getDraft:()=>{fingerprint:string; result:unknown}; running:boolean; onApply:(source:StoryboardSource)=>void;
}) {
 const [project,setProject]=useState(''),[source,setSource]=useState('');
 const [scripts,setScripts]=useState<ScriptList|null>(null),[preview,setPreview]=useState<StoryboardSource|null>(null);
 const [busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[error,setError]=useState<unknown>(null);
 const epoch=useRef(0),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;epoch.current++;};},[]);
 useEffect(()=>{setConsent(false);},[draftFingerprint,running]);
 async function choose(id:string) {
  const t=++epoch.current;setProject(id);setSource('');setScripts(null);setPreview(null);setConsent(false);setError(null);
  if(!id){setBusy(false);return;}
  setBusy(true);
  try{const r=await api<ScriptList>('/assistant/voice-scripts/'+encodeURIComponent(id));if(alive.current&&t===epoch.current)setScripts(r);}
  catch(e){if(alive.current&&t===epoch.current)setError(e);}
  finally{if(alive.current&&t===epoch.current)setBusy(false);}
 }
 async function review(){
  if(!project||!source||busy||running)return;const t=++epoch.current;setBusy(true);setPreview(null);setConsent(false);setError(null);
  try{const r=await api<StoryboardSource>('/assistant/storyboard-source-preview',{method:'POST',json:{projectId:project,sourceArtifactId:source}});if(alive.current&&t===epoch.current)setPreview(r);}
  catch(e){if(alive.current&&t===epoch.current)setError(e);}
  finally{if(alive.current&&t===epoch.current)setBusy(false);}
 }
 async function apply(){
  if(!preview||!consent||busy||running)return;const before=getDraft(),t=++epoch.current;setBusy(true);setError(null);
  try{
   const r=await api<StoryboardSource>('/assistant/storyboard-source-preview',{method:'POST',json:preview.input});
   if(r.hash!==preview.hash||r.text!==preview.text)throw new Error('Проект или сценарий изменились. Проверьте выбранную версию заново.');
   const now=getDraft();if(now.fingerprint!==before.fingerprint||now.result!==before.result)throw new Error('Черновик или результат изменился во время проверки. Проверьте и подтвердите замену заново.');
   if(alive.current&&t===epoch.current){onApply(r);setPreview(null);setConsent(false);setProject('');setSource('');setScripts(null);}
  }catch(e){if(alive.current&&t===epoch.current){setError(e);setConsent(false);}}
  finally{if(alive.current&&t===epoch.current)setBusy(false);}
 }
 function cancel(){++epoch.current;setProject('');setSource('');setScripts(null);setPreview(null);setConsent(false);setError(null);setBusy(false);}
 const locked=busy||running;
 return <section className="mb-4 space-y-3 rounded-lg border p-4" aria-label="Выбор сценария проекта для раскадровки">
  <h2 className="font-semibold">Выбрать сценарий из проекта</h2>
  <p className="text-sm">Выберите конкретную сохранённую версию. До отдельного подтверждения черновик не меняется; AI не запускается.</p>
  <div className="grid gap-3 md:grid-cols-2">
   <label className="block text-sm">Проект<Select aria-label="Проект для выбора сценария" value={project} disabled={locked} onChange={e=>void choose(e.target.value)}><option value="">Выберите проект</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</Select></label>
   <label className="block text-sm">Версия сценария<Select aria-label="Версия сценария из проекта" value={source} disabled={locked||!scripts} onChange={e=>{++epoch.current;setSource(e.target.value);setPreview(null);setConsent(false);setError(null);}}><option value="">Выберите версию</option>{scripts?.scripts.map(s=><option key={s.id} value={s.id}>{s.title} · {s.version?`v${s.version}`:'без номера'} · {s.id.slice(0,8)}</option>)}</Select></label>
  </div>
  {scripts&&!scripts.scripts.length&&<p className="text-sm">В проекте нет сохранённых сценариев.</p>}
  <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" disabled={locked||!project||!source} onClick={()=>void review()}>Сравнить выбранный сценарий</Button>{(project||preview)&&<Button type="button" size="sm" variant="outline" onClick={cancel}>Отменить выбор сценария</Button>}</div>
  {busy&&<p role="status">Проверяем сохранённую версию…</p>}
  {preview&&<div className="space-y-3 rounded border p-3">
   <p className="text-sm"><b>{preview.project.title}</b> · {preview.sourceArtifact.title} · {preview.sourceArtifact.version?`v${preview.sourceArtifact.version}`:'без номера'} · {preview.chars} символов</p>
   <p className="text-xs break-all">Версия: {preview.sourceArtifact.id}<br/>SHA-256 записи: {preview.sourceArtifact.hash}</p>
   <details><summary>Текущий текст черновика · {draft.script.length} символов</summary><p className="text-xs break-all">Текущий проект: {draft.projectId||'нет'}</p><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{draft.script||'(пусто)'}</pre></details>
   <details open><summary>Выбранный текст целиком</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{preview.text}</pre></details>
   <p className="text-xs text-muted-foreground">Заменятся текст и проект черновика; остальные настройки сохранятся. Показанный результат будет убран с экрана, сохранённые результаты проекта не удаляются. Выбор не запускает генерацию.</p>
   <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="Подтверждаю выбор сценария проекта" checked={consent} disabled={locked} onChange={e=>setConsent(e.target.checked)}/>Проверил обе версии; заменить текст и проект черновика без генерации.</label>
   <Button type="button" size="sm" disabled={!consent||locked} onClick={()=>void apply()}>Применить выбранный сценарий</Button>
  </div>}
  {error?<ErrorAlert error={error}/>:null}
 </section>;
}
