export type DraftTask='routine'|'script'|'imagePrompt'|'animationPrompt';
export type DraftSnapshot={version:1;runId:string;task:DraftTask;text:string;needsScopeReview:boolean;savedAt:string};
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tasks:DraftTask[]=['routine','script','imagePrompt','animationPrompt'];
export function draftKey(runId:string):string{if(!idPattern.test(runId))throw new Error('Некорректный идентификатор диалога.');return 'ts:assistant:draft:v1:'+runId;}
export function parseDraft(raw:string|null,runId:string):DraftSnapshot|null{
 if(!raw||raw.length>110000)return null;
 try{const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).sort().join(',')!=='needsScopeReview,runId,savedAt,task,text,version')return null;
 if(d.version!==1||d.runId!==runId||!idPattern.test(d.runId)||!tasks.includes(d.task)||typeof d.text!=='string'||!d.text.trim()||d.text.length>10000||typeof d.needsScopeReview!=='boolean'||typeof d.savedAt!=='string'||d.savedAt.length!==24||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(d.savedAt)||!Number.isFinite(Date.parse(d.savedAt)))return null;
 return d as DraftSnapshot;}catch{return null;}
}
export function makeDraft(runId:string,task:DraftTask,text:string,needsScopeReview:boolean,savedAt:string):DraftSnapshot{
 const d={version:1,runId,task,text,needsScopeReview,savedAt};const out=parseDraft(JSON.stringify(d),runId);if(!out)throw new Error('Некорректный или пустой черновик.');return out;
}
