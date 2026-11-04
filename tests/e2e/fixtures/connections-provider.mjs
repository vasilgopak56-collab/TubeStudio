// Fully synthetic Google provider: no real token, key, or network fallthrough.
import fs from 'node:fs/promises';
const control=process.env.TS_TEST_CONNECTIONS_CONTROL;
if(!control)throw Error('Isolated connections control is required');
const base='https://www.googleapis.com/auth/yt-analytics.readonly';
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),cfg=JSON.parse(await fs.readFile(control,'utf8'));
 const reply=(j,status=200)=>new Response(JSON.stringify(j),{status});
 const log=async x=>fs.appendFile(control+'.calls',JSON.stringify(x)+'\n');
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'){
  const body=new URLSearchParams(init.body),c=body.get('refresh_token')?.endsWith('_b')?'b':'a';await log({kind:'refresh',channel:c});
  if(cfg.mode==='denied')return reply({error:'invalid_grant',error_description:'SECRET_SENTINEL_DO_NOT_EXPOSE'},400);
  return reply({access_token:'SYNTH_VERIFIED_'+c,expires_in:3600,scope:cfg.money?base+' https://www.googleapis.com/auth/yt-analytics-monetary.readonly':base});
 }
 const auth=new Headers(init.headers).get('authorization')||'',c=auth.endsWith('_b')?'b':'a';
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels'){
  await log({kind:'identity',channel:c});
  return reply({items:[{id:'UC'+(cfg.mode==='wrong'?'z':c).repeat(22),snippet:{title:'Канал '+c+' <img src=x onerror=alert(1)> עברית 日本語'}}]});
 }
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/revoke'){await log({kind:'revoke'});return reply({});}
 if(u.origin!=='https://youtubeanalytics.googleapis.com'||u.pathname!=='/v2/reports')throw Error('Unexpected external request blocked by connections fixture');
 const q=Object.fromEntries(u.searchParams);await log({kind:'report',channel:c,metrics:q.metrics,ids:q.ids});
 const columnHeaders=[...(q.dimensions?[{name:q.dimensions}]:[]),...q.metrics.split(',').map(name=>({name}))];
 if(q.dimensions==='day'&&q.metrics==='views,estimatedMinutesWatched,subscribersGained,subscribersLost')return reply({columnHeaders,rows:[[q.startDate,c==='a'?11:22,20,3,1]]});
 return reply({columnHeaders,rows:q.dimensions?[]:[q.metrics.split(',').map(n=>n==='views'?(c==='a'?111:222):0)]});
};
