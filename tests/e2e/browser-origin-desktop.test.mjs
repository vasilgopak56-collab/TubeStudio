// Isolated local server only; no real credentials or provider calls.
import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import http from 'node:http';import crypto from 'node:crypto';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function reserve(){const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function server(password=''){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-origin-'));const port=await reserve();const env=Object.fromEntries(['PATH','HOME','SystemRoot','WINDIR','TEMP','TMP'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));Object.assign(env,{DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',APP_PASSWORD:password,ENV_FILE:path.join(dir,'absent.env'),PROMPTS_DIR:path.join(root,'apps/server/prompts'),TS_NO_SCHEDULER:'1'});
 const child=spawn(process.execPath,[path.join(root,'apps/server/dist/index.js')],{cwd:path.join(root,'apps/server'),env,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',b=>err+=b);const end=new Promise(r=>child.once('exit',r));let ready=false;for(let i=0;i<140;i++){if(child.exitCode!==null)throw Error('server exited: '+err);try{if((await fetch(`http://127.0.0.1:${port}/api/auth/status`)).ok){ready=true;break}}catch{}await wait(50)}if(!ready){child.kill('SIGKILL');await end;await fs.rm(dir,{recursive:true,force:true});throw Error('server timeout: '+err)}
 return {dir,port,url:`http://127.0.0.1:${port}`,async close(){child.kill('SIGTERM');await Promise.race([end,wait(4000).then(()=>child.kill('SIGKILL'))]);await end;await fs.rm(dir,{recursive:true,force:true})}};
}
async function raw(port,requestPath,headers={}){return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,path:requestPath,headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))});req.on('error',reject);req.end()})}
test('server validates origins, Host, OAuth state and scoped extension token',async()=>{
 const s=await server('temporary-test-password');try{
  assert.equal(await raw(s.port,'/api/auth/status',{host:'attacker.example:'+s.port,origin:'http://attacker.example:'+s.port}),403);
  assert.equal(await raw(s.port,'http://attacker.example/api/auth/status',{host:'127.0.0.1:'+s.port}),403);
  assert.equal(await raw(s.port,'/api/auth/status',{host:'127.0.0.1:'+s.port,'sec-fetch-site':'cross-site'}),403);
  assert.equal(await raw(s.port,'/api/yt-oauth/callback',{host:'127.0.0.1:'+s.port,'sec-fetch-site':'cross-site'}),400); // invalid state, no provider call
  const token=crypto.createHash('sha256').update('tubestudio-ext:temporary-test-password').digest('hex').slice(0,32);const ext={origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop','sec-fetch-site':'cross-site','x-ts-token':token};
  assert.equal((await fetch(s.url+'/api/ext/ping',{headers:ext})).status,200);
  assert.equal((await fetch(s.url+'/api/ext/token',{headers:ext})).status,403);
  assert.equal((await fetch(s.url+'/api/ext/ping',{headers:{...ext,'x-ts-token':'bad'}})).status,401);
 }finally{await s.close()}
});
for(const password of ['', 'temporary-test-password']) test(`real browser form is blocked (${password?'with':'without'} password)`,{skip:!process.env.CHROMIUM_PATH},async()=>{
 const {chromium}=await import('playwright-core');const s=await server(password);let attacker,browser;try{
  attacker=http.createServer((req,res)=>{res.writeHead(200,{'content-type':'text/html'});if(req.url==='/blank'){res.end('attacker page');return;}res.end(`<form method="POST" action="${s.url}/api/system/cache/clear" enctype="text/plain"><input name="x" value="1"></form><script>document.forms[0].submit()</script>`)});await new Promise(r=>attacker.listen(0,'127.0.0.1',r));
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage();await page.goto(s.url+'/api/auth/status');if(password){const status=await page.evaluate(async p=>(await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:p})})).status,password);assert.equal(status,200);}
  await page.goto(`http://127.0.0.1:${attacker.address().port}/blank`);const getResponse=page.waitForResponse(r=>r.url()===s.url+'/api/auth/status');await page.evaluate(url=>fetch(url+'/api/auth/status',{mode:'no-cors'}),s.url);assert.equal((await getResponse).status(),403);
  await fs.mkdir(path.join(s.dir,'cache'),{recursive:true});const marker=path.join(s.dir,'cache','sentinel.json');await fs.writeFile(marker,'{}');const response=page.waitForResponse(r=>r.url().includes('/api/system/cache/clear'));await page.goto(`http://127.0.0.1:${attacker.address().port}/`);assert.equal((await response).status(),403);await fs.access(marker);
  await page.goto(s.url+'/api/auth/status');assert.equal(await page.evaluate(async()=>(await fetch('/api/system/cache/clear',{method:'POST'})).status),200);await assert.rejects(fs.access(marker));
 }finally{await browser?.close();if(attacker)await new Promise(r=>attacker.close(r));await s.close()}
});
