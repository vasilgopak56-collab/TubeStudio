// Внутренняя граница API для следующего этапа. Не подключать к маршруту без
// отдельного подтверждения плана, проверки неизменности и журнала попытки.
// Вызывающий код должен указывать только ID из сохранённого исследования.
import {ApiError} from '../../lib/errors.js';
import {checkCancelled,withTaskSignal} from '../../lib/taskContext.js';

const channelId=/^UC[A-Za-z0-9_-]{22}$/;
const playlistId=/^UU[A-Za-z0-9_-]{22}$/;
const object=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
type Query=(path:'channels'|'playlistItems',params:Record<string,string|number|undefined>,units:1)=>Promise<unknown>;

/** До 50 каналов. 1 метаданный запрос + до 3 страниц на канал; общий клиент
 * способен до 3 попыток на каждый из 3 ключей. Это верхняя граница, не фактический расход.
 * YouTube может учесть неудачные запросы; локальный счётчик — лишь оценка. */
export function uploadsQuotaBound(channelCount:number,maxPages:number){
 if(!Number.isInteger(channelCount)||channelCount<1||channelCount>50||!Number.isInteger(maxPages)||maxPages<1||maxPages>3)throw new ApiError('VALIDATION','Недопустимый размер проверки загрузок.',400);
 const logicalRequests=1+channelCount*maxPages;
 return {channels:channelCount,maxPagesPerChannel:maxPages,logicalRequests,maxPhysicalAttempts:logicalRequests*9,maxQuotaUnits:logicalRequests*9};
}

/** Only API-returned channel-to-uploads mappings are accepted, never constructed IDs.
 * Missing or malformed mappings remain null; duplicate or unexpected IDs invalidate
 * the entire response instead of making an ambiguous assertion. */
export function createBrainstormUploadsAdapter(query:Query){
 return {
  async playlists(ids:string[]):Promise<Map<string,string|null>>{
   if(!Array.isArray(ids)||ids.length<1||ids.length>50||ids.some(id=>typeof id!=='string'||!channelId.test(id))||new Set(ids).size!==ids.length)throw new ApiError('VALIDATION','Недопустимый список каналов.',400);
   const result=new Map(ids.map(id=>[id,null] as [string,string|null]));
   const response=object(await query('channels',{part:'contentDetails',id:ids.join(','),maxResults:50},1));
   if(!response||!Array.isArray(response.items)||response.items.length>ids.length)throw new ApiError('UPSTREAM','Ответ YouTube о каналах не распознан.',502);
   const seen=new Set<string>();
   for(const raw of response.items){
    const item=object(raw),id=item?.id;
    if(typeof id!=='string'||!result.has(id)||seen.has(id))throw new ApiError('UPSTREAM','Ответ YouTube о каналах неоднозначен.',502);
    seen.add(id);
    const details=object(item?.contentDetails),related=object(details?.relatedPlaylists),uploads=related?.uploads;
    if(typeof uploads==='string'&&playlistId.test(uploads))result.set(id,uploads);
   }
   return result;
  },
  async page(id:string,token:string|undefined,signal?:AbortSignal):Promise<unknown>{
   if(typeof id!=='string'||!playlistId.test(id)||token!==undefined&&(typeof token!=='string'||token.length<1||token.length>2048))throw new ApiError('VALIDATION','Недопустимые параметры страницы загрузок.',400);
   return withTaskSignal(signal,async()=>{checkCancelled();const result=await query('playlistItems',{part:'contentDetails,status',playlistId:id,maxResults:50,pageToken:token},1);checkCancelled();return result;});
  },
 };
}
