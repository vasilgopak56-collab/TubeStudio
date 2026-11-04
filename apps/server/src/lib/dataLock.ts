/** One cooperating TubeStudio server per data directory. Never steal or time out a lock. */
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { APP_VERSION } from './version.js';

export const DATA_LOCK_NAME = '.tubestudio-server.lock';
const ownerName = 'owner.json';
const refuse = () => new Error('Папка данных уже занята или осталась блокировка после остановки. Вторая копия не запущена. Не удаляйте блокировку, пока работает хотя бы одна копия TubeStudio или её дочерние процессы. См. RELEASE-v0.12.148-preview.1.md.');

export async function acquireDataLock(dataDir: string) {
  const root=path.resolve(dataDir),dir=path.join(root,DATA_LOCK_NAME),owner=path.join(dir,ownerName);
  await fs.mkdir(root,{recursive:true});
  try { await fs.mkdir(dir,{mode:0o700}); }
  catch (e) { if ((e as NodeJS.ErrnoException).code==='EEXIST') throw refuse(); throw e; }
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
