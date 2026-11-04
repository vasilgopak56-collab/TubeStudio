// Synthetic data only. Unknown outbound requests are blocked.
import fs from 'node:fs';
const control=process.env.TS_TEST_KW_CONTROL;if(!control)throw Error('Control required');
const c1='UC'+'a'.repeat(22),c2='UC'+'b'.repeat(22),c3='UC'+'c'.repeat(22),ids=['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc','ddddddddddd'];
const rows=ids.map((id,i)=>({id:{videoId:id},snippet:{title:i===0?'РИМ  ВОДА <img src=x onerror=alert(1)> עברית 日本語':'История '+i,channelId:[c1,c1,c2,c3][i],channelTitle:'Синтетический канал',publishedAt:'2020-01-01T00:00:00Z'}}));
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode}=JSON.parse(fs.readFileSync(control,'utf8'));let kind=u.origin==='https://suggestqueries.google.com'?'suggest':u.pathname.split('/').at(-1);
 if(u.origin==='https://api.anthropic.com'&&u.pathname==='/v1/models'){fs.appendFileSync(control+'.calls',JSON.stringify({kind:'models'})+'\n');return Response.json({data:[{id:'claude-haiku-4-5'}]});}
 if(u.origin==='https://api.anthropic.com'&&u.pathname==='/v1/messages'){const b=JSON.parse(String(init.body));if(b.max_tokens!==1)throw Error('AI generation blocked');fs.appendFileSync(control+'.calls',JSON.stringify({kind:'diagnostic'})+'\n');return Response.json({content:[{type:'text',text:'1'}]});}
 if(u.origin==='https://www.googleapis.com'&&kind==='channels'&&u.searchParams.get('id')==='UCBR8-60-B28hp2BmDPdntcQ'){fs.appendFileSync(control+'.calls',JSON.stringify({kind:'yt-diagnostic'})+'\n');return Response.json({items:[{id:c1,snippet:{title:'Synthetic'},statistics:{},contentDetails:{}}]});}
 if(!(u.origin==='https://suggestqueries.google.com'&&u.pathname==='/complete/search'||u.origin==='https://www.googleapis.com'&&['search','videos','channels'].includes(kind)))throw Error('Unknown external request blocked');
 const params=Object.fromEntries([...u.searchParams].filter(([k])=>k!=='key'));fs.appendFileSync(control+'.calls',JSON.stringify({kind,params})+'\n');
 if((mode==='slow-suggest'&&kind==='suggest')||(mode==='slow-search'&&kind==='search'))await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail-'+kind)return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(kind==='suggest')return Response.json(mode==='invalid'?{}:[u.searchParams.get('q'),mode==='empty'?[]:['Рим вода','рим  вода','Как Рим доставлял воду','<img src=x onerror=alert(1)> עברית 日本語','', 'x'.repeat(121)]]);
 if(kind==='search')return Response.json(mode==='invalid'?{items:[rows[0],rows[0]]}:{items:mode==='empty'?[]:rows,nextPageToken:'not-loaded'});
 if(kind==='videos')return Response.json({items:rows.slice(0,3).map((r,i)=>({id:r.id.videoId,snippet:r.snippet,contentDetails:{duration:'PT10M'},statistics:i===2?{}:{viewCount:i===0?'100':'0'}}))});
 return Response.json({items:[{id:c1,snippet:{title:'Канал'},statistics:{subscriberCount:'0'}},{id:c2,snippet:{title:'Канал'},statistics:{hiddenSubscriberCount:true}},{id:c3,snippet:{title:'Канал'},statistics:{subscriberCount:'20000'}}]});
};
