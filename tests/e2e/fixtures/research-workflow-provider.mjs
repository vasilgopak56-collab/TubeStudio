// Synthetic provider only. Unknown outbound requests fail closed.
import fs from 'node:fs';
const control=process.env.TS_TEST_RESEARCH_CONTROL;if(!control)throw Error('Control required');
const cid='UC'+'a'.repeat(22),other='UC'+'b'.repeat(22),now=Date.now(),day=86400000,ids=Array.from({length:9},(_,i)=>'a'+String(i).repeat(10));
const title='Рим <img src=x onerror=alert(1)> עברית 日本語';
const snippet=i=>({title:i===0?title:'История '+i,channelId:cid,channelTitle:'Рим',publishedAt:new Date(now-[10,7,6,5,1,-1,3,4,8][i]*day).toISOString()});
const channel=id=>({id,snippet:{title},statistics:id===cid?{subscriberCount:'0'}:{hiddenSubscriberCount:true},contentDetails:{relatedPlaylists:{uploads:'UU'+id.slice(2)}}});
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode,workflowViews}=JSON.parse(fs.readFileSync(control,'utf8')),kind=u.pathname.split('/').at(-1);
 if(u.origin!=='https://www.googleapis.com'||!['search','channels','playlistItems','videos'].includes(kind))throw Error('Unknown outbound request blocked');
 if(kind==='channels'&&u.searchParams.get('id')==='UCBR8-60-B28hp2BmDPdntcQ'){fs.appendFileSync(control+'.calls',JSON.stringify({kind:'diagnostic'})+'\n');return Response.json({items:[channel(cid)]});}
 fs.appendFileSync(control+'.calls',JSON.stringify({kind,params:Object.fromEntries([...u.searchParams].filter(([k])=>k!=='key'))})+'\n');
 if(mode==='slow-search'&&kind==='search')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if((mode==='fail-search'&&kind==='search')||(mode==='fail-uploads'&&kind==='playlistItems'))return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(kind==='search')return Response.json({items:mode==='empty'?[]:[{id:{videoId:ids[0]},snippet:snippet(0)},{id:{videoId:'zzzzzzzzzzz'},snippet:{...snippet(0),channelId:other}},{id:{videoId:ids[1]},snippet:snippet(1)}],nextPageToken:'never-loaded'});
 if(kind==='channels')return Response.json({items:u.searchParams.get('id').split(',').map(channel)});
 if(kind==='playlistItems')return Response.json({items:ids.map(videoId=>({contentDetails:{videoId}})),nextPageToken:'never-loaded'});
 return Response.json({items:u.searchParams.get('id').split(',').filter(id=>ids.includes(id)).map(id=>{const i=ids.indexOf(id);return {id,snippet:snippet(i),statistics:i===6?{}:{viewCount:String(i===0&&workflowViews!==undefined?workflowViews:[600,0,100,200,999,500,0,100,200][i]),likeCount:'0',commentCount:'0'},contentDetails:{duration:i===7?'PT1M':i===8?'':'PT10M'}};})});
};
