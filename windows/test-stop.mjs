// Isolated acceptance harness. Never points the stop helper at the real installation.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {control,HELPER_VERSION} from './server-control.mjs';
const exec=promisify(execFile);
export const TEST_KIT_VERSION='2.1.0';
export const PREPARE_METHOD='node-server-control-cli';
const sourceRoot=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const safeError=code=>Object.assign(new Error(code),{safeCode:code});
export function childEnvironment(env=process.env){
 const keep=new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC','PATHEXT']);
 return Object.fromEntries(Object.keys(env).filter(key=>keep.has(key.toUpperCase())).map(key=>[key,env[key]]));
}
export const syntheticServer=`import net from 'node:net';
import fs from 'node:fs/promises';import path from 'node:path';import crypto from 'node:crypto';
const root=path.resolve(process.cwd(),'../..'),dir=path.join(root,'.tubestudio-control');
const token=crypto.randomBytes(32).toString('hex'),instance=crypto.randomUUID(),file=path.join(dir,instance+'.json');
const app=net.createServer(c=>c.end()),ctl=net.createServer(s=>{let body='';s.on('error',()=>{});s.on('data',b=>{body+=b;if(!body.includes('\\n'))return;if(body!=='STOP '+token+'\\n'){s.end('DENIED\\n');return;}app.close(()=>{ctl.close();fs.unlink(file).then(()=>s.end('STOPPED\\n',()=>process.exit(0))).catch(()=>process.exit(2));});});});
app.on('error',()=>process.exit(3));await new Promise(r=>app.listen({host:'127.0.0.1',port:0},r));await new Promise(r=>ctl.listen({host:'127.0.0.1',port:0},r));
await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,JSON.stringify({schema:1,instance,pid:process.pid,appPort:app.address().port,controlPort:ctl.address().port,token}));process.send?.({port:app.address().port});
process.on('disconnect',()=>{app.close();ctl.close();fs.unlink(file).finally(()=>process.exit(0));});
`;
export async function startSynthetic(root,{relative=false}={}){
 const cwd=path.join(root,'apps','server'),entry=path.join(cwd,'dist','index.js');
 const child=spawn(process.execPath,[relative?'dist/index.js':entry],{cwd,env:childEnvironment(),windowsHide:true,stdio:['ignore','ignore','ignore','ipc']});
 // Keep late child-process errors (for example denied cleanup) from escaping as raw OS output.
 child.on('error',()=>{});
 let exited=false;const closed=new Promise(resolve=>child.once('close',()=>{exited=true;resolve();}));
 const cleanup=async()=>{if(!exited){child.kill();await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(safeError('TEST_CHILD_CLEANUP_FAILED')),7000).unref())]);}};
 try{
  const port=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(safeError('TEST_CHILD_START_TIMEOUT')),10000);
   const finish=(error,value)=>{clearTimeout(timer);child.off('message',message);child.off('error',errorEvent);child.off('exit',exitEvent);error?reject(error):resolve(value);};
   const message=m=>{if(!m||!Number.isInteger(m.port)||m.port<1||m.port>65535)return finish(safeError('TEST_CHILD_INVALID_READY'));finish(null,m.port);};
   const errorEvent=()=>finish(safeError('TEST_CHILD_START_FAILED')),exitEvent=()=>finish(safeError('TEST_CHILD_EARLY_EXIT'));
   child.once('message',message);child.once('error',errorEvent);child.once('exit',exitEvent);
  });
  return {pid:child.pid,port,isRunning:()=>!exited&&child.exitCode===null&&child.signalCode===null,
   async waitStopped(){await Promise.race([closed,new Promise((_,reject)=>setTimeout(()=>reject(safeError('TEST_CHILD_DID_NOT_STOP')),7000).unref())]);},cleanup};
 }catch(e){try{await cleanup();}catch{throw safeError('TEST_CHILD_CLEANUP_FAILED');}throw e;}
}
async function unusedPort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0},resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function invokeHelper(root,{dryRun=false,port}){
 // Explicit synthetic port, never inherit a PORT pointing at a user's running app.
 return control(root,{dryRun,inheritedPort:String(port)});
}
export async function invokePrepare(root,{run=exec}={}){
 // Same pre-stop CLI as update-windows.bat. No PS1 file, policy override or shell.
 // Only runAcceptance's temporary installation is passed here.
 try{await run(process.execPath,[path.join(root,'windows','server-control.mjs')],{
  cwd:root,env:childEnvironment(),windowsHide:true,timeout:90000,maxBuffer:64*1024,encoding:'utf8'
 });}
 catch(error){
  const code=error?.killed?'PREPARE_UPDATE_TIMEOUT':
   error?.code==='ENOENT'?'PREPARE_UPDATE_NODE_UNAVAILABLE':
   error?.code==='EACCES'||error?.code==='EPERM'?'PREPARE_UPDATE_LAUNCH_BLOCKED':
   typeof error?.code==='number'?'PREPARE_UPDATE_STOP_NOT_CONFIRMED':'PREPARE_UPDATE_FAILED';
  throw safeError(code);
 }
}
function requireState(ok,code){if(!ok)throw safeError(code);}
async function writeReport(reportPath,report){
 const full=path.resolve(reportPath);
 const old=await fs.lstat(full).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(old&&(!old.isFile()||old.isSymbolicLink()))throw safeError('REPORT_DESTINATION_UNSAFE');
 const tmp=full+'.'+crypto.randomUUID()+'.tmp';
 try{await fs.writeFile(tmp,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});await fs.rename(tmp,full);}
 finally{await fs.rm(tmp,{force:true});}
}
export async function runAcceptance({platform=process.platform,reportPath=path.join(sourceRoot,'windows-stop-test-report.json'),start=startSynthetic,stop=invokeHelper,prepare=invokePrepare}={}){
 // Refuse before creating a sandbox, spawning a child, writing a report or invoking PowerShell.
 if(platform!=='win32')throw safeError('WINDOWS_ONLY');
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'TubeStudio-stop-test-'));
 const a=path.join(base,'TubeStudio Тест & (A)'),b=a+'-other';
 const children=[];let firstFailure=false,cleanupFailed=false;
 const report={testKitVersion:TEST_KIT_VERSION,helperVersion:HELPER_VERSION,prepareMethod:PREPARE_METHOD,startedAt:new Date().toISOString(),node:process.version,platform,
  scope:'Synthetic loopback Node children in temporary installations only; not real app/start BAT/shortcut/update installation/data restoration',
  nativeExecution:platform===process.platform&&process.platform==='win32'&&start===startSynthetic&&stop===invokeHelper&&prepare===invokePrepare,steps:[],cleanup:'pending',status:'running'};
 const snapshots=new Map();
 const checkFiles=async()=>{for(const [file,bytes] of snapshots)requireState((await fs.readFile(file)).equals(bytes),'SYNTHETIC_FILE_CHANGED');};
 const step=async(name,fn)=>{const before=Date.now();try{await fn();await checkFiles();report.steps.push({name,status:'passed',ms:Date.now()-before});}catch(e){firstFailure=true;report.steps.push({name,status:'failed',ms:Date.now()-before,code:/^[A-Z_]{1,80}$/.test(e?.safeCode||'')?e.safeCode:'CHECK_FAILED'});throw e;}};
 const boot=async(root,relative=false)=>{const s=await start(root,{relative});children.push(s);const envBytes=Buffer.from(`PORT=${s.port}\nSYNTHETIC_SENTINEL=unchanged\n`);await fs.writeFile(path.join(root,'.env'),envBytes);snapshots.set(path.join(root,'.env'),envBytes);return s;};
 try{
  for(const root of [a,b]){
   await fs.mkdir(path.join(root,'apps','server','dist'),{recursive:true});await fs.mkdir(path.join(root,'windows'));await fs.mkdir(path.join(root,'data'));
   await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');await fs.writeFile(path.join(root,'apps','server','dist','index.js'),syntheticServer);
   await fs.writeFile(path.join(root,'data','sentinel.json'),'{"synthetic":true,"unchanged":true}');
   for(const file of ['server-control.mjs'])await fs.copyFile(path.join(sourceRoot,'windows',file),path.join(root,'windows',file));
  }
  const helper=await fs.readFile(path.join(a,'windows','server-control.mjs'));
  report.helperSha256=crypto.createHash('sha256').update(helper).digest('hex');
  for(const root of [a,b])for(const name of ['data/sentinel.json','package.json','windows/server-control.mjs','apps/server/dist/index.js'])snapshots.set(path.join(root,name),await fs.readFile(path.join(root,name)));
  let s;
  await step('absolute_child_ready',async()=>{s=await boot(a);requireState(s.isRunning(),'TEST_CHILD_NOT_RUNNING');});
  await step('dry_run_preserves_own_child',async()=>{const r=await stop(a,{dryRun:true,port:s.port});requireState(r.status==='verified'&&r.pids.length===1&&r.pids[0]===s.pid&&s.isRunning(),'DRY_RUN_NOT_CONFIRMED');});
  await step('own_child_stopped_and_port_free',async()=>{const r=await stop(a,{port:s.port});requireState(r.status==='stopped'&&r.pids.length===1&&r.pids[0]===s.pid,'STOP_NOT_CONFIRMED');await s.waitStopped();});
  await step('already_free_is_non_destructive',async()=>{const r=await stop(a,{port:s.port});requireState(r.status==='already-free'&&r.pids.length===0,'FREE_PORT_NOT_CONFIRMED');});
  await step('sibling_installation_refused_and_alive',async()=>{const other=await boot(b);let refused=false;try{await stop(a,{port:other.port});}catch(e){refused=e?.message==='UNVERIFIED_OWNER';}requireState(refused&&other.isRunning(),'FOREIGN_OWNER_NOT_PROTECTED');const r=await stop(b,{dryRun:true,port:other.port});requireState(r.status==='verified'&&r.pids.length===1&&r.pids[0]===other.pid&&other.isRunning(),'FOREIGN_CHILD_NOT_ALIVE');await other.cleanup();});
  await step('legacy_relative_entry_refused_and_alive',async()=>{const legacy=await boot(a,true);let refused=false;try{await stop(a,{port:legacy.port});}catch(e){refused=e?.message==='UNVERIFIED_OWNER';}requireState(refused&&legacy.isRunning(),'LEGACY_OWNER_NOT_PROTECTED');await legacy.cleanup();});
  await step('prepare_update_pre_stop_only',async()=>{const ready=await boot(a);await prepare(a);await ready.waitStopped();requireState(!ready.isRunning(),'PREPARE_DID_NOT_STOP');});
  await step('different_port_keeps_own_child_alive',async()=>{const own=await boot(a),wrong=await unusedPort();let refused=false;try{await stop(a,{port:wrong});}catch(e){refused=e?.message==='OTHER_SERVER_RUNNING';}requireState(refused&&own.isRunning(),'OTHER_PORT_NOT_PROTECTED');const r=await stop(a,{port:own.port});requireState(r.status==='stopped','OWN_STOP_NOT_CONFIRMED');await own.waitStopped();});
  await step('different_port_legacy_relative_refused',async()=>{const legacy=await boot(a,true),wrong=await unusedPort();let refused=false;try{await stop(a,{port:wrong});}catch(e){refused=e?.message==='POSSIBLE_SERVER_RUNNING';}requireState(refused&&legacy.isRunning(),'RELATIVE_PORT_NOT_PROTECTED');await legacy.cleanup();});
  await step('second_instance_prevents_success',async()=>{const first=await boot(a),second=await boot(a);let refused=false;try{await stop(a,{port:first.port});}catch(e){refused=e?.message==='OTHER_SERVER_RUNNING';}requireState(refused&&first.isRunning()&&second.isRunning(),'SECOND_INSTANCE_NOT_PROTECTED');await second.cleanup();const r=await stop(a,{port:first.port});requireState(r.status==='stopped','FIRST_STOP_NOT_CONFIRMED');await first.waitStopped();});
  await step('synthetic_files_unchanged',checkFiles);
 }catch(e){firstFailure=true;if(e?.safeCode==='TEST_CHILD_CLEANUP_FAILED')cleanupFailed=true;report.failureCode=/^[A-Z_]{1,80}$/.test(e?.safeCode||'')?e.safeCode:'HARNESS_FAILED';}
 finally{
  for(const child of children)try{await child.cleanup();}catch{cleanupFailed=true;}
  if(!cleanupFailed)try{await fs.rm(base,{recursive:true,force:true});}catch{cleanupFailed=true;}
  report.cleanup=cleanupFailed?'failed; inspect TubeStudio-stop-test-* folder in TEMP; only test children were targeted':'passed';
  report.status=firstFailure||cleanupFailed?'failed':'passed';
  report.finishedAt=new Date().toISOString();
  // Fixed fields only: no command lines, usernames, paths, PID, .env, token or raw OS errors.
  await writeReport(reportPath,report);
 }
 return report;
}
export async function main(args=process.argv.slice(2)){
 if(args.length){console.error('Параметры не поддерживаются. Запустите test-stop-windows.bat.');return 2;}
 try{console.log('Только временные тестовые серверы. Рабочая установка TubeStudio не останавливается.');const r=await runAcceptance();for(const s of r.steps)console.log(`${s.status==='passed'?'PASS':'FAIL'} ${s.name}`);console.log('Отчёт: windows-stop-test-report.json');if(r.cleanup!=='passed')console.log('Очистка не завершена: проверьте временные папки TubeStudio-stop-test-* в %TEMP%.');return r.status==='passed'?0:1;}
 catch(e){console.error(e?.safeCode==='WINDOWS_ONLY'?'Эта проверка запускается только на Windows. Ничего не запущено и не остановлено.':'Проверка или сохранение отчёта не завершены. Не запускайте от администратора вслепую; проверьте комплект и доступность обычной папки.');return 2;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
