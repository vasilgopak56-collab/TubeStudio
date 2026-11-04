// Synthetic internal job driver, used ONLY by the local protocol test. No API creates these jobs.
import fs from 'node:fs';
import {runTask} from '../../../apps/server/dist/lib/taskContext.js';
import {startJob} from '../../../apps/server/dist/lib/jobs.js';
import {priceConsents} from '../../../apps/server/dist/services/priceConsent.js';
const root=process.env.TS_CONSENT_FIXTURE;let last='';
globalThis.fetch=async()=>{fs.appendFileSync(root+'/network.txt','blocked\n');throw Error('Real provider network forbidden');};
setInterval(()=>{try{if(!fs.existsSync(root+'/command.json'))return;const c=JSON.parse(fs.readFileSync(root+'/command.json','utf8'));if(c.command===last)return;last=c.command;const spec={contextHash:c.contextHash||'a'.repeat(64),tariffHash:'b'.repeat(64),tasks:[{provider:'fixture',model:'fixture/model',kind:'text'}]};const id=runTask({launch:{owner:c.owner,requestId:c.requestId,route:'/api/synthetic-protocol'}},()=>startJob(async ctx=>{
 fs.appendFileSync(root+'/steps.txt',c.command+':before\n');ctx.partial({syntheticCompleted:true});const permit=await priceConsents.request(spec);priceConsents.consume(permit,spec);fs.appendFileSync(root+'/steps.txt',c.command+':after\n');return{syntheticOnly:true};
 }));fs.writeFileSync(root+'/started.json',JSON.stringify({command:c.command,jobId:id}));}catch(e){fs.writeFileSync(root+'/driver-error.txt',e.message);}},10).unref();
