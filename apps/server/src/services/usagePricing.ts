import {z} from 'zod';
import {createHash} from 'node:crypto';
import {getSettings} from './settings.js';
import type {AmBilling} from './anymodel.js';
export type PaidKind='text'|'image'|'tts'|'audio'|'search';
export type PriceSnapshot={version:1;capturedAt:string;priceVersion:string;provider:string;model:string;kind:PaidKind;currency:'USD';source:'configured-direct'|'cached-anymodel'|'builtin-search-estimate';known:boolean;input?:number;output?:number;image?:number;usdPerMillion?:number;coefficientInput?:number;coefficientOutput?:number;baseTokens?:number;scale?:number;reason?:string};
const num=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
/** No network. Capture only the tariff visible before dispatch, never a later catalog/settings revision. */
export async function capturePrice(provider:string,model:string,kind:PaidKind,billing?:AmBilling,o:{size?:string;quality?:string;catalogFresh?:boolean}={}):Promise<PriceSnapshot>{
 const s=await getSettings();const base={version:1 as const,provider,model,kind,currency:'USD' as const};let tariff:Omit<PriceSnapshot,'capturedAt'|'priceVersion'>;
 if(provider!=='anymodel'){
  const p=s.budget.prices.find(p=>model.toLowerCase().includes(p.match.toLowerCase()));
  const known=!!p&&(kind==='text'||kind==='audio'?num(p.input)&&num(p.output):kind==='image'&&num(p.image));
  tariff={...base,source:'configured-direct',known,...(p?{input:p.input,output:p.output,image:p.image}:{}),...(!known?{reason:'Нет подходящего тарифа этой задачи'}:{})};
 }else if(kind==='search')tariff={...base,source:'builtin-search-estimate',known:true,baseTokens:40000,usdPerMillion:s.anymodel.usdPerMillion};
 else{
  const b=billing,c=b?.coefficient;let known=o.catalogFresh!==false&&!!b;let scale=1;
  if(kind==='text'||kind==='audio')known=known&&num(c?.input)&&num(c?.output);
  else if(kind==='tts')known=known&&num(b?.base_tokens)&&num(c?.output);
  else{const q=b?.scales?.quality,sz=b?.scales?.size;if(q){if(!o.quality||!num(q[o.quality]))known=false;else scale*=q[o.quality];}if(sz){if(!o.size||!num(sz[o.size]))known=false;else scale*=sz[o.size];}known=known&&num(b?.base_tokens)&&num(c?.output)&&num(scale);}
  tariff={...base,source:'cached-anymodel',known,usdPerMillion:s.anymodel.usdPerMillion,...(num(c?.input)?{coefficientInput:c!.input}:{}),...(num(c?.output)?{coefficientOutput:c!.output}:{}),...(num(b?.base_tokens)?{baseTokens:b!.base_tokens}:{}),scale,...(!known?{reason:'Нет полного свежего тарифа в локальном каталоге; fallback-коэффициенты не считаются известной ценой'}:{})};
 }
 return {...tariff,capturedAt:new Date().toISOString(),priceVersion:createHash('sha256').update(JSON.stringify(tariff)).digest('hex')};
}
export type OperationVolume={input?:number;output?:number;count?:number;chars?:number;known:boolean};
export function operationCost(p:PriceSnapshot,v:OperationVolume){
 if(!p.known||!v.known)return {usd:null,balanceTokens:null};
 const required=p.kind==='text'||p.kind==='audio'?num(v.input)&&num(v.output):p.kind==='tts'?num(v.chars):num(v.count);
 if(!required)return {usd:null,balanceTokens:null};
 const valid=Object.values(v).every(n=>typeof n==='boolean'||num(n));if(!valid)return {usd:null,balanceTokens:null};
 let usd:number,balanceTokens:number|null=null;
 if(p.provider==='anymodel'){
  const tokens=p.kind==='text'||p.kind==='audio'?(v.input??0)*(p.coefficientInput??NaN)+(v.output??0)*(p.coefficientOutput??NaN):p.kind==='tts'?(v.chars??0)*(p.baseTokens??NaN)*(p.coefficientOutput??NaN):(v.count??0)*(p.baseTokens??NaN)*(p.kind==='search'?1:(p.coefficientOutput??NaN)*(p.scale??1));
  balanceTokens=Math.ceil(tokens);usd=balanceTokens*(p.usdPerMillion??NaN)/1e6;
 }else usd=p.kind==='image'?(v.count??0)*(p.image??NaN):((v.input??0)*(p.input??NaN)+(v.output??0)*(p.output??NaN))/1e6;
 return num(usd)&& (balanceTokens===null||num(balanceTokens))?{usd,balanceTokens}:{usd:null,balanceTokens:null};
}

const N=z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PriceSnapshotSchema=z.object({version:z.literal(1),capturedAt:z.string().datetime(),priceVersion:z.string().regex(/^[a-f0-9]{64}$/),provider:z.string().min(1).max(300),model:z.string().min(1).max(300),kind:z.enum(['text','image','tts','audio','search']),currency:z.literal('USD'),source:z.enum(['configured-direct','cached-anymodel','builtin-search-estimate']),known:z.boolean(),input:N.optional(),output:N.optional(),image:N.optional(),usdPerMillion:N.optional(),coefficientInput:N.optional(),coefficientOutput:N.optional(),baseTokens:N.optional(),scale:N.optional(),reason:z.string().max(500).optional()}).strict();
export const OperationVolumeSchema=z.object({input:N.optional(),output:N.optional(),count:N.optional(),chars:N.optional(),known:z.boolean()}).strict();
