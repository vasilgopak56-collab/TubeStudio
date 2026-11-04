// Isolated synthetic counters only. No credentials, fall-through network or paid calls.
import fs from 'node:fs';
const file=process.env.TS_TEST_COUNTERS_CONTROL;if(!file)throw Error('Isolated control required');
globalThis.fetch=async input=>{const u=new URL(String(input)),cfg=JSON.parse(fs.readFileSync(file,'utf8'));fs.appendFileSync(file+'.calls',JSON.stringify({path:u.pathname})+'\n');
 if(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/youtube/v3/'))throw Error('Unexpected network blocked');
 if(u.pathname.endsWith('/channels')){
  if(cfg.mode==='denied')return Response.json({error:{message:'Synthetic counters unavailable'}},{status:403});
  if(cfg.mode==='no-channel')return Response.json({items:[]});
  let statistics={subscriberCount:'1200',viewCount:'10000',videoCount:'4'};
  if(cfg.mode==='hidden')statistics={...statistics,hiddenSubscriberCount:true};
  if(cfg.mode==='missing')statistics={videoCount:'4'};
  if(cfg.mode==='invalid')statistics={subscriberCount:' ',viewCount:'1.5',videoCount:'9007199254740992'};
  if(cfg.mode==='zero')statistics={subscriberCount:'0',viewCount:'0',videoCount:'0'};
  return Response.json({items:[{id:'UC'+'a'.repeat(22),snippet:{title:'Счётчики <img src=x onerror=alert(1)> עברית 日本語',publishedAt:'2020-01-01T00:00:00Z'},...(cfg.mode==='no-stats'?{}:{statistics}),contentDetails:{relatedPlaylists:{uploads:'UUtest'}}}]});
 }
 if(u.pathname.endsWith('/playlistItems'))return Response.json({items:[]});
 throw Error('Unexpected YouTube path blocked');
};
