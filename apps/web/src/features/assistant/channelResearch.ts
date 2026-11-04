export type ResearchCandidate={index:number;name:string;channel:string;positions:number};
/** Recognition is only a marker, not validation or proof of provenance. */
export function channelResearchCandidates(documents:{name:string;text:string}[]):ResearchCandidate[]{
 return documents.flatMap((d,index)=>{try{const x:unknown=JSON.parse(d.text);if(!x||typeof x!=='object'||Array.isArray(x))return [];const o=x as Record<string,unknown>;if(o.format!=='tubestudio-channel-selection'||o.version!==1||!Array.isArray(o.positions)||o.positions.length<1||o.positions.length>20)return [];const ch=o.channel;const title=ch&&typeof ch==='object'&&!Array.isArray(ch)?(ch as Record<string,unknown>).title:null;return [{index,name:d.name,channel:typeof title==='string'&&title.length<=300?title:'канал не указан',positions:o.positions.length}];}catch{return [];}});
}
export function channelResearchDraft(question:string,selected:ResearchCandidate[]):string|null{
 if(!selected.length)return null;
 const list=selected.map(x=>`- Материал ${x.index+1}: ${JSON.stringify(x.name)}`).join('\n');
 const task=`Сравни только выбранные текстовые выборки метаданных каналов:\n${list}\n\nЕсли для полезного сравнения не хватает цели или других существенных условий, сначала задай необходимые вопросы. Иначе отдели наблюдения из выборок от своих предположений: для каждого наблюдения укажи материал, страницу, позицию и точный ID ролика. Учитывай повторные ID и время получения; не суммируй повторы как разные ролики. Неизвестные значения не считай нулём. Сравнение охватывает лишь выбранные позиции и не является рейтингом всего канала; метрики могли устареть и не доказывают причины успеха или спрос аудитории. По названиям предложи несколько возможных направлений как гипотезы AI, а не просьбы зрителей; предложи мне выбрать, не выбирай за меня. Не утверждай, что смотрел видео, читал комментарии или проверил происхождение и факты. Не копируй сценарии доноров. Не создавай сценарий или промпты в рутинной роли.`;
 const next=question+(question?'\n\n':'')+task;return next.length<=10000?next:null;
}
