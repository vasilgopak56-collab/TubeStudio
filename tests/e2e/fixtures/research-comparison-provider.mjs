// Synthetic bounded comparison provider. All unknown outbound requests fail closed.
import fs from 'node:fs';
const control=process.env.TS_TEST_RESEARCH_CONTROL;if(!control)throw Error('Control required');
const cid=ch=>'UC'+ch.repeat(22),ids=ch=>Array.from({length:6},(_,i)=>ch+String(i).repeat(10));
const snippet=(ch,i)=>({title:i===0?'History of Rome '+ch+' <img src=x onerror=alert(1)>':'Daily life '+ch+' '+i,channelId:cid(ch),channelTitle:'History channel '+ch,publishedAt:'2025-01-01T00:00:00.000Z'});
const channel=ch=>({id:cid(ch),snippet:{title:'History channel '+ch},statistics:ch==='a'?{subscriberCount:'1000'}:{hiddenSubscriberCount:true},contentDetails:{relatedPlaylists:{uploads:'UU'+ch.repeat(22)}}});
globalThis.fetch=async(input,init={})=>{const u=new URL(String(input)),{mode}=JSON.parse(fs.readFileSync(control,'utf8')),kind=u.pathname.split('/').at(-1);
 if(u.origin!=='https://www.googleapis.com'||!['search','channels','playlistItems','videos'].includes(kind))throw Error('Unknown outbound request blocked');
 if(kind==='channels'&&u.searchParams.get('id')==='UCBR8-60-B28hp2BmDPdntcQ'){fs.appendFileSync(control+'.calls',JSON.stringify({kind:'diagnostic'})+'\n');return Response.json({items:[channel('a')]});}
 fs.appendFileSync(control+'.calls',JSON.stringify({kind,params:Object.fromEntries([...u.searchParams].filter(([k])=>k!=='key'))})+'\n');
 if(mode==='slow'&&kind==='playlistItems')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='failure'&&kind==='channels')return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(kind==='search')return Response.json({items:['a','b','c'].map(ch=>({id:{videoId:ids(ch)[0]},snippet:snippet(ch,0)})),nextPageToken:'NEVER_FOLLOWED'});
 if(kind==='channels')return Response.json({items:u.searchParams.get('id').split(',').map(id=>channel(id[2]))});
 if(kind==='playlistItems'){const ch=u.searchParams.get('playlistId')[2];return Response.json({items:mode==='empty'&&ch==='a'?[]:ids(ch).map(videoId=>({contentDetails:{videoId}})),nextPageToken:'NEVER_FOLLOWED'});}
 return Response.json({items:u.searchParams.get('id').split(',').filter(v=>mode!=='unknown'||v[1]!=='5').map(id=>{const ch=id[0],i=Number(id[1]);return {id,snippet:snippet(ch,i),statistics:mode==='unknown'?{}:{viewCount:String(i===0?100000:1000),likeCount:'0',commentCount:'0'},contentDetails:{duration:'PT10M'}};})});
};
