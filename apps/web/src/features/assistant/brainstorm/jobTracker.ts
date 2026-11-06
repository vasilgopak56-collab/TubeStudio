/** Tracks a single brainstorm job without cancelling it when the panel closes.
 * A missing response is deliberately unresolved: never launch it again automatically. */
export type BrainstormJobKind='planning'|'collection'|'uploads'|'ideas'|'brand'|'images'|'images-collect';
export type BrainstormJobRecord={version:1;projectId:string;kind:BrainstormJobKind;attemptId:string;jobId?:string};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
type Start=(path:string,init:{method:'POST';json:unknown})=>Promise<{jobId:string}>;
type Stream={addEventListener(type:string,listener:(event:Event)=>void):void;close():void;readyState:number};
export type StreamEvent={type:'progress'|'partial'|'done'|'error'|'disconnected';data?:unknown};
const KEY='tubestudio.brainstorm.active.v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const kinds:BrainstormJobKind[]=['planning','collection','uploads','ideas','brand','images','images-collect'];
function validate(v:unknown):BrainstormJobRecord{
 if(!v||typeof v!=='object')throw Error('Данные задачи повреждены. Проверьте проект до повторного запуска.');
 const r=v as Record<string,unknown>;
 if(r.version!==1||typeof r.projectId!=='string'||!uuid.test(r.projectId)||typeof r.attemptId!=='string'||!uuid.test(r.attemptId)||!kinds.includes(r.kind as BrainstormJobKind)||(r.jobId!==undefined&&(typeof r.jobId!=='string'||!uuid.test(r.jobId))))throw Error('Данные задачи повреждены. Проверьте проект до повторного запуска.');
 return {version:1,projectId:r.projectId,attemptId:r.attemptId,kind:r.kind as BrainstormJobKind,...(r.jobId?{jobId:r.jobId as string}:{})};
}
export function readBrainstormJob(store:Store):BrainstormJobRecord|null{
 const raw=store.getItem(KEY);if(raw===null)return null;
 try{return validate(JSON.parse(raw));}catch{throw Error('Не удалось прочитать сохранённую задачу. Проверьте проект до повторного запуска.');}
}
export async function launchBrainstormJob(store:Store,start:Start,record:BrainstormJobRecord,input:unknown):Promise<BrainstormJobRecord>{
 const proposed=validate(record);if(proposed.jobId)throw Error('Нельзя запустить существующую задачу повторно.');
 if(readBrainstormJob(store))throw Error('Сначала проверьте предыдущую задачу мозгового штурма.');
 // This write must succeed before POST. The record remains if the response is lost.
 store.setItem(KEY,JSON.stringify(proposed));
 let reply:{jobId:string};try{reply=await start('/assistant/brainstorm/'+proposed.kind,{method:'POST',json:input});}catch{throw Error('Ответ о запуске не получен. Задача могла начаться: проверьте проект и восстановление перед повтором.');}
 const saved=validate({...proposed,jobId:reply.jobId});
 // Do not overwrite a record changed in another panel/tab while POST was in flight.
 const current=readBrainstormJob(store);if(!current||current.projectId!==proposed.projectId||current.attemptId!==proposed.attemptId||current.kind!==proposed.kind||current.jobId)throw Error('Состояние задачи изменилось. Проверьте проект перед повтором.');
 try{store.setItem(KEY,JSON.stringify(saved));}catch{throw Error('Задача могла начаться, но её номер не удалось сохранить. Проверьте проект и восстановление перед повтором.');}
 return saved;
}
/** Detaching only closes the listener. It never calls the cancellation endpoint. */
export function watchBrainstormJob(record:BrainstormJobRecord,makeStream:(url:string)=>Stream,notify:(event:StreamEvent)=>void):()=>void{
 const r=validate(record);if(!r.jobId){notify({type:'disconnected',data:'Ответ о запуске не получен. Проверьте проект и восстановление; не повторяйте автоматически.'});return ()=>{};}
 const stream=makeStream('/api/jobs/'+r.jobId+'/stream');let active=true,terminal=false;
 for(const type of ['progress','partial','done','error'] as const)stream.addEventListener(type,(event:Event)=>{
  if(!active||terminal)return;const raw=(event as MessageEvent).data;
  if(type==='error'&&!raw){notify({type:'disconnected',data:stream.readyState===2?'Задача недоступна. Проверьте проект и восстановление; повторять автоматически нельзя.':'Связь прервана; переподключение. Задача может продолжаться.'});return;}
  try{const parsed=JSON.parse(raw);if(type==='done'||type==='error'){terminal=true;stream.close();}notify({type,data:parsed});}catch{notify({type:'disconnected',data:'Не удалось прочитать ответ задачи. Проверьте проект перед повтором.'});}
 });
 return ()=>{active=false;stream.close();};
}
/** Only a deliberate acknowledgement can clear a tracked job. */
export function forgetBrainstormJob(store:Store,expected:BrainstormJobRecord,confirmed:boolean){
 if(!confirmed)throw Error('Сначала проверьте результат и подтвердите.');
 const current=readBrainstormJob(store),r=validate(expected);
 if(!current||current.projectId!==r.projectId||current.attemptId!==r.attemptId||current.kind!==r.kind||current.jobId!==r.jobId)throw Error('Состояние задачи изменилось. Обновите просмотр.');
 store.removeItem(KEY);
}
