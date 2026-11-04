// Synthetic provider only. No real requests, credentials or network fallthrough.
import fs from 'node:fs/promises';
const control=process.env.TS_TEST_CHANNELS_CONTROL;
if(!control)throw Error('Synthetic channels fixture requires control file');
const scope='https://www.googleapis.com/auth/yt-analytics.readonly';
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode,channel='a'}=JSON.parse(await fs.readFile(control,'utf8'));
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/token')return new Response(JSON.stringify({access_token:'SYNTH_ACCESS_'+channel,refresh_token:'SYNTH_REFRESH_'+channel,expires_in:3600,scope}));
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels')return new Response(JSON.stringify({items:[{id:'UC'+channel.repeat(22),snippet:{title:'Тестовый канал <img src=x onerror=alert(1)> עברית 日本語'}}]}));
 if(u.origin==='https://oauth2.googleapis.com'&&u.pathname==='/revoke')return new Response('{}');
 if(u.origin!=='https://youtubeanalytics.googleapis.com'||u.pathname!=='/v2/reports')throw Error('Unexpected external request blocked by channels fixture');
 const q=Object.fromEntries(u.searchParams);await fs.appendFile(control+'.calls',JSON.stringify(q)+'\n');
 const columnHeaders=[...(q.dimensions?[{name:q.dimensions}]:[]),...q.metrics.split(',').map(name=>({name}))];
 if(q.metrics!=='views,estimatedMinutesWatched,subscribersGained,subscribersLost'||q.dimensions!=='day')return new Response(JSON.stringify({columnHeaders,rows:q.dimensions?[]:[q.metrics.split(',').map(()=>0)]}));
 if(mode==='slow')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='denied')return new Response(JSON.stringify({error:{message:'Тест: доступ недоступен'}}),{status:403});
 if(mode==='malformed')return new Response(JSON.stringify({columnHeaders:[],rows:[]}));
 const day=q.startDate,day3=new Date(Date.parse(day)+2*86400000).toISOString().slice(0,10);
 const rows=mode==='empty'?undefined:mode==='zero'?[[day,0,0,0,0]]:mode==='unknown'?[[day,10,null,1,null]]:mode==='duplicate'?[[day,1,1,1,1],[day,1,1,1,1]]:[[day,90,180,3,5],...(day3<=q.endDate?[[day3,10,20.5,1,0]]:[])];
 return new Response(JSON.stringify({columnHeaders,...(rows?{rows}:{})}));
};
