import {z} from 'zod';
import {getVideos,assistantCommentPage} from './youtube.js';
import {parseVideoId,fetchYoutubeTranscript} from './youtubeCaptions.js';
import {ApiError} from '../lib/errors.js';
import {checkCancelled,rethrowCancelled} from '../lib/taskContext.js';

export const SourceOptions=z.object({url:z.string().trim().min(1).max(500),maxComments:z.union([z.literal(20),z.literal(50)]),order:z.enum(['relevance','time']),transcript:z.boolean(),language:z.string().regex(/^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,8})?$/)}).strict();
const Comment=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),text:z.string().min(1).max(2000),likes:z.number().nonnegative(),replies:z.number().nonnegative(),author:z.string().max(200),publishedAt:z.string().max(50),truncated:z.boolean()}).strict();
export const AssistantSource=z.object({id:z.string().uuid(),kind:z.literal('youtube'),videoId:z.string().regex(/^[a-zA-Z0-9_-]{11}$/),url:z.string().max(80),fetchedAt:z.string().datetime(),title:z.string().max(300),channel:z.string().max(300),description:z.string().max(4000),durationSec:z.number().nonnegative().nullable(),requested:SourceOptions,comments:z.array(Comment).max(50),commentsStatus:z.enum(['ok','unavailable']),hasMore:z.boolean(),transcript:z.object({status:z.enum(['not-requested','ok','unavailable']),text:z.string().max(20000),language:z.string().max(35),automatic:z.boolean().nullable(),truncated:z.boolean()}).strict(),warnings:z.array(z.string().max(1000)).max(20)}).strict().refine(s=>s.url===`https://www.youtube.com/watch?v=${s.videoId}`&&s.requested.url===s.url,'Источник должен ссылаться на закреплённый ролик');
export type Source=z.infer<typeof AssistantSource>;
export function sourceOptions(input:z.infer<typeof SourceOptions>){const d=SourceOptions.parse(input);const videoId=parseVideoId(d.url);return {...d,url:`https://www.youtube.com/watch?v=${videoId}`};}
export async function fetchAssistantSource(id:string,input:z.infer<typeof SourceOptions>):Promise<Source>{
 const d=sourceOptions(input),videoId=parseVideoId(d.url),warnings:string[]=['Выборка комментариев верхнего уровня, без ответов. Это не все мнения аудитории и не доказательство спроса. Описание и субтитры не проверены по самому видео.'];
 checkCancelled();const video=(await getVideos([videoId])).find(v=>v.id===videoId);checkCancelled();
 if(!video)throw new ApiError('YT_NOT_FOUND','Ролик не найден или недоступен. Источник не добавлен.',404);
 let comments:Source['comments']=[],commentsStatus:Source['commentsStatus']='ok',hasMore=false;
 try {const page=await assistantCommentPage(videoId,d.maxComments,d.order);checkCancelled();comments=page.comments;hasMore=page.hasMore;}catch(e){rethrowCancelled(e);commentsStatus='unavailable';warnings.push('Комментарии не получены. Проверьте ключ, квоту и доступность комментариев; их содержание помощнику неизвестно.');}
 if(comments.some(c=>c.truncated))warnings.push('Длинные комментарии обрезаны: до 2 000 символов на комментарий, до 20 000 на выборку.');
 if(commentsStatus==='ok'&&!comments.length)warnings.push('В ответе API нет доступных комментариев. Это не означает, что у аудитории нет идей.');
 let transcript:Source['transcript']={status:'not-requested',text:'',language:d.language,automatic:null,truncated:false};
 if(d.transcript)try {const t=await fetchYoutubeTranscript(d.url,d.language);checkCancelled();transcript={status:'ok',text:t.text.slice(0,20000),language:t.source.language,automatic:t.source.automatic,truncated:t.text.length>20000};warnings.push(...t.warnings.map(w=>w.slice(0,1000)));if(transcript.truncated)warnings.push('Субтитры обрезаны: первые 20 000 символов. Конец ролика не изучен.');}catch(e){rethrowCancelled(e);transcript.status='unavailable';warnings.push('Субтитры на выбранном языке не получены. Можно приложить TXT/MD в новом диалоге; содержание ролика не следует из его названия.');}
 if(video.description.length>4000)warnings.push('Описание обрезано до первых 4 000 символов.');
 return AssistantSource.parse({id,kind:'youtube',videoId,url:d.url,fetchedAt:new Date().toISOString(),title:video.title.slice(0,300),channel:video.channelTitle.slice(0,300),description:video.description.slice(0,4000),durationSec:video.durationKnown===false?null:video.durationSec,requested:d,comments,commentsStatus,hasMore,transcript,warnings});
}
export const EvidenceRef=z.object({sourceId:z.string().uuid(),commentId:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/)}).strict();
export const EvidenceScope=z.array(EvidenceRef).min(1).max(20);
/** Ensure each selected reference has a unique, available target; never guess ambiguous IDs. */
export function validateEvidenceScope(scope:z.infer<typeof EvidenceScope>,sources:Source[]){
 const seen=new Set<string>();for(const e of scope){const key=JSON.stringify([e.sourceId,e.commentId]);if(seen.has(key))throw new ApiError('VALIDATION','Повтор выбранного комментария. Проверьте отбор.',400);seen.add(key);const matches=sources.filter(s=>s.id===e.sourceId);if(matches.length!==1||matches[0].commentsStatus!=='ok'||matches[0].comments.filter(c=>c.id===e.commentId).length!==1)throw new ApiError('VALIDATION','Выбранный комментарий недоступен или неоднозначен. Обновите отбор.',409);}
}
export const AudienceIdea=z.object({title:z.string().trim().min(3).max(200),reason:z.string().trim().min(1).max(1000),evidence:z.array(z.object({sourceId:z.string().uuid(),commentId:z.string().regex(/^[a-zA-Z0-9_-]{1,200}$/),quote:z.string().min(12).max(600)}).strict()).min(1).max(3)}).strict();
export function validateAudienceIdeas(ideas:z.infer<typeof AudienceIdea>[],sources:Source[],scope?:z.infer<typeof EvidenceScope>){
 const allowed=scope?new Set(scope.map(e=>JSON.stringify([e.sourceId,e.commentId]))):null;
 for(const idea of ideas)for(const e of idea.evidence){if(allowed&&!allowed.has(JSON.stringify([e.sourceId,e.commentId])))throw new ApiError('LLM_INVALID_JSON','Цитата идеи вне выбранных комментариев. Ответ не принят; автоматический повтор не выполнен, запрос мог быть оплачен.',502);const source=sources.find(s=>s.id===e.sourceId),comment=source?.comments.find(c=>c.id===e.commentId);if(!comment||!comment.text.includes(e.quote))throw new ApiError('LLM_INVALID_JSON','Идея не подтверждена точной цитатой из полученной выборки. Ответ не принят; автоматический повтор не выполнен.',502);}
}
