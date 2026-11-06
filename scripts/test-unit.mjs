// Every test file gets isolated data and prompts, and never inherits real keys.
// Processes are bounded so Windows can run the same suite without shared-store races.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'tubestudio-unit-'));
const baseEnv=Object.fromEntries(['PATH','HOME','SystemRoot','WINDIR','TEMP','TMP','FFMPEG_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
const files=(await fs.readdir(path.join(root,'apps/server/test'))).filter(f=>f.endsWith('.test.ts')).sort();
const results=new Array(files.length);let next=0;
async function execute(index){
 const file=files[index],base=path.join(tmp,String(index)),env={...baseEnv,DATA_DIR:path.join(base,'data'),ENV_FILE:path.join(base,'absent.env'),PROMPTS_DIR:path.join(base,'prompts')};
 await fs.mkdir(base,{recursive:true});await fs.cp(path.join(root,'apps/server/prompts'),env.PROMPTS_DIR,{recursive:true});
 const log=await fs.open(path.join(base,'test.log'),'w');let exit;
 try{const child=spawn(process.execPath,['--import','tsx','--test','--test-reporter=tap',`test/${file}`],{cwd:path.join(root,'apps/server'),env,stdio:['ignore',log.fd,log.fd]});exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});}finally{await log.close();}
 const text=await fs.readFile(path.join(base,'test.log'),'utf8');const number=key=>{const match=[...text.matchAll(new RegExp(`^# ${key} (\\d+)\\s*$`,'gm'))].at(-1);return match?Number(match[1]):0;};
 return {file,exit,tests:number('tests'),pass:number('pass'),fail:number('fail'),skipped:number('skipped'),cancelled:number('cancelled'),text};
}
try{
 const workers=Array.from({length:Math.min(4,files.length)},async()=>{for(;;){const index=next++;if(index>=files.length)return;try{results[index]=await execute(index);}catch(e){results[index]={file:files[index],exit:1,tests:0,pass:0,fail:1,skipped:0,cancelled:0,text:String(e)};}}});
 await Promise.all(workers);for(const r of results)if(r.exit!==0){console.error(`\nFAILED: ${r.file}\n${r.text}`);}
 const sum=k=>results.reduce((n,r)=>n+r[k],0);console.log(`Unit files: ${results.length}\n# tests ${sum('tests')}\n# pass ${sum('pass')}\n# fail ${sum('fail')}\n# skipped ${sum('skipped')}\n# cancelled ${sum('cancelled')}`);
 if(results.some(r=>r.exit!==0)||sum('fail')||sum('cancelled'))process.exitCode=1;
}finally{await fs.rm(tmp,{recursive:true,force:true});}
