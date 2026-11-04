// Synthetic only: every unhandled outbound request fails closed.
import fs from 'node:fs';
const file=process.env.TS_TEST_REACH_CONTROL;if(!file)throw Error('Explicit synthetic control required');
const cid='UC'+'a'.repeat(22),head='date,channel_id,video_id,video_thumbnail_impressions,video_thumbnail_impressions_ctr';
const j={id:'job_1',name:'TubeStudio <img src=x onerror=alert(1)> עברית 日本語',reportTypeId:'channel_reach_basic_a1',createTime:'2026-01-01T10:00:00Z'};
const report={id:'report_1',jobId:'job_1',startTime:'2026-01-01T08:00:00Z',endTime:'2026-01-02T08:00:00Z',createTime:'2026-01-03T10:00:00Z',downloadUrl:'https://youtubereporting.googleapis.com/v1/media/report_1?alt=media'};
let jobs=[];
globalThis.fetch=async(input,init={})=>{const u=new URL(String(input)),cfg=JSON.parse(fs.readFileSync(file,'utf8')),method=init.method??'GET';fs.appendFileSync(file+'.calls',JSON.stringify({host:u.host,path:u.pathname,query:Object.fromEntries(u.searchParams),method})+'\n');
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token')return Response.json({access_token:'ISOLATED_ACCESS',expires_in:3600,scope:'https://www.googleapis.com/auth/yt-analytics.readonly'});
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels'&&cfg.mode==='diag-identity')return Response.json({error:{errors:[{reason:'insufficientPermissions'}],message:'SECRET_PROVIDER_LEAK'}},{status:403});
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels')return Response.json({items:[{id:cid}]});
 if(u.origin==='https://youtubeanalytics.googleapis.com'&&u.pathname==='/v2/reports'){const names=u.searchParams.get('metrics').split(','),dim=u.searchParams.get('dimensions');return Response.json({columnHeaders:[...(dim?[{name:dim}]:[]),...names.map(name=>({name}))],rows:dim?[]:[names.map(()=>0)]});}
 if(u.origin!=='https://youtubereporting.googleapis.com')throw Error('Unexpected network blocked');
 if(cfg.mode.startsWith('diag-')){const reasons={'diag-disabled':'SERVICE_DISABLED','diag-scopes':'ACCESS_TOKEN_SCOPE_INSUFFICIENT','diag-quota':'QUOTA_EXCEEDED','diag-rate':'RATE_LIMIT_EXCEEDED'};return Response.json({error:{message:'SECRET_PROVIDER_LEAK <img src=x onerror=alert(1)>',details:[{'@type':'type.googleapis.com/google.rpc.ErrorInfo',domain:'googleapis.com',reason:reasons[cfg.mode]??'UNKNOWN_PRIVATE_REASON',metadata:{consumer:'projects/SECRET_PROJECT'}}]}},{status:403});}
 if(cfg.mode==='denied')return Response.json({error:{message:'SECRET_PROVIDER_LEAK'}},{status:403});
 if(u.pathname==='/v1/jobs'&&method==='POST'){jobs=[j];if(cfg.mode==='lost-post')throw Error('SECRET_LOST_POST');return Response.json(j);}
 if(u.pathname==='/v1/jobs')return Response.json({jobs});
 if(u.pathname==='/v1/jobs/job_1'&&method==='DELETE'){jobs=[];return new Response(null,{status:204});}
 if(u.pathname==='/v1/jobs/job_1')return jobs.length?Response.json(j):Response.json({error:{}},{status:404});
 if(u.pathname==='/v1/jobs/job_1/reports')return Response.json({reports:cfg.mode==='pending'?[]:[{...report,...(u.searchParams.has('pageToken')?{id:'report_2'}:{})}],...(cfg.mode==='next'&&!u.searchParams.has('pageToken')?{nextPageToken:'SECOND_PAGE'}:{})});
 if(u.pathname==='/v1/jobs/job_1/reports/report_1')return Response.json({...report,...(cfg.mode==='ssrf'?{downloadUrl:'https://evil.example/SECRET'}:{})});
 if(u.pathname==='/v1/jobs/job_1/reports/report_2')return Response.json({...report,id:'report_2'});
 if(u.pathname==='/v1/media/report_1'){
  if(cfg.mode==='redirect')return new Response('',{status:302,headers:{location:'https://evil.example/'}});
  const rows=cfg.mode==='empty'?'':cfg.mode==='zero'?`20260101,${cid},abcdefghijk,0,0\n`:cfg.mode==='unknown'?`20260101,${cid},abcdefghijk,,5\n`:cfg.mode==='foreign'?`20260101,UC${'b'.repeat(22)},abcdefghijk,100,5\n`:cfg.mode==='broken'?'BAD,CSV\n':cfg.mode==='many'?Array.from({length:101},(_,i)=>`20260101,${cid},${String(i).padStart(11,'0')},1,5\n`).join(''):`20260101,${cid},abcdefghijk,100,0.125\n20260101,${cid},lmnopqrstuv,0,0\n`;
  return new Response(head+'\n'+rows);
 }
 throw Error('Unexpected Reporting request blocked');
};
