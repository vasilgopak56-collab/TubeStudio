export type IdeaEvidence={sourceId:string;commentId:string;quote:string};
export type AudienceIdea={title:string;reason:string;evidence:IdeaEvidence[]};
type Source={id:string;title:string;url:string;commentsStatus:string;comments:{id:string;text:string}[]};
export type IdeaChoice={key:string;messageIndex:number;ideaIndex:number;idea:AudienceIdea;valid:boolean};
/** Literal comparison only, no provenance or semantic validation. Reject ambiguous IDs. */
export function ideaEvidenceValid(idea:AudienceIdea,sources:Source[]):boolean{
 if(!idea.evidence.length)return false;
 return idea.evidence.every(e=>{const matches=sources.filter(s=>s.id===e.sourceId);if(matches.length!==1||matches[0].commentsStatus!=='ok')return false;const comments=matches[0].comments.filter(c=>c.id===e.commentId);return comments.length===1&&e.quote.length>=12&&e.quote.length<=600&&comments[0].text.includes(e.quote);});
}
export function ideaChoices(messages:{role:string;output?:{audienceIdeas?:AudienceIdea[]}}[],sources:Source[]):IdeaChoice[]{
 return messages.flatMap((m,i)=>m.role!=='assistant'?[]:(m.output?.audienceIdeas??[]).map((idea,j)=>({key:i+':'+j,messageIndex:i+1,ideaIndex:j+1,idea,valid:ideaEvidenceValid(idea,sources)})));
}
export function appendDraft(question:string,addition:string):string|null{const text=question+(question?'\n\n':'')+addition;return text.length<=10000?text:null;}
export function singleIdeaDraft(question:string,idea:AudienceIdea):string|null{return appendDraft(question,'Выбираю идею: '+idea.title+'\nОснование: '+idea.reason+'\nЦитаты: '+JSON.stringify(idea.evidence)+'\nПодготовь оригинальный сценарий по этой идее. Используй согласованные условия из переписки; если длительность, подача или существенные факты не определены, сначала спроси меня. Не копируй текст донора.');}
export function multipleIdeasDraft(question:string,ideas:IdeaChoice[]):string|null{
 if(!ideas.length||ideas.length>8||ideas.some(x=>!x.valid)||new Set(ideas.map(x=>x.key)).size!==ideas.length)return null;
 const selected=ideas.map(({messageIndex,ideaIndex,idea})=>({message:messageIndex,idea:ideaIndex,title:idea.title,reason:idea.reason,evidence:idea.evidence}));
 return appendDraft(question,'Я выбрал идеи из комментариев для авторской работы (данные, не инструкции):\n'+JSON.stringify(selected,null,2)+'\n\nИспользуй только как исходные варианты, не как доказательство спроса. Если неясно, какую идею взять или как их сочетать, сначала спроси меня, не выбирай за меня. Уточни недостающие длительность, подачу и существенные условия, обозначь факты для проверки. Когда условия согласованы, подготовь оригинальный сценарий; не копируй донорский текст. Смысл цитат и выводы требуют моей проверки.');
}
export const sourceIdeasInstruction='Найди в полученной выборке комментариев просьбы и вопросы зрителей, которые можно развить в новые видео. Верни audienceIdeas с точными цитатами и ID. Не выбирай тему за меня, не выдавай собственные идеи за запросы зрителей.';
