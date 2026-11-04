import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { cancellation, checkCancelled, taskContext, taskSignal } from '../lib/taskContext.js';
import type { ConsentLaunch, ConsentSpec, PriceChallenge, ConsentResolution } from '../lib/priceConsentTypes.js';

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Spec = z.object({contextHash:Hash,tariffHash:Hash,tasks:z.array(z.object({provider:z.string().min(1).max(300),model:z.string().min(1).max(300),kind:z.enum(['text','image','tts','audio','search'])}).strict()).min(1).max(8)}).strict();
const Launch = z.object({owner:z.string().uuid(),requestId:z.string().uuid(),route:z.string().min(5).max(300).startsWith('/api/').refine(s=>!/[?#\r\n]/.test(s))}).strict();
/** Opaque in-memory receipt. No API returns this object or a dispatch grant. */
export type ConsentPermit = Readonly<{ id: string }>;
type Binding = { launch: ConsentLaunch; spec: ConsentSpec; jobId?: string };
type Pending = { owner: string; challenge: PriceChallenge; binding: Binding; signal?: AbortSignal; resolve: (p: ConsentPermit) => void; reject: (e: Error) => void; notify?: (r: ConsentResolution) => void; cleanup: () => void };
type PermitRecord = { fingerprint: string; expires: number; signal?: AbortSignal };
const fingerprint = (b: Binding) => createHash('sha256').update(JSON.stringify({launch:b.launch,jobId:b.jobId??null,contextHash:b.spec.contextHash,tariffHash:b.spec.tariffHash,tasks:b.spec.tasks})).digest('hex');
const denial = (code: 'BUDGET_CONSENT_REQUIRED'|'BUDGET_CONSENT_STALE'|'BUDGET_CONSENT_EXPIRED'|'BUDGET_CONSENT_CAPACITY', message:string) => new ApiError(code,message,402);

/** Single-call consent. Only explicitly integrated dispatch paths enforce it.
 * Each caller consumes against fresh context/tariff before ONE dispatch.
 * Pending is memory-only, bounded, expiring, and never stored in backups/settings.
 */
export class PriceConsentBroker {
  private pending = new Map<string, Pending>();
  private permits = new WeakMap<ConsentPermit, PermitRecord>();
  constructor(private options: {ttlMs?:number;maxPending?:number;maxPerOwner?:number;now?:()=>number}={}) {
    const {ttlMs=120_000,maxPending=64,maxPerOwner=8}=options;
    if(!Number.isInteger(ttlMs)||ttlMs<1||ttlMs>120_000||!Number.isInteger(maxPending)||maxPending<1||maxPending>64||!Number.isInteger(maxPerOwner)||maxPerOwner<1||maxPerOwner>8)throw new Error('Invalid consent broker limits');
  }
  private now(){return this.options.now?.()??Date.now();}
  private binding(input:ConsentSpec):Binding {
    const c=taskContext(),launch=Launch.safeParse(c?.launch),spec=Spec.safeParse(input);
    if(!launch.success)throw denial('BUDGET_CONSENT_REQUIRED','Для отдельного согласия нужен новый поддерживаемый запуск из интерфейса. Постоянное разрешение не выдаётся.');
    if(!spec.success)throw new ApiError('VALIDATION','Неверная область согласия; запрос не отправлен.');
    return {launch:launch.data,spec:spec.data,...(c?.jobId?{jobId:c.jobId}:{})};
  }
  private finish(id:string,status:ConsentResolution['status']) {
    const p=this.pending.get(id);if(!p)return false;
    this.pending.delete(id);p.cleanup();
    if(status==='approved'){
      const permit=Object.freeze({id});this.permits.set(permit,{fingerprint:fingerprint(p.binding),expires:Date.parse(p.challenge.expiresAt),signal:p.signal});p.resolve(permit);
    }else if(status==='cancelled')p.reject(cancellation());
    else p.reject(status==='expired'?denial('BUDGET_CONSENT_EXPIRED','Срок отдельного согласия истёк. Этот вызов не отправлен; уже выполненные шаги не запускаются повторно.'):new ApiError('BUDGET_CONSENT_DENIED','Пользователь отклонил этот платный вызов. Уже выполненные шаги не запускаются повторно.',402));
    try{p.notify?.({id,status});}catch{/* notification cannot turn a terminal decision into a retry */}
    return true;
  }
  private sweep(){for(const [id,p] of this.pending)if(Date.parse(p.challenge.expiresAt)<=this.now())this.finish(id,'expired');}
  request(input:ConsentSpec, message?:string):Promise<ConsentPermit> {
    const binding=this.binding(input),signal=taskSignal();checkCancelled(signal);this.sweep();
    if(this.pending.size>=(this.options.maxPending??64)||[...this.pending.values()].filter(p=>p.owner===binding.launch.owner).length>=(this.options.maxPerOwner??8))throw denial('BUDGET_CONSENT_CAPACITY','Слишком много ожидающих согласий. Новый вызов не отправлен; завершите или отмените прежние ожидания.');
    const now=this.now(),id=randomUUID(),expires=now+(this.options.ttlMs??120_000);
    const challenge:PriceChallenge={version:1,id,scopeHash:createHash('sha256').update(JSON.stringify({id,binding:fingerprint(binding)})).digest('hex'),route:binding.launch.route,...(binding.jobId?{jobId:binding.jobId}:{}),createdAt:new Date(now).toISOString(),expiresAt:new Date(expires).toISOString(),tasks:structuredClone(binding.spec.tasks),message:message??'Цена этого вызова неизвестна. Подтверждение относится только к указанному вызову, не к будущим шагам, резервным моделям или повторам. Сумма списания не ограничивается этим согласием.'};
    const context=taskContext();
    return new Promise((resolve,reject)=>{
      const abort=()=>this.finish(id,'cancelled');
      const timer=setTimeout(()=>this.finish(id,'expired'),this.options.ttlMs??120_000);timer.unref();
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      this.pending.set(id,{owner:binding.launch.owner,challenge,binding,signal,resolve,reject,notify:context?.onPriceConsentResolved,cleanup});
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted){abort();return;}
      try{context?.onPriceConsent?.(structuredClone(challenge));}catch{this.finish(id,'cancelled');}
    });
  }
  list(owner:string):PriceChallenge[]{this.sweep();return [...this.pending.values()].filter(p=>p.owner===owner).map(p=>structuredClone(p.challenge));}
  decide(owner:string,id:string,scopeHash:string,decision:'approve'|'deny') {
    this.sweep();const p=this.pending.get(id);
    if(!p||p.owner!==owner)throw new ApiError('NOT_FOUND','Ожидание согласия не найдено для этого запуска.',404);
    if(p.challenge.scopeHash!==scopeHash)throw new ApiError('BUDGET_CONSENT_STALE','Область согласия изменилась. Подтверждение не применено.',409);
    if(decision!=='approve'&&decision!=='deny')throw new ApiError('VALIDATION','Неверное решение.');
    return this.finish(id,decision==='approve'?'approved':'denied');
  }
  /** Single-use, in-process, launch/job/context/tariff bound. Recheck immediately before send. */
  consume(permit:ConsentPermit,current:ConsentSpec) {
    const saved=this.permits.get(permit);this.permits.delete(permit);
    if(!saved)throw denial('BUDGET_CONSENT_STALE','Согласие отсутствует или уже использовано; новый вызов не отправлен.');
    checkCancelled(saved.signal);checkCancelled();
    if(saved.expires<=this.now())throw denial('BUDGET_CONSENT_EXPIRED','Согласие устарело до отправки; вызов не отправлен.');
    if(saved.fingerprint!==fingerprint(this.binding(current)))throw denial('BUDGET_CONSENT_STALE','Модель, контекст, тариф или запуск изменились; прежнее согласие не применимо.');
  }
  cancelLaunch(owner:string,requestId:string){let count=0;for(const [id,p] of this.pending)if(p.owner===owner&&p.binding.launch.requestId===requestId){this.finish(id,'cancelled');count++;}return count;}
}
export const priceConsents=new PriceConsentBroker();
