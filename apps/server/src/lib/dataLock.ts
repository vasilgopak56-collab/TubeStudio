/** One cooperating TubeStudio server per data directory. A lock is taken over only when its owner process is gone. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { APP_VERSION } from './version.js';

export const DATA_LOCK_NAME = '.tubestudio-server.lock';
const ownerName = 'owner.json';
const refuse = () => new Error('Папка данных уже занята или осталась блокировка после остановки. Вторая копия не запущена. Не удаляйте блокировку, пока работает хотя бы одна копия TubeStudio или её дочерние процессы. См. RELEASE-v0.12.148-preview.1.md.');

function numberInUse(pid:number):boolean{
  try { process.kill(pid,0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code==='EPERM'; }
}
/** Program that now has this process number: '' = no such process, null = unknown (not Windows or no answer).
 *  Windows hands numbers out again quickly: after a reboot the number in an old lock often belongs to another program. */
export function processImage(pid:number):string|null{
  if (process.platform!=='win32') return null;
  try {
    const r=spawnSync(path.join(process.env.SystemRoot||process.env.windir||'C:\\Windows','System32','tasklist.exe'),['/FI',`PID eq ${pid}`,'/FO','CSV','/NH'],{windowsHide:true,encoding:'latin1',timeout:15_000});
    if (!r.error&&r.status===0) for (const line of String(r.stdout??'').split(/\r?\n/)) {
      const m=/^"([^"]*)","(\d+)"/.exec(line.trim());
      if (m&&Number(m[2])===pid) return m[1];
    }
  } catch { /* unknown */ }
  // Not listed: gone only if the number is really free now; otherwise unknown.
  return numberInUse(pid)?null:'';
}
/** True only when the recorded owner process is gone (or the marker is old and unreadable). */
export async function staleLock(dir:string,owner:string,now=Date.now(),image:(pid:number)=>string|null=processImage):Promise<boolean>{
  let pid:number|undefined;
  try { const o=JSON.parse(await fs.readFile(owner,'utf8')); if(Number.isInteger(o?.pid)&&o.pid>0)pid=o.pid; } catch { /* unreadable marker */ }
  if (pid===undefined) {
    try { return now-(await fs.stat(dir)).mtimeMs>2*60_000; } catch { return false; }
  }
  if (pid===process.pid) return false;
  try { process.kill(pid,0); }
  catch (e) { const code=(e as NodeJS.ErrnoException).code; if (code==='ESRCH') return true; if (code!=='EPERM') return false; }
  // The number is in use. The owner was a Node.js process; any other program has merely reused the number.
  const name=image(pid);
  return name!==null&&!/^node(\.exe)?$/i.test(name);
}

export async function acquireDataLock(dataDir: string) {
  const root=path.resolve(dataDir),dir=path.join(root,DATA_LOCK_NAME),owner=path.join(dir,ownerName);
  await fs.mkdir(root,{recursive:true});
  try { await fs.mkdir(dir,{mode:0o700}); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code!=='EEXIST') throw e;
    // A lock whose owner process no longer exists is left over from a crash or power loss.
    if (!(await staleLock(dir,owner))) throw refuse();
    await fs.rename(dir,`${dir}.stale-${Date.now()}`);
    try { await fs.mkdir(dir,{mode:0o700}); } catch { throw refuse(); }
  }
  // A failed or interrupted creation intentionally leaves a marker: no automatic takeover.
  const body=JSON.stringify({schema:1,id:crypto.randomUUID(),pid:process.pid,startedAt:new Date().toISOString(),version:APP_VERSION})+'\n';
  const h=await fs.open(owner,'wx',0o600);
  try { await h.writeFile(body); await h.sync(); } finally { await h.close(); }
  let released=false;
  return {
    async release() {
      if(released) return;
      // Only delete our exact regular marker; unexpected extra content remains untouched.
      const st=await fs.lstat(dir);if(st.isSymbolicLink()||!st.isDirectory()) throw refuse();
      const entries=await fs.readdir(dir);if(entries.length!==1||entries[0]!==ownerName)throw refuse();
      const ost=await fs.lstat(owner);if(ost.isSymbolicLink()||!ost.isFile()||ost.nlink!==1)throw refuse();
      const file=await fs.open(owner,constants.O_RDONLY|(process.platform==='win32'?0:(constants.O_NOFOLLOW||0)));
      try { const s=await file.stat();if(!s.isFile()||s.nlink!==1||s.size>4096||await file.readFile('utf8')!==body)throw refuse(); }
      finally { await file.close(); }
      await fs.unlink(owner);await fs.rmdir(dir);released=true;
    }
  };
}
