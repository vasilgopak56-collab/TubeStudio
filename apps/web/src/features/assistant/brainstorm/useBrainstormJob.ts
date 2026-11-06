import {useCallback,useEffect,useRef,useState} from 'react';
import {api} from '@/lib/api';
import {forgetBrainstormJob,launchBrainstormJob,readBrainstormJob,watchBrainstormJob,type BrainstormJobRecord,type StreamEvent} from './jobTracker';

type State={record:BrainstormJobRecord|null;status:'idle'|'starting'|'running'|'done'|'error'|'unknown';stage:string;pct:number;notice:string;result?:unknown;partial?:unknown[]};
const empty=():State=>({record:null,status:'idle',stage:'',pct:0,notice:''});
/** Dedicated lifecycle: dismissing the panel disconnects listeners, never cancels jobs. */
export function useBrainstormJob(onDone:()=>void){
 const [state,setState]=useState<State>(empty),alive=useRef(false),detach=useRef<()=>void>(()=>{}),done=useRef(onDone);done.current=onDone;
 const connect=useCallback((record:BrainstormJobRecord)=>{
  detach.current();
  setState(s=>({...s,record,status:record.jobId?'running':'unknown',notice:record.jobId?'':'Ответ о запуске не получен. Проверьте проект и восстановление до повторного запуска.'}));
  detach.current=watchBrainstormJob(record,url=>new EventSource(url),(event:StreamEvent)=>{
   if(!alive.current)return;
   const raw=event.data as {stage?:string;pct?:number;data?:unknown;error?:{message?:string}}|undefined;
   if(event.type==='progress')setState(s=>({...s,status:'running',stage:raw?.stage??'',pct:raw?.pct??s.pct,notice:''}));
   if(event.type==='partial')setState(s=>({...s,partial:[...(s.partial??[]),raw?.data]}));
   if(event.type==='done'){setState(s=>({...s,status:'done',pct:100,result:raw?.data,notice:'Задача завершена. Проверьте результат, прежде чем продолжить.'}));done.current();}
   if(event.type==='error'){setState(s=>({...s,status:'error',notice:raw?.error?.message??'Задача завершилась ошибкой. Проверьте проект перед повторным запуском.'}));done.current();}
   if(event.type==='disconnected')setState(s=>({...s,status:'unknown',notice:String(event.data??'Связь прервана. Проверьте результат перед повторным запуском.')}));
  });
 },[]);
 useEffect(()=>{alive.current=true;try{const record=readBrainstormJob(localStorage);if(record)connect(record);}catch(e){setState({...empty(),status:'unknown',notice:(e as Error).message});}return()=>{alive.current=false;detach.current();};},[connect]);
 const start=useCallback(async(record:BrainstormJobRecord,input:unknown)=>{
  setState({...empty(),record,status:'starting',notice:'Запускаю задачу…'});
  try{const saved=await launchBrainstormJob(localStorage,(path,init)=>api<{jobId:string}>(path,init),record,input);if(alive.current)connect(saved);}
  catch(e){if(alive.current){let stored:BrainstormJobRecord|null=null;try{stored=readBrainstormJob(localStorage);}catch{}setState({...empty(),record:stored,status:'unknown',notice:(e as Error).message});}}
 },[connect]);
 const refreshTracking=useCallback(()=>{try{const r=readBrainstormJob(localStorage);if(r)connect(r);else setState({...empty(),status:'unknown',notice:'Запись задачи не найдена. Проверьте материалы проекта перед новым запуском.'});}catch(e){setState(s=>({...s,status:'unknown',notice:(e as Error).message}));}},[connect]);
 const acknowledge=useCallback(()=>{try{if(!state.record)throw Error('Нет доступной записи задачи.');forgetBrainstormJob(localStorage,state.record,true);detach.current();setState(empty());}catch(e){setState(s=>({...s,notice:(e as Error).message}));}},[state.record]);
 return {...state,start,acknowledge,refreshTracking};
}
