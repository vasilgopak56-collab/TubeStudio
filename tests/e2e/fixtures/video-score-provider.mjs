// Synthetic fixture: every outbound fetch is intercepted; never talks to real Google/AI.
import fs from 'node:fs';
const file=process.env.TS_TEST_VIDEO_SCORE_CONTROL;if(!file)throw Error('Explicit synthetic fixture control required');
const channelId='UC'+'s'.repeat(22),target='abcdefghijk';
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),mode=JSON.parse(fs.readFileSync(file,'utf8')).mode;
 if(u.origin!=='https://www.googleapis.com')throw Error('Outbound request blocked');
 const kind=u.pathname.split('/').at(-1);fs.appendFileSync(file+'.calls',JSON.stringify({kind,id:u.searchParams.get('id'),max:u.searchParams.get('maxResults')})+'\n');
 if((mode==='slow' && kind==='videos')||(mode==='slow-base'&&kind==='playlistItems'))await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,15000);const abort=()=>{clearTimeout(timer);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail' && kind==='videos' || mode==='base-fail' && kind==='channels')return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'forbidden'}]}},{status:400});
 if(kind==='playlistItems'&&mode==='page404')return Response.json({error:{message:'SECRET_PROVIDER_LEAK',errors:[{reason:'playlistNotFound'}]}},{status:404});
 if(kind==='videos'&&mode==='wrong-target'&&u.searchParams.get('id')===target)return Response.json({items:[{id:'zzzzzzzzzzz',snippet:{title:'Wrong',description:'',channelId,publishedAt:'2020-01-01T00:00:00Z'},statistics:{},contentDetails:{duration:'PT10M'}}]});
 if(kind==='videos')return Response.json({items:mode==='notfound'?[]:u.searchParams.get('id').split(',').filter(id=>!(mode==='missing'&&id==='bbbbbbbbbbb')).map((id,i)=>({id,snippet:{title:id===target?'Как вода попадала в Древний Рим <img src=x onerror=alert(1)> עברית 日本語':`Акведуки: пример ${i+1}`,description:'Как строились каналы?\n00:00 Начало\n01:00 Инженеры Рима',channelId:mode==='foreign'&&u.searchParams.get('id')!==target?'UC'+'z'.repeat(22):channelId,channelTitle:'Синтетический исторический канал',publishedAt:'2020-01-01T00:00:00Z',tags:['Рим','акведук','история']},statistics:mode==='unknown'?{viewCount:'0'}:{viewCount:String(id===target?1000:(i+1)*100),likeCount:'10',commentCount:'5'},contentDetails:{duration:'PT10M'}}))});
 if(kind==='channels')return Response.json({items:[{id:channelId,snippet:{title:'Канал'},statistics:{},contentDetails:{relatedPlaylists:{uploads:'UU'+channelId.slice(2)}}}]});
 if(kind==='playlistItems')return Response.json({items:(mode==='empty-page'?[]:mode==='duplicate-page'?['aaaaaaaaaaa','aaaaaaaaaaa']:['aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc',target]).map(videoId=>({contentDetails:{videoId}})),...(['missing','more'].includes(mode)?{nextPageToken:'NOT_FOLLOWED'}:{})});
 throw Error('Unexpected YouTube request blocked');
};
