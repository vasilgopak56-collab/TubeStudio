/** Text-only sequence comparison, NOT forced alignment. All acoustic timestamps stay unchanged. */
import { ApiError } from '../lib/errors.js';
export type ScriptReviewRow={n:number;recognizedText:string;scriptText:string;status:'match'|'different'|'unmatched';similarity:number};
export type ScriptReview={method:'token-edit-distance';matchedWords:number;recognizedWords:number;scriptWords:number;rows:ScriptReviewRow[];warning:string};
type Token={word:string;start:number;end:number;fragment:number};
function tokenize(text:string,fragment=0):Token[]{return [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)].map(m=>({word:m[0].normalize('NFKC').toLowerCase().replace(/’/g,"'"),start:m.index!,end:m.index!+m[0].length,fragment}));}
export function compareScript(fragments:{n:number;text:string}[],script:string):ScriptReview{
  const a=fragments.flatMap((f,i)=>tokenize(f.text,i)),b=tokenize(script),n=a.length,m=b.length;
  if(!n||!m)throw new ApiError('VALIDATION','Для сверки нужны распознанная речь и исходный сценарий с текстом.');
  if((n+1)*(m+1)>25_000_000)throw new ApiError('VALIDATION','Тексты слишком длинные для локальной сверки. Сравнивайте запись частями (до примерно 5000 слов на сторону).');
  const trace=new Uint8Array((n+1)*(m+1));let prev=new Uint32Array(m+1),cur=new Uint32Array(m+1);
  for(let j=1;j<=m;j++){prev[j]=j;trace[j]=2;}
  for(let i=1;i<=n;i++){cur[0]=i;trace[i*(m+1)]=1;for(let j=1;j<=m;j++){
    const diag=prev[j-1]+(a[i-1].word===b[j-1].word?0:1),del=prev[j]+1,ins=cur[j-1]+1;
    const best=Math.min(diag,del,ins);cur[j]=best;trace[i*(m+1)+j]=best===diag?0:best===del?1:2;
  }[prev,cur]=[cur,prev];}
  const owner=new Int32Array(m).fill(-1),matched=new Uint32Array(fragments.length);let i=n,j=m;
  while(i||j){const dir=trace[i*(m+1)+j];if(i&&j&&dir===0){owner[j-1]=a[i-1].fragment;if(a[i-1].word===b[j-1].word)matched[a[i-1].fragment]++;i--;j--;}else if(i&&(!j||dir===1)){i--;}else{j--;}}
  // Script-only insertions are suggestions attributed to adjacent speech, never applied silently.
  let last=-1;for(let k=0;k<m;k++){if(owner[k]>=0)last=owner[k];else if(last>=0)owner[k]=last;}
  let next=-1;for(let k=m-1;k>=0;k--){if(owner[k]>=0)next=owner[k];else if(next>=0)owner[k]=next;}
  const rows=fragments.map((f,index)=>{
    const assigned=b.map((t,k)=>({t,k})).filter(({k})=>owner[k]===index),words=tokenize(f.text),from=assigned[0]?.k,to=assigned.at(-1)?.k;
    const suggestion=from===undefined||to===undefined?'':script.slice(from===0?0:b[from].start,to+1<m?b[to+1].start:script.length).trim();
    const equal=words.length===assigned.length&&words.every((w,k)=>w.word===assigned[k].t.word);
    return {n:f.n,recognizedText:f.text,scriptText:suggestion,status:(!assigned.length||!matched[index]?'unmatched':equal?'match':'different') as ScriptReviewRow['status'],similarity:Math.round(matched[index]/Math.max(words.length,assigned.length,1)*100)/100};
  });
  return {method:'token-edit-distance',matchedWords:matched.reduce((s,x)=>s+x,0),recognizedWords:n,scriptWords:m,rows,warning:'Это текстовая сверка, не пословное выравнивание аудио. Повторы, пропуски, другой язык и отличия сценария могут смещать подсказки. Проверьте спорные места на слух; таймкоды не изменены.'};
}
