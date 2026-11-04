// Real authenticated browser download/upload between isolated temporary servers.
// No inherited keys/data/.env; provider fetch is forbidden. Fault injection is explicit.
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import net from 'node:net';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import crypto from 'node:crypto';
import {chromium} from 'playwright-core';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)),require=createRequire(ROOT+'/package.json');
const {unzipSync,zipSync,strToU8}=require('fflate');
const VERSION=JSON.parse(fs.readFileSync(ROOT+'/package.json')).version;
const OUT=process.env.TEST_ARTIFACTS_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'ts-backup-ui-report-'));
const CHROME=process.env.CHROME_PATH||['/usr/local/bin/chromium','/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>fs.existsSync(p));
let root,browser,source,target,project,profit,archive,guard,blocked,faultControl;
const SCRIPT='Сохранённый сценарий שלום 日本語 <script>window.backupInjected=1</script>';
const TITLE='Проект для переноса — עברית 日本語';
const PASSWORD='synthetic-backup-ui-only',INPUT='input[type="file"][accept=".zip,application/zip"]';
const put=(p,b)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);};
async function port(){const s=net.createServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const n=s.address().port;await new Promise(r=>s.close(r));return n;}
async function start(s){
 s.proc=spawn(process.execPath,['--import',guard,'--import',ROOT+'/tests/e2e/fixtures/backup-faults.mjs','dist/index.js'],{cwd:ROOT+'/apps/server',env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:String(s.port),DATA_DIR:s.data,PROMPTS_DIR:s.prompts,ENV_FILE:s.env,APP_PASSWORD:PASSWORD,TEST_FETCH_LOG:blocked,TEST_BACKUP_FAULT_CONTROL:faultControl},stdio:['ignore','ignore','pipe']});
 s.stderr='';s.proc.stderr.on('data',b=>s.stderr+=b);
 let ready=false;for(let i=0;i<80;i++){if(s.proc.exitCode!==null)throw new Error('server exited: '+s.stderr);try{if((await fetch(s.url+'/api/auth/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,150));}assert.ok(ready,'server ready');
 const login=await fetch(s.url+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:PASSWORD})});assert.equal(login.status,200);s.cookie=login.headers.get('set-cookie').split(';')[0];
}
async function stop(s){if(!s?.proc||s.proc.exitCode!==null)return;await new Promise(resolve=>{const t=setTimeout(()=>s.proc.kill('SIGKILL'),5000);s.proc.once('exit',()=>{clearTimeout(t);resolve();});s.proc.kill('SIGTERM');});}
async function api(s,p,method='GET',data){const r=await fetch(s.url+'/api'+p,{method,headers:{Cookie:s.cookie,...(data===undefined?{}:{'content-type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});assert.equal(r.status,200,p);const j=await r.json();assert.ok(j.ok,p);return j.data;}
function snapshot(){const out={};for(const [prefix,dir] of [['data',target.data],['prompts',target.prompts]]){function walk(d,rel=''){for(const e of fs.readdirSync(d,{withFileTypes:true})){const n=rel?rel+'/'+e.name:e.name;if(n==='logs'||n.startsWith('logs/'))continue;if(e.isDirectory())walk(path.join(d,e.name),n);else if(e.isFile())out[prefix+'/'+n]=crypto.createHash('sha256').update(fs.readFileSync(path.join(d,e.name))).digest('hex');}}walk(dir);}out.env=fs.readFileSync(target.env,'utf8');return out;}
async function page(s=target,width=390){
 const ctx=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});await ctx.request.post(s.url+'/api/auth/login',{data:{password:PASSWORD}});
 const p=await ctx.newPage();p.errors=[];p.external=[];p.imports=0;p.on('pageerror',e=>p.errors.push(e.message));p.on('request',r=>{if(r.url()===s.url+'/api/data/import')p.imports++;});
 await p.route('**/*',r=>{const u=new URL(r.request().url());if(u.origin!==s.url){p.external.push(u.origin);return r.abort();}
 // Only unrelated diagnostic/catalog calls are mocked. Transfer routes are real unless a fault test overrides them.
 if(u.pathname==='/api/health')return r.fulfill({json:{ok:true,data:{version:VERSION,keys:[],node:'test',dataDir:'isolated',llm:null}}});
 if(u.pathname==='/api/anymodel/models')return r.fulfill({json:{ok:true,data:{models:[]}}});
 return r.continue();});
 await p.goto(s.url+'/settings');await p.getByRole('link',{name:'Экспорт всех данных',exact:true}).waitFor();return p;
}
async function upload(p,buffer,accept=true,name='synthetic-backup.zip'){
 let dialogText;const handled=new Promise((resolve,reject)=>p.once('dialog',async d=>{try{dialogText=d.message();assert.match(dialogText,/перезапишет совпадающие файлы/);assert.match(dialogText,/перезапустите TubeStudio/);await (accept?d.accept():d.dismiss());resolve();}catch(e){reject(e);}}));
 await p.locator(INPUT).setInputFiles({name,mimeType:'application/zip',buffer});await handled;return dialogText;
}
async function capture(p,name){const anchor=p.getByRole('link',{name:'Экспорт всех данных',exact:true});if(await anchor.count())await anchor.scrollIntoViewIfNeeded();else await p.getByTestId('profit-result').scrollIntoViewIfNeeded();await p.waitForTimeout(80);await p.screenshot({path:path.join(OUT,name+'.png')});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'no horizontal overflow');assert.deepEqual(p.errors,[]);assert.deepEqual(p.external,[]);}
const result=p=>p.getByText(/^Импортировано файлов:/);
before(async()=>{
 assert.ok(CHROME,'Set CHROME_PATH');fs.mkdirSync(OUT,{recursive:true});root=fs.mkdtempSync(path.join(os.tmpdir(),'TubeStudio UI перенос '));faultControl=path.join(root,'fault-control.json');put(faultControl,'{}');guard=path.join(root,'no-provider.mjs');blocked=path.join(root,'fetch-attempts.txt');put(guard,"import fs from 'node:fs';globalThis.fetch=async()=>{fs.appendFileSync(process.env.TEST_FETCH_LOG,'blocked\\n');throw new Error('Provider fetch forbidden');};");
 for(const name of ['source','target']){const s={port:await port(),data:path.join(root,name,'данные'),prompts:path.join(root,name,'промпты'),env:path.join(root,name,'.env')};s.url='http://127.0.0.1:'+s.port;fs.mkdirSync(s.data,{recursive:true});fs.mkdirSync(s.prompts,{recursive:true});put(s.env,'SYNTHETIC_ENV_SENTINEL='+name+'\n');if(name==='source')source=s;else target=s;await start(s);}
 project=await api(source,'/projects','POST',{title:TITLE});await api(source,'/projects/'+project.id+'/artifacts','POST',{kind:'script',title:'Сценарий для переноса',data:{script:SCRIPT}});project=await api(source,'/projects/'+project.id);
 profit=await api(source,'/profit/calculate','POST',{mode:'manual',startDate:'2026-01-01',endDate:'2026-01-28',views:100000,rpm:2.5,otherCosts:40,aiCosts:10,title:'Расчёт для переноса — 200 USD'});
 put(path.join(source.data,'files',project.id,'bytes.bin'),Buffer.from([0,255,128,13,10,42]));put(path.join(source.prompts,'coach/chat.md'),'Синтетический промпт {{language}} {{context}}.');put(path.join(source.data,'oauth-connections','excluded.json'),'synthetic-only');
 await api(target,'/projects','POST',{title:'Только в целевой установке'});put(path.join(target.prompts,'target-only.md'),'Target-only synthetic prompt.');
 archive=Buffer.from(await (await fetch(source.url+'/api/data/export',{headers:{Cookie:source.cookie}})).arrayBuffer());
 browser=await chromium.launch({executablePath:CHROME,args:['--no-sandbox']});
});
after(async()=>{await browser?.close();await stop(source);await stop(target);const attempts=blocked&&fs.existsSync(blocked)?fs.readFileSync(blocked,'utf8'):'';fs.writeFileSync(path.join(OUT,'network.json'),JSON.stringify({serverProviderFetchAttempts:attempts.trim()?attempts.trim().split('\n').length:0,environment:'isolated synthetic Linux browser/API test'},null,2));if(root)fs.rmSync(root,{recursive:true,force:true});assert.equal(attempts,'','no provider fetch attempted');});
for(const width of [1440,390])test(`Backup UI ${width}: real download → confirmed import → restart → visible project/history`,{timeout:45000},async()=>{
 const p=await page(source,width);const pending=p.waitForEvent('download');await p.getByRole('link',{name:'Экспорт всех данных',exact:true}).click();const download=await pending;assert.match(download.suggestedFilename(),/^tubestudio-data-\d{4}-\d{2}-\d{2}\.zip$/);const dest=path.join(OUT,'synthetic-download-'+width+'.zip');await download.saveAs(dest);assert.equal(await download.failure(),null);const bytes=fs.readFileSync(dest),entries=unzipSync(bytes);assert.ok(entries['projects/'+project.id+'.json']);assert.ok(!entries['.env']);assert.ok(!entries['oauth-connections/excluded.json']);await p.context().close();
 const q=await page(target,width),env=fs.readFileSync(target.env);await upload(q,bytes);await result(q).waitFor();assert.match(await result(q).innerText(),/Перезапустите TubeStudio/);assert.match(await result(q).innerText(),/не включено объектов: 1/);assert.match(await result(q).getAttribute('class'),/text-accent/);await capture(q,'backup-import-warning-'+width);
 for(const [name,data] of Object.entries(entries)){if(name==='tubestudio-backup.json')continue;const full=name.startsWith('backup-prompts/')?path.join(target.prompts,name.slice(15)):path.join(target.data,name);assert.deepEqual(new Uint8Array(fs.readFileSync(full)),data,name);}assert.deepEqual(fs.readFileSync(target.env),env);assert.equal(fs.readFileSync(path.join(target.prompts,'target-only.md'),'utf8'),'Target-only synthetic prompt.');
 await stop(target);await start(target);await q.reload();await q.getByRole('link',{name:'Экспорт всех данных',exact:true}).waitFor();await q.goto(target.url+'/projects');await q.getByRole('link').filter({hasText:TITLE}).click();await q.getByText(SCRIPT,{exact:true}).waitFor();assert.equal(await q.evaluate(()=>window.backupInjected),undefined);
 await q.goto(target.url+'/profit');await q.getByRole('button').filter({hasText:profit.title}).click();await q.getByTestId('profit-result').waitFor();assert.match(await q.getByTestId('profit-net').innerText(),/200/);assert.deepEqual(await api(target,'/profit/runs/'+profit.id),profit);await capture(q,'backup-restored-profit-'+width);assert.deepEqual(q.errors,[]);await q.context().close();
});
test('Backup UI: cancel confirmation sends nothing; same file can be selected again',{timeout:30000},async()=>{
 const p=await page(),before=snapshot();await upload(p,archive,false);await p.waitForTimeout(150);assert.equal(p.imports,0);assert.deepEqual(snapshot(),before);assert.equal(await result(p).count(),0);
 await upload(p,archive);await result(p).waitFor();assert.equal(p.imports,1);assert.equal(await p.locator(INPUT).inputValue(),'');await p.context().close();
});
test('Backup UI: invalid ZIP error preserves target; selecting same file retries',{timeout:30000},async()=>{
 const p=await page(),before=snapshot(),bad=Buffer.from('not a valid zip archive with enough bytes');for(let n=0;n<2;n++){await upload(p,bad,true,'invalid.zip');await p.getByText(/Это не ZIP-архив или он повреждён/).waitFor();assert.deepEqual(snapshot(),before);}assert.equal(p.imports,2);await capture(p,'backup-invalid-390');await p.context().close();
});
test('Backup UI: real skipped long filename stays readable on mobile',{timeout:30000},async()=>{
 const p=await page(),before=snapshot(),name='unknown/'+('x'.repeat(180))+'.json';const bytes=zipSync({'tubestudio-backup.json':strToU8('{"version":2}'),[name]:strToU8('{}')});await upload(p,Buffer.from(bytes));await result(p).waitFor();assert.match(await result(p).innerText(),/Импортировано файлов: 0/);assert.match(await result(p).innerText(),/Пропущено: 1/);assert.ok((await result(p).innerText()).includes(name));assert.match(await result(p).getAttribute('class'),/text-accent/);assert.deepEqual(snapshot(),before);await capture(p,'backup-skipped-long-390');await p.context().close();
});
test('Backup UI: busy state blocks another chooser; one pending POST',{timeout:30000},async()=>{
 const p=await page();let release,seen;const arrived=new Promise(r=>seen=r),gate=new Promise(r=>release=r);await p.route('**/api/data/import',async r=>{seen();await gate;await r.continue();});
 try{await upload(p,archive);await arrived;await p.getByText('Импортируем…',{exact:true}).waitFor();assert.match(await p.locator(INPUT).locator('..').getAttribute('class'),/pointer-events-none/);assert.equal(p.imports,1);await capture(p,'backup-busy-390');}finally{release();}
 await result(p).waitFor();await p.getByText('Импорт из ZIP',{exact:true}).waitFor();assert.equal(p.imports,1);await p.context().close();
});
test('Backup UI: network failure is explicit and retry succeeds (injected transport failure)',{timeout:30000},async()=>{
 const p=await page(),before=snapshot();let fail=true;await p.route('**/api/data/import',r=>fail?r.abort('failed'):r.continue());await upload(p,archive);await p.getByText('Не удалось загрузить архив',{exact:true}).waitFor();assert.deepEqual(snapshot(),before);await capture(p,'backup-network-error-390');fail=false;await upload(p,archive);await result(p).waitFor();assert.equal(p.imports,2);await p.context().close();
});
test('Backup UI: legacy v1 import warning is not a complete-success state',{timeout:30000},async()=>{
 const p=await page(),before=snapshot();await upload(p,Buffer.from(zipSync({'tubestudio-backup.json':strToU8('{"version":1}')})));await result(p).waitFor();assert.match(await result(p).innerText(),/Старая копия v1/);assert.match(await result(p).getAttribute('class'),/text-accent/);assert.deepEqual(snapshot(),before);await capture(p,'backup-legacy-390');await p.context().close();
});
test('Backup UI: successful v2 import without omissions shows count and restart reminder',{timeout:30000},async()=>{
 const p=await page();const content=Buffer.from('Synthetic success bytes שלום 日本語\0'),name='files/qa-ui-success/bytes.bin';const bytes=zipSync({'tubestudio-backup.json':strToU8('{"version":2,"skipped":[]}'),[name]:content});await upload(p,Buffer.from(bytes));await result(p).waitFor();assert.match(await result(p).innerText(),/Импортировано файлов: 1/);assert.match(await result(p).innerText(),/Перезапустите TubeStudio и проверьте данные/);assert.doesNotMatch(await result(p).innerText(),/Пропущено/);assert.match(await result(p).getAttribute('class'),/text-emerald-400/);assert.deepEqual(fs.readFileSync(path.join(target.data,name)),content);await capture(p,'backup-success-390');await p.context().close();
});
for(const width of [1440,390])test(`Backup UI ${width}: actual ENOSPC before commit is redacted, preserves bytes and retry works`,{timeout:30000},async()=>{
 const p=await page(target,width),before=snapshot(),name=`files/failure-qa-${width}/first.bin`,bytes=Buffer.from(zipSync({'tubestudio-backup.json':strToU8('{"version":2}'),[name]:strToU8('RETRY_BYTES')}));
 try{put(faultControl,JSON.stringify({id:crypto.randomUUID(),operation:'writeFile',failAt:1,partial:true}));const response=p.waitForResponse(r=>r.url().endsWith('/api/data/import'));await upload(p,bytes);assert.equal((await response).status(),500);await p.getByText(/Восстановление прервано после 0 файлов/).waitFor();assert.match(await p.locator('body').innerText(),/Ни один файл из архива не установлен/);assert.deepEqual(snapshot(),before);assert.ok(!(await p.locator('body').innerText()).includes('PRIVATE_'));assert.equal(await result(p).count(),0);await capture(p,'backup-disk-full-'+width);
 put(faultControl,'{}');await upload(p,bytes);await result(p).waitFor();assert.match(await result(p).innerText(),/Импортировано файлов: 1/);assert.equal(fs.readFileSync(path.join(target.data,name),'utf8'),'RETRY_BYTES');assert.equal(p.imports,2);
 }finally{put(faultControl,'{}');await p.context().close();}
});
for(const width of [1440,390])test(`Backup UI ${width}: later rename denial reports one committed file without claiming rollback`,{timeout:30000},async()=>{
 const p=await page(target,width),first=`files/partial-qa-${width}/first.bin`,second=`files/partial-qa-${width}/second.bin`,bytes=Buffer.from(zipSync({'tubestudio-backup.json':strToU8('{"version":2}'),[first]:strToU8('FIRST_NEW'),[second]:strToU8('SECOND_NEW')}));put(path.join(target.data,first),'FIRST_OLD');put(path.join(target.data,second),'SECOND_OLD');const env=fs.readFileSync(target.env);
 try{put(faultControl,JSON.stringify({id:crypto.randomUUID(),operation:'rename',failAt:2}));const response=p.waitForResponse(r=>r.url().endsWith('/api/data/import'));await upload(p,bytes);assert.equal((await response).status(),500);await p.getByText(/Восстановление прервано после 1 файлов/).waitFor();assert.match(await p.locator('body').innerText(),/Часть файлов уже обновлена/);assert.ok(!(await p.locator('body').innerText()).includes('PRIVATE_'));assert.equal(await result(p).count(),0);assert.equal(fs.readFileSync(path.join(target.data,first),'utf8'),'FIRST_NEW');assert.equal(fs.readFileSync(path.join(target.data,second),'utf8'),'SECOND_OLD');assert.deepEqual(fs.readFileSync(target.env),env);assert.ok(Object.keys(snapshot()).every(n=>!n.endsWith('.tmp')));assert.equal(p.imports,1);await capture(p,'backup-partial-'+width);
 }finally{put(faultControl,'{}');await p.context().close();}
});
