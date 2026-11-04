export type DailyKind="analysis"|"research"|"keywords"|"competitor";
export const DAILY_LABELS:Record<DailyKind,string>={analysis:"Анализ канала",research:"Исследование",keywords:"Ключевые слова",competitor:"Трекер конкурентов"};
export type DailySource={kind:DailyKind;id:string;title:string;savedAt:string};
export type DailySelection={kind:DailyKind;id:string;language:string;angle:string};
export type DailyPreview={selection:DailySelection;context:{source:DailySource;evidence:{ref:string;title:string;videoId:string|null;publishedAt:string|null;views:number|null;tags:string[]}[];total:number;warnings:string[]};system:string;user:string;hash:string};
export type DailyRun={version:1;id:string;createdAt:string;dayUTC:string;model:string;preview:DailyPreview;ideas:{title:string;angle:string;hook:string;why:string;check:string;evidenceRefs:string[]}[]};
export type DailyHistory={items:{id:string;createdAt:string;dayUTC:string;source:DailySource;count:number}[];skipped:number};
export function dailySourcePath(s:DailySource){return s.kind==="analysis"?`/analysis?report=${encodeURIComponent(s.id)}`:s.kind==="research"?`/research?run=${encodeURIComponent(s.id)}`:s.kind==="keywords"?`/keywords?run=${encodeURIComponent(s.id)}`:"/competitors";}
