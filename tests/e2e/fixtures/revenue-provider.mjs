// Explicitly isolated synthetic provider: no real network fallthrough and no tokens logged.
import fs from 'node:fs/promises';
const control=process.env.TS_TEST_REVENUE_CONTROL;
if(!control)throw Error('Synthetic revenue fixture needs a control file');
const base='https://www.googleapis.com/auth/yt-analytics.readonly',money='https://www.googleapis.com/auth/yt-analytics-monetary.readonly';
globalThis.fetch=async(input,init)=>{
 const u=new URL(String(input)),{mode}=JSON.parse(await fs.readFile(control,'utf8'));
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token'){
  return new Response(JSON.stringify({access_token:'SYNTH_ACCESS_NEW',refresh_token:'SYNTH_REFRESH_NEW',expires_in:3600,scope:mode==='partial'?base:base+' '+money}));
 }
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels')return new Response(JSON.stringify({items:[{id:'UC'+'a'.repeat(22),snippet:{title:'Тестовый канал <img src=x onerror=alert(1)> עברית 日本語'}}]}));
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/revoke')return new Response('{}');
 if(u.origin!=='https://youtubeanalytics.googleapis.com'||u.pathname!=='/v2/reports')throw Error('Unexpected external request blocked by revenue fixture');
 const q=Object.fromEntries(u.searchParams);await fs.appendFile(control+'.calls',JSON.stringify(q)+'\n');
 const columnHeaders=[...(q.dimensions?[{name:q.dimensions}]:[]),...q.metrics.split(',').map(name=>({name}))];
 if(!q.metrics.includes('estimatedRevenue'))return new Response(JSON.stringify({columnHeaders,rows:q.dimensions?[]:[q.metrics.split(',').map(()=>0)]}));
 if(mode==='denied')return new Response(JSON.stringify({error:{message:'Тест: финансовый доступ недоступен'}}),{status:403});
 if(mode==='malformed')return new Response(JSON.stringify({columnHeaders:[],rows:[]}));
 const rows=mode==='empty'?undefined:mode==='zero'?[['2026-01-01',0,0,0]]:mode==='unknown'?[['2026-01-01',10,null,1],['2026-01-02',5,2,null]]:mode==='duplicate'?[['2026-01-01',1,1,1],['2026-01-01',1,1,1]]:[['2026-01-01',90,9,8],['2026-01-03',10,-1,-.5],['2026-01-04',0,0,0]];
 return new Response(JSON.stringify({columnHeaders,...(rows?{rows}:{})}));
};
