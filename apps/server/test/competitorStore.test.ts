import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-competitor-store-'));
process.env.DATA_DIR=dir;
const {loadCompetitorStore,saveCompetitorStore}=await import('../src/services/competitorStore.js');
const file=path.join(dir,'competitors.json');
after(()=>fs.rm(dir,{recursive:true,force:true}));
test('tracker store only absent file yields empty store; atomic save preserves extension fields',async()=>{
 assert.deepEqual(await loadCompetitorStore(),{channels:[],alerts:[]});await assert.rejects(fs.stat(file));
 await saveCompetitorStore({channels:[],alerts:[],extension:{literal:'<img src=x onerror=alert(1)> עברית 日本語'}} as any);
 const s=await loadCompetitorStore();assert.deepEqual((s as any).extension,{literal:'<img src=x onerror=alert(1)> עברית 日本語'});
 if(process.platform!=='win32')assert.equal((await fs.stat(file)).mode&0o777,0o600);
 assert.deepEqual((await fs.readdir(dir)).filter(n=>n.endsWith('.tmp')),[]);
});
test('tracker store broken JSON and wrong shape refuse without silently resetting bytes',async()=>{
 for(const raw of ['{','null','[]','{"channels":{},"alerts":[]}']){await fs.writeFile(file,raw);await assert.rejects(loadCompetitorStore(),(e:any)=>e.status===409);assert.equal(await fs.readFile(file,'utf8'),raw);}
});
test('tracker store refuses both valid and dangling symlinks, never writes through them',async()=>{
 const target=path.join(dir,'synthetic-private.json');await fs.writeFile(target,'SYNTHETIC_PRIVATE');await fs.unlink(file);
 for(const destination of [target,path.join(dir,'does-not-exist.json')]){await fs.symlink(destination,file);await assert.rejects(loadCompetitorStore(),(e:any)=>e.status===409);assert.ok((await fs.lstat(file)).isSymbolicLink());await fs.unlink(file);}
 assert.equal(await fs.readFile(target,'utf8'),'SYNTHETIC_PRIVATE');
});
test('tracker store oversize read and oversized write refuse before replacement',async()=>{
 const handle=await fs.open(file,'w');await handle.truncate(32*1024*1024+1);await handle.close();await assert.rejects(loadCompetitorStore(),(e:any)=>e.status===409);assert.equal((await fs.stat(file)).size,32*1024*1024+1);
 await fs.writeFile(file,'{"channels":[],"alerts":[]}');const before=await fs.readFile(file,'utf8');await assert.rejects(saveCompetitorStore({channels:[],alerts:[],large:'x'.repeat(32*1024*1024)} as any),(e:any)=>e.status===409);assert.equal(await fs.readFile(file,'utf8'),before);
});
