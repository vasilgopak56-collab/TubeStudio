// Every external request intercepted. Only synthetic YouTube search + existing key diagnostic.
import fs from 'node:fs';
const file=process.env.TS_TEST_SEO_CONTROL;if(!file)throw Error('Synthetic control required');
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),mode=JSON.parse(fs.readFileSync(file,'utf8')).mode,kind=u.pathname.split('/').at(-1);
 if(u.origin!=='https://www.googleapis.com')throw Error('Outbound request blocked');
 const call=Object.fromEntries(['q','order','maxResults','relevanceLanguage','regionCode','safeSearch','id'].map(k=>[k,u.searchParams.get(k)]));fs.appendFileSync(file+'.calls',JSON.stringify({kind,...call})+'\n');
 if(kind==='channels'&&u.searchParams.get('id')==='UCBR8-60-B28hp2BmDPdntcQ')return Response.json({items:[{id:'UC'+'s'.repeat(22),snippet:{title:'Fixture'},statistics:{},contentDetails:{relatedPlaylists:{uploads:'UU'+'s'.repeat(22)}}}]});
 if(kind!=='search')throw Error('Unexpected provider request');
 if(mode==='slow')await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15000),abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail')return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(mode==='invalid')return Response.json({items:[{id:{videoId:'invalid'}}]});
 return Response.json({items:mode==='empty'?[]:['aaaaaaaaaaa','abcdefghijk','bbbbbbbbbbb'].map((videoId,i)=>({id:{videoId},snippet:{title:['Акведуки: путь воды','Как вода попадала в Древний Рим <img src=x onerror=alert(1)> עברית 日本語','Инженеры Рима'][i],channelTitle:'Синтетический канал',publishedAt:'2020-01-01T00:00:00Z',thumbnails:{url:'https://do-not-load.invalid/secret.png'}}})),...(mode==='normal'?{nextPageToken:'not-requested'}:{})});
};
