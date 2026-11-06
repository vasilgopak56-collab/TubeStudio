// Only validated, project-bound upload observations may enter an idea context/report.
import {createHash} from 'node:crypto';
import {ApiError} from '../../lib/errors.js';
import type {ScanResult} from './brainstormScan.js';
import type {TopicResult} from './brainstormTopics.js';
import {UploadsRecovery,type UploadsRecoveryT} from './brainstormUploadsStore.js';
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function projectBrainstormUploads(scan:ScanResult,topics:TopicResult[],raw:UploadsRecoveryT){
 const p=UploadsRecovery.safeParse(raw);
 if(!p.success||p.data.evidenceHash!==digest({scan,topics}))throw new ApiError('VALIDATION','Проверка загрузок не соответствует исследованию.',409);
 const results=p.data.results.map(r=>{
  const channels=scan.channels.filter(c=>c.id===r.channelId);if(channels.length!==1)throw new ApiError('VALIDATION','Проверенный канал отсутствует в исследовании.',409);
  return {channelId:r.channelId,name:channels[0].name.slice(0,200),status:r.status,observation:r.observation};
 });
 return {observedAt:p.data.observedAt,results,notice:'Проверялись только доступные публичные загрузки в ограниченном списке. Скрытые и удалённые публикации не видны; самый ранний найденный ролик не обязательно первая публикация. Результаты не доказывают возраст канала, спрос или будущие просмотры.'};
}
