// Real local API and UI; no provider calls and no user data.
import {test,before,after} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {chromium} from 'playwright-core';
const root=process.cwd(),base='http://127.0.0.1:8897';let dir,server,browser;
before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-project-ui-'));server=spawn(process.execPath,['dist/index.js'],{cwd:root+'/apps/server',env:{PATH:process.env.PATH,HOST:'127.0.0.1',PORT:'8897',DATA_DIR:dir,ENV_FILE:dir+'/absent.env',PROMPTS_DIR:root+'/apps/server/prompts',TS_NO_SCHEDULER:'1'},stdio:'ignore'});for(let i=0;i<120;i++){try{if((await fetch(base+'/api/auth/status')).ok)break;}catch{}if(i===119)throw Error('server not ready');await new Promise(r=>setTimeout(r,100));}browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/local/bin/chromium',args:['--no-sandbox']});});
after(async()=>{await browser?.close();server?.kill();fs.rmSync(dir,{recursive:true,force:true});});
test('broken project warning replaces empty list on dashboard and projects, preserves files, recovery works',async()=>{
 const created=await fetch(base+'/api/projects',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'Исправный проект'})});const p=(await created.json()).data;const brokenId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',file=path.join(dir,'projects',brokenId+'.json');fs.writeFileSync(file,'{broken');
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const external=[];await page.route('**/*',r=>{if(new URL(r.request().url()).origin!==base){external.push(r.request().url());return r.abort();}return r.continue();});
 await page.goto(base+'/');await page.getByText(/содержит некорректный JSON/).waitFor();assert.equal(await page.getByText('Проектов пока нет',{exact:true}).count(),0);
 await page.goto(base+'/projects');await page.getByText(/содержит некорректный JSON/).waitFor();assert.equal(await page.getByText('Проектов пока нет',{exact:true}).count(),0);assert.equal(fs.readFileSync(file,'utf8'),'{broken');
 await page.goto(base+'/voice');await page.getByText('Список проектов недоступен.',{exact:true}).waitFor();
 fs.unlinkSync(file);await page.goto(base+'/projects');await page.getByText('Исправный проект',{exact:true}).waitFor();assert.equal((await (await fetch(base+'/api/projects/'+p.id)).json()).data.title,'Исправный проект');assert.deepEqual(external,[]);await page.close();
});
