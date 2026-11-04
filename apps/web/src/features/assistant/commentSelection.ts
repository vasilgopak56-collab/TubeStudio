/** IDs refer to already saved comments; the server validates the scope separately. */
type Comment={id:string;text:string;truncated:boolean};
type Source={id:string;title:string;url:string;commentsStatus:string;comments:Comment[]};
export type CommentChoice={key:string;sourceId:string;commentId:string;sourceIndex:number;commentIndex:number;title:string;url:string;text:string;truncated:boolean};
export function commentChoices(sources:Source[]):{rows:CommentChoice[];ambiguous:number}{
 const sourceCounts=new Map<string,number>();for(const s of sources)sourceCounts.set(s.id,(sourceCounts.get(s.id)??0)+1);
 let ambiguous=0;const rows:CommentChoice[]=[];
 sources.forEach((s,si)=>{if(s.commentsStatus!=='ok')return;const counts=new Map<string,number>();for(const c of s.comments)counts.set(c.id,(counts.get(c.id)??0)+1);
  s.comments.forEach((c,ci)=>{if(sourceCounts.get(s.id)!==1||counts.get(c.id)!==1){ambiguous++;return;}rows.push({key:JSON.stringify([s.id,c.id]),sourceId:s.id,commentId:c.id,sourceIndex:si+1,commentIndex:ci+1,title:s.title,url:s.url,text:c.text,truncated:c.truncated});});
 });return {rows,ambiguous};
}
export function filterCommentChoices(rows:CommentChoice[],search:string){const q=search.trim().toLocaleLowerCase('ru-RU');return q?rows.filter(r=>(r.title+'\n'+r.commentId+'\n'+r.text).toLocaleLowerCase('ru-RU').includes(q)):rows;}
export function selectedCommentDraft(question:string,rows:CommentChoice[]):string|null{
 if(!rows.length||rows.length>20||new Set(rows.map(r=>r.key)).size!==rows.length)return null;
 const refs=rows.map(r=>({sourceId:r.sourceId,commentId:r.commentId}));
 const task='Рассмотри только эти выбранные комментарии как возможные основания для идей: '+JSON.stringify(refs)+'\nНайди реальные просьбы или вопросы, если они есть. Верни audienceIdeas с точными непрерывными цитатами и указанными sourceId и commentId. Не используй другие комментарии как доказательства выбранных идей. Если подходящих просьб нет, честно скажи об этом; свои идеи обозначь как гипотезы AI, не как запросы зрителей. Это ограниченная выборка без ответов, а не мнение всей аудитории или доказательство спроса. Не выбирай тему за меня и не копируй сценарии доноров.';
 const next=question+(question?'\n\n':'')+task;return next.length<=10000?next:null;
}
