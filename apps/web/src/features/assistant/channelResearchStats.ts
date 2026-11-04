/** Local calculation over untrusted saved copies, not proof of YouTube data. */
export type ResearchStats={positions:number;validIds:number;repeatedPositions:number;invalidIds:number;usableViews:number;unusableIds:number;minViews:number|null;maxViews:number|null};
export function channelResearchStats(text:string):ResearchStats|null{
 let x:unknown;try{x=JSON.parse(text);}catch{return null;}
 if(!x||typeof x!=='object'||Array.isArray(x))return null;
 const o=x as Record<string,unknown>;if(o.format!=='tubestudio-channel-selection'||o.version!==1||!Array.isArray(o.positions)||o.positions.length<1||o.positions.length>20)return null;
 const byId=new Map<string,(number|null)[]>();let invalidIds=0;
 for(const item of o.positions){
  if(!item||typeof item!=='object'||Array.isArray(item)){invalidIds++;continue;}
  const row=item as Record<string,unknown>,id=row.id;
  if(typeof id!=='string'||!/^[A-Za-z0-9_-]{11}$/.test(id)){invalidIds++;continue;}
  const v=row.views;const n=row.status==='available'&&typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
  const vals=byId.get(id)??[];vals.push(n);byId.set(id,vals);
 }
 const usable:number[]=[];
 for(const values of byId.values())if(values[0]!==null&&values.every(v=>v===values[0]))usable.push(values[0]);
 return {positions:o.positions.length,validIds:byId.size,repeatedPositions:o.positions.length-invalidIds-byId.size,invalidIds,usableViews:usable.length,unusableIds:byId.size-usable.length,minViews:usable.length?Math.min(...usable):null,maxViews:usable.length?Math.max(...usable):null};
}
