// Synthetic YouTube only; never falls through to the network or reads credentials.
import fs from 'node:fs';
const file=process.env.TS_TEST_TRENDS_CONTROL;if(!file)throw Error('Explicit isolated control required');
globalThis.fetch=async input=>{const u=new URL(String(input)),cfg=JSON.parse(fs.readFileSync(file,'utf8'));fs.appendFileSync(file+'.calls',JSON.stringify({host:u.host,path:u.pathname})+'\n');
 if(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/youtube/v3/'))throw Error('Unexpected external request blocked');
 const cid='UC'+'a'.repeat(22),title='Конкурент <img src=x onerror=alert(1)> עברית 日本語';
 if(u.pathname.endsWith('/channels'))return Response.json({items:[{id:cid,snippet:{title,publishedAt:cfg.publishedAt},statistics:{subscriberCount:'1000',viewCount:'99999',videoCount:'4'},contentDetails:{relatedPlaylists:{uploads:'UUtest'}}}]});
 if(u.pathname.endsWith('/playlistItems')&&cfg.mode==='missing')return Response.json({error:{message:'not found'}},{status:404});
 if(u.pathname.endsWith('/playlistItems')&&cfg.mode==='duplicate')return Response.json({items:['target00000','target00000'].map(id=>({contentDetails:{videoId:id}}))});
 if(u.pathname.endsWith('/playlistItems'))return cfg.mode==='denied'?Response.json({error:{message:'Тест: обновление недоступно'}},{status:403}):Response.json({items:['target00000','aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc'].map(id=>({contentDetails:{videoId:id}}))});
 if(u.pathname.endsWith('/videos'))return Response.json({items:['target00000','aaaaaaaaaaa','bbbbbbbbbbb','ccccccccccc'].map((id,i)=>({id,snippet:{title:id==='target00000'?title:id,publishedAt:cfg.publishedAt,channelId:cfg.mode==='foreign'?'UC'+'z'.repeat(22):cid,channelTitle:title},statistics:{...(cfg.mode==='unknown'&&i===0?{}:{viewCount:String(i===0?(cfg.mode==='high'?12000:1200):1000+i*20)}),likeCount:'1',commentCount:'2'},contentDetails:{duration:cfg.mode==='duration-unknown'?undefined:cfg.mode==='short'&&i>0?'PT1M':'PT10M'}}))});
 throw Error('Unexpected YouTube path blocked');
};
