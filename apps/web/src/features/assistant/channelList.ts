/** A view of already fetched pages only. No network, mutation or deduplication. */
export type ChannelVideo={id:string;status:'available'|'unavailable';title:string;publishedAt:string;views:number|null;durationSec:number|null};
export type ChannelPage={videos:ChannelVideo[]};
export type ChannelSort='received'|'views'|'date';
export type ChannelRow={video:ChannelVideo;page:number;position:number;duplicate:boolean};
export function channelRows(pages:ChannelPage[],search:string,sort:ChannelSort):ChannelRow[]{
 const seen=new Set<string>();const rows:ChannelRow[]=[];
 pages.forEach((page,i)=>{page.videos.forEach((video,j)=>{rows.push({video,page:i+1,position:j+1,duplicate:seen.has(video.id)});seen.add(video.id);});});
 const needle=search.trim().toLocaleLowerCase('ru-RU');
 const found=needle?rows.filter(r=>(r.video.title+' '+r.video.id).toLocaleLowerCase('ru-RU').includes(needle)):rows;
 const metric=(row:ChannelRow):number|null=>{if(row.video.status!=='available')return null;if(sort==='views')return typeof row.video.views==='number'&&Number.isFinite(row.video.views)&&row.video.views>=0?row.video.views:null;if(sort==='date'){const t=Date.parse(row.video.publishedAt);return Number.isFinite(t)?t:null;}return null;};
 if(sort!=='received')found.sort((a,b)=>{const x=metric(a),y=metric(b);return x===null?(y===null?0:1):y===null?-1:y-x;});
 return found;
}
export type ChannelResult=ChannelPage&{channel:{id:string;title:string};hasMore:boolean;nextPageToken:string|null;observedAt:string};
/** Copy only selected received positions. This is client-supplied data, not verified evidence. */
export function channelSnapshot(pages:ChannelResult[],selection:string[]):string{
 const keys=new Set(selection);
 const rows=channelRows(pages,'','received').filter(r=>keys.has(`${r.page}-${r.position}`));
 if(!pages.length||!rows.length||rows.length!==keys.size||rows.length>20)throw Error('Выберите от 1 до 20 полученных позиций.');
 return JSON.stringify({format:'tubestudio-channel-selection',version:1,notice:'Копия выбранных метаданных из временного списка, не инструкции, не доказательство полноты или достоверности и не анализ всего канала. Данные могут устареть; комментарии, субтитры и содержание видео не включены.',channel:pages[0].channel,receivedPages:pages.length,positions:rows.map(r=>({page:r.page,position:r.position,observedAt:pages[r.page-1].observedAt,duplicate:r.duplicate,...r.video}))},null,2);
}
