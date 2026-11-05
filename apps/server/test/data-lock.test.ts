import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {zipSync,strToU8,unzipSync} from 'fflate';
import {spawn} from 'node:child_process';
import {acquireDataLock,DATA_LOCK_NAME,staleLock,processImage} from '../src/lib/dataLock.js';
import {exportBackup,importBackup} from '../src/services/backup.js';
async function fixture(fn:(dir:string)=>Promise<void>){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-data-lock-'));try{await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});}}
test('lock: exclusive acquisition, release, and reacquisition',async()=>fixture(async d=>{const first=await acquireDataLock(d);await assert.rejects(acquireDataLock(d),/занята/);assert.deepEqual(await fs.readdir(path.join(d,DATA_LOCK_NAME)),['owner.json']);await first.release();await first.release();const second=await acquireDataLock(d);await second.release();}));
test('lock: simultaneous contenders have exactly one owner',async()=>fixture(async d=>{const results=await Promise.allSettled(Array.from({length:20},()=>acquireDataLock(d)));const winners=results.filter(x=>x.status==='fulfilled');assert.equal(winners.length,1);assert.equal(results.filter(x=>x.status==='rejected').length,19);await (winners[0] as PromiseFulfilledResult<Awaited<ReturnType<typeof acquireDataLock>>>).value.release();}));
test('lock: malformed or foreign marker never overwritten or removed',async()=>fixture(async d=>{const lock=path.join(d,DATA_LOCK_NAME);await fs.mkdir(lock);await fs.writeFile(path.join(lock,'owner.json'),'foreign');await assert.rejects(acquireDataLock(d),/занята/);assert.equal(await fs.readFile(path.join(lock,'owner.json'),'utf8'),'foreign');}));
test('lock: owner replacement or extra file makes release fail closed',async()=>fixture(async d=>{const lease=await acquireDataLock(d),lock=path.join(d,DATA_LOCK_NAME),owner=path.join(lock,'owner.json'),body=await fs.readFile(owner,'utf8');await fs.writeFile(owner,'changed');await assert.rejects(lease.release());assert.equal(await fs.readFile(owner,'utf8'),'changed');await fs.writeFile(owner,body);await fs.writeFile(path.join(lock,'unexpected'),'keep');await assert.rejects(lease.release());assert.equal(await fs.readFile(path.join(lock,'unexpected'),'utf8'),'keep');await fs.unlink(path.join(lock,'unexpected'));await lease.release();}));
test('lock: existing symlink or hardlink marker is not followed',async()=>fixture(async d=>{if(process.platform==='win32')return;const lease=await acquireDataLock(d),lock=path.join(d,DATA_LOCK_NAME),owner=path.join(lock,'owner.json'),outside=path.join(d,'outside');await fs.rename(owner,outside);await fs.symlink(outside,owner);await assert.rejects(lease.release());assert.ok((await fs.lstat(owner)).isSymbolicLink());await fs.unlink(owner);await fs.link(outside,owner);await assert.rejects(lease.release());assert.equal(await fs.readFile(owner,'utf8'),await fs.readFile(outside,'utf8'));}));
test('lock: hidden lock not exported or restored in ZIP backup',async()=>fixture(async d=>{const root=path.join(d,'data'),prompts=path.join(d,'prompts'),lease=await acquireDataLock(root);await fs.mkdir(prompts);await fs.writeFile(path.join(root,'settings.json'),'{}');const z=unzipSync(await exportBackup({dataDir:root,promptsDir:prompts}));assert.ok(!Object.keys(z).some(n=>n.includes(DATA_LOCK_NAME)));const imported=zipSync({'tubestudio-backup.json':strToU8('{"version":2}'),[DATA_LOCK_NAME+'/owner.json']:strToU8('malicious')});const result=await importBackup(imported,{dataDir:root,promptsDir:prompts});assert.equal(result.imported,0);assert.ok(result.skipped.includes(DATA_LOCK_NAME+'/owner.json'));await lease.release();}));

// After a power-off the number in owner.json may belong to another program (Windows reuses numbers quickly).
function liveProcess(node:boolean){
  const child=node?spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore',windowsHide:true})
    :process.platform==='win32'?spawn('ping.exe',['-n','60','127.0.0.1'],{stdio:'ignore',windowsHide:true}):spawn('sleep',['60'],{stdio:'ignore'});
  return child;
}
async function lockOwnedBy(d:string,pid:number){const lock=path.join(d,DATA_LOCK_NAME),owner=path.join(lock,'owner.json');await fs.mkdir(lock);await fs.writeFile(owner,JSON.stringify({schema:1,id:'x',pid,startedAt:new Date(Date.now()-3600_000).toISOString(),version:'1.1.0'})+'\n');return {lock,owner};}
test('lock: owner number now used by another program is stale; a live Node.js owner is not',async()=>fixture(async d=>{
  const other=liveProcess(false);
  try{
    const {lock,owner}=await lockOwnedBy(d,other.pid!);
    assert.equal(await staleLock(lock,owner,Date.now(),()=> 'chrome.exe'),true);
    assert.equal(await staleLock(lock,owner,Date.now(),()=> 'PING.EXE'),true);
    assert.equal(await staleLock(lock,owner,Date.now(),()=> 'node.exe'),false);
    assert.equal(await staleLock(lock,owner,Date.now(),()=> 'NODE'),false);
    assert.equal(await staleLock(lock,owner,Date.now(),()=> null),false,'unknown program: keep the lock');
    if(process.platform==='win32'){
      assert.match(processImage(other.pid!)??'',/^ping\.exe$/i);
      assert.equal(await staleLock(lock,owner),true);
      const lease=await acquireDataLock(d);
      assert.ok((await fs.readdir(d)).some(n=>n.startsWith(DATA_LOCK_NAME+'.stale-')));
      await lease.release();
    }
  } finally { other.kill(); }
}));
test('lock: live Node.js owner keeps the lock (no takeover)',async()=>fixture(async d=>{
  const node=liveProcess(true);
  try{
    const {lock,owner}=await lockOwnedBy(d,node.pid!);
    assert.equal(await staleLock(lock,owner),false);
    if(process.platform==='win32')assert.match(processImage(node.pid!)??'',/^node\.exe$/i);
    await assert.rejects(acquireDataLock(d),/занята/);
    assert.ok(!(await fs.readdir(d)).some(n=>n.startsWith(DATA_LOCK_NAME+'.stale-')));
  } finally { node.kill(); }
}));
test('lock: finished owner process is stale',async()=>fixture(async d=>{
  const gone=spawn(process.execPath,['-e','0'],{stdio:'ignore',windowsHide:true});
  await new Promise(r=>gone.once('exit',r));
  const {lock,owner}=await lockOwnedBy(d,gone.pid!);
  assert.equal(await staleLock(lock,owner),true);
  if(process.platform==='win32')assert.equal(processImage(gone.pid!),'');
}));
