// Compose an explicitly labelled AI proposal with mechanically copied observations.
// This module does not call a model, YouTube or a paid service and does not save.
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import type {ScanResult} from './brainstormScan.js';
import type {TopicResult} from './brainstormTopics.js';
import {channelSample} from './brainstormMetrics.js';
const text=(max:number)=>z.string().trim().min(1).max(max);
const Idea=z.object({title:text(160),score:z.number().int().min(0).max(10),reason:text(900),direction:text(100),topicQuery:text(160).nullable()}).strict();
export const BrainstormProposal=z.object({ideas:z.array(Idea).length(8)}).strict();
/** Resolve names only against the actual stored observations. Never trust model URLs or model-provided metrics. */
export function composeBrainstormReport(scan:ScanResult,topics:TopicResult[],raw:unknown){
 const parsed=BrainstormProposal.safeParse(raw);if(!parsed.success)throw new ApiError('VALIDATION','Ответ модели не соответствует формату восьми идей. Отчёт не создан.',400);
 const ideas=parsed.data.ideas;
 if(new Set(ideas.map(i=>i.title.normalize('NFKC').toLocaleLowerCase())).size!==ideas.length)throw new ApiError('VALIDATION','В ответе модели повторяются названия идей. Отчёт не создан.',400);
 const resolved=ideas.map(i=>{
  const ds=scan.directions.filter(d=>d.direction===i.direction);
  if(ds.length!==1||!ds[0].sources.length)throw new ApiError('VALIDATION','Идея ссылается на отсутствующее или пустое направление. Отчёт не создан.',400);
  const ts=i.topicQuery===null?[]:topics.filter(t=>t.query===i.topicQuery&&t.status==='ok'&&t.sample);
  if(i.topicQuery!==null&&ts.length!==1)throw new ApiError('VALIDATION','Идея ссылается на недоступную или неоднозначную проверку темы. Отчёт не создан.',400);
  // The model supplies only a reference; exact source links and counts come from data.
  const d=ds[0],t=ts[0];
  return {title:i.title,score:i.score,reason:i.reason,direction:d.direction,evidence:{videoCount:d.videoCount,channelCount:d.channelCount,knownViewCount:d.knownViewCount,medianViews:d.medianViews,smallChannelHits:d.smallChannelHits,unknownSubscriberVideos:d.unknownSubscriberVideos,incomplete:d.incomplete,sources:d.sources.slice(0,5),sourcesTotal:d.sources.length,sourcesTruncated:d.sources.length>5},topic:t?.sample??null};
 });
 return {version:1 as const,observedAt:scan.observedAt,region:scan.region,coverage:scan.coverage,ideas:resolved,channels:scan.channels.map(c=>channelSample(c,scan.observedAt)),topicChecks:topics,
  notice:'Оценки и объяснения — предложения модели, не проверенные факты и не прогноз просмотров. Числа и ссылки в блоках наблюдений скопированы из ограниченной выборки YouTube, а не из ответа модели; проверяйте интерпретации и источники. В карточке идеи показаны не более пяти ссылок; все наблюдения сохранены отдельно. Неполная выборка не доказывает отсутствия спроса.'};
}
