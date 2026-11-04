// Portable tests only: no native Windows stop, Google or installed application.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {invokePrepare,TEST_KIT_VERSION,PREPARE_METHOD} from '../../../windows/test-stop.mjs';
const root=new URL('../../../',import.meta.url);

test('Pre-update: BAT checks Node/helper then invokes exact CLI before npm; no prepare PS1',async()=>{
 const s=await fs.readFile(new URL('update-windows.bat',root),'utf8');
 const call='node "%~dp0windows\\server-control.mjs"';
 assert.ok(s.indexOf('where node')<s.indexOf(call));
 assert.ok(s.indexOf('if not exist "%~dp0windows\\server-control.mjs"')<s.indexOf(call));
 assert.ok(s.includes(call+'\r\nif errorlevel 1 goto :err'));
 assert.ok(s.indexOf(call)<s.indexOf('call npm install'));
 assert.ok(!s.includes('prepare-update.ps1'));
 assert.ok(!/(^|[^\r])\n/.test(s));
});
test('Pre-update: test kit executes Node without shell/PS1/policy and with sanitized environment',async()=>{
 const dir=path.join(os.tmpdir(),'Тест & (A)');let calls=0;
 await invokePrepare(dir,{run:async(executable:string,args:string[],options:any)=>{
  calls++;assert.equal(executable,process.execPath);
  assert.deepEqual(args,[path.join(dir,'windows','server-control.mjs')]);
  assert.equal(options.cwd,dir);assert.equal(options.shell,undefined);
  assert.equal(options.windowsHide,true);assert.equal(options.timeout,90000);
  for(const name of Object.keys(options.env))assert.ok(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP','USERPROFILE','COMSPEC','PATHEXT'].includes(name.toUpperCase()));
  for(const name of ['PORT','DATA_DIR','ENV_FILE','NODE_OPTIONS','NODE_PATH','YOUTUBE_API_KEY'])assert.equal(options.env[name],undefined);
  return {stdout:'synthetic',stderr:''};
 }});assert.equal(calls,1);
});
for(const [input,expected] of [
 [{code:1},'PREPARE_UPDATE_STOP_NOT_CONFIRMED'],
 [{code:'ENOENT'},'PREPARE_UPDATE_NODE_UNAVAILABLE'],
 [{code:'EACCES'},'PREPARE_UPDATE_LAUNCH_BLOCKED'],
 [{code:'EPERM'},'PREPARE_UPDATE_LAUNCH_BLOCKED'],
 [{killed:true,code:1},'PREPARE_UPDATE_TIMEOUT'],
 [{code:'UNEXPECTED'},'PREPARE_UPDATE_FAILED'],
] as const)test(`Pre-update: safe failure ${expected} (${JSON.stringify(input)})`,async()=>{
 await assert.rejects(invokePrepare('synthetic',{run:async()=>{throw Object.assign(new Error('PRIVATE_TOKEN PRIVATE_PATH'),input,{stdout:'PRIVATE_OUTPUT',stderr:'PRIVATE_ERROR'});}}),
 (error:any)=>{assert.equal(error.safeCode,expected);assert.equal(error.message,expected);assert.equal(error.stderr,undefined);assert.equal(error.stdout,undefined);return true;});
});
test('Pre-update: Linux CLI refuses without reading .env, creating a report or modifying data',{skip:process.platform==='win32'},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ts-pre-stop-cli-'));
 try{
  await fs.mkdir(path.join(dir,'windows'));
  await fs.copyFile(new URL('windows/server-control.mjs',root),path.join(dir,'windows','server-control.mjs'));
  await fs.writeFile(path.join(dir,'.env'),'PORT=invalid\nPRIVATE_SENTINEL=unchanged\n');
  const before=await fs.readFile(path.join(dir,'.env'));
  await assert.rejects(invokePrepare(dir),/PREPARE_UPDATE_STOP_NOT_CONFIRMED/);
  assert.deepEqual(await fs.readFile(path.join(dir,'.env')),before);
  assert.deepEqual((await fs.readdir(dir)).sort(),['.env','windows']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Pre-update: kit reports new version and explicit method; no PS1 fixture dependency',async()=>{
 assert.equal(TEST_KIT_VERSION,'2.1.0');assert.equal(PREPARE_METHOD,'node-server-control-cli');
 const bat=await fs.readFile(new URL('test-stop-windows.bat',root),'utf8');
 assert.ok(!bat.includes('prepare-update.ps1'));assert.ok(!bat.includes('ExecutionPolicy'));
 const source=await fs.readFile(new URL('windows/test-stop.mjs',root),'utf8');
 assert.ok(!source.includes('prepare-update.ps1'));assert.ok(source.includes('prepareMethod:PREPARE_METHOD'));
});
