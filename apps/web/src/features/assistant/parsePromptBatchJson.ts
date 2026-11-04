export type PromptBatchJsonEntry={position:number;field:'image'|'video';value:string};
/** Strict data-only format; no extraction, repair, Markdown fences or inferred positions. */
export function parsePromptBatchJson(raw:string):PromptBatchJsonEntry[]{
 if(raw.length>100000)throw new Error('JSON превышает 100 000 символов; обрезания нет.');
 let data:unknown;try{data=JSON.parse(raw);}catch{throw new Error('Нужен только корректный JSON-массив, без пояснений и Markdown-ограждений.');}
 if(!Array.isArray(data)||data.length<1||data.length>40)throw new Error('Нужен массив от 1 до 40 записей.');
 const entries:PromptBatchJsonEntry[]=[],seen=new Set<string>(),positions=new Set<number>();let chars=0;
 for(const item of data){
  if(!Array.isArray(item)||item.length!==3||!Number.isSafeInteger(item[0])||item[0]<1||item[0]>100000||(item[1]!=='image'&&item[1]!=='video')||typeof item[2]!=='string'||!item[2].trim()||item[2].length>10000)throw new Error('Каждая запись: [позиция, "image" или "video", непустой текст до 10 000 символов].');
  const [position,field,value]=item as [number,'image'|'video',string],key=position+':'+field;
  if(seen.has(key))throw new Error('Пара позиции и поля повторяется.');
  seen.add(key);positions.add(position);chars+=value.length;
  if(positions.size>20||chars>40000)throw new Error('Не более 20 позиций и 40 000 символов текста суммарно.');
  entries.push({position,field,value});
 }
 return entries;
}
