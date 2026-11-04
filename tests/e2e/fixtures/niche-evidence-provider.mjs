// Synthetic provider; unknown external requests are blocked. No real credentials.
import fs from 'node:fs';
const control=process.env.TS_TEST_NICHE_CONTROL;if(!control)throw Error('Control required');
const ids=['UC'+'a'.repeat(22),'UC'+'b'.repeat(22)];
const now=Date.now(),day=86400000,days=[10,6,3,1,-1,7,8,9];
const channel=id=>({id,snippet:{title:'Рим <img src=x onerror=alert(1)> עברית 日本語',description:'Вода и быт',publishedAt:'2020-01-01T00:00:00Z'},statistics:id===ids[0]?{subscriberCount:'0'}:{hiddenSubscriberCount:true},contentDetails:{relatedPlaylists:{uploads:'UU'+id.slice(2)}},brandingSettings:{channel:{keywords:'"Рим вода" история'}}});
const vids=id=>Array.from({length:8},(_,i)=>id[2]+String(i).repeat(10));
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode}=JSON.parse(fs.readFileSync(control,'utf8')),kind=u.pathname.split('/').at(-1);
 if(u.origin!=='https://www.googleapis.com'||!['search','channels','playlistItems','videos'].includes(kind))throw Error('Unknown outbound request blocked');
 if(kind==='channels'&&u.searchParams.get('id')==='UCBR8-60-B28hp2BmDPdntcQ'){fs.appendFileSync(control+'.calls',JSON.stringify({kind:'diagnostic'})+'\n');return Response.json({items:[channel(ids[0])]});}
 fs.appendFileSync(control+'.calls',JSON.stringify({kind,params:Object.fromEntries([...u.searchParams].filter(([k])=>k!=='key'))})+'\n');
 if(mode==='slow-search'&&kind==='search')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if((mode==='fail-search'&&kind==='search')||(mode==='fail-uploads'&&kind==='playlistItems'&&u.searchParams.get('playlistId')==='UU'+ids[1].slice(2)))return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(kind==='search')return Response.json({items:mode==='empty'?[]:ids.map(channelId=>({id:{channelId}})),nextPageToken:'never-loaded'});
 if(kind==='channels')return Response.json({items:(u.searchParams.get('id')?.split(',')??[ids[0]]).filter(id=>ids.includes(id)).map(channel)});
 if(kind==='playlistItems'){const id='UC'+u.searchParams.get('playlistId').slice(2);return Response.json({items:vids(id).map(videoId=>({contentDetails:{videoId}})),nextPageToken:'never-loaded'});}
 return Response.json({items:u.searchParams.get('id').split(',').map(id=>{const i=Number(id[1]),channelId=ids[id[0]==='a'?0:1];return {id,snippet:{title:i===0?'Рим вода <img src=x onerror=alert(1)> עברית 日本語':'История '+i,description:'',channelId,channelTitle:'Рим',publishedAt:i===5?'invalid':new Date(now-days[i]*day).toISOString()},statistics:i===2?{}:{viewCount:String([100,0,0,999,500,500,200,300][i])},contentDetails:{duration:i===7?'':i===6?'PT1M':'PT10M'}};})});
};
