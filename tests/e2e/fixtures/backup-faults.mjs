// Explicit synthetic filesystem faults for backup UI tests only. Never imported by normal start.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
const control=process.env.TEST_BACKUP_FAULT_CONTROL;
if(!control)throw Error('Explicit backup fault control required');
const roots=[process.env.DATA_DIR,process.env.PROMPTS_DIR].map(r=>path.resolve(r)+path.sep);
let lastId,attempt=0;
for(const op of ['writeFile','rename']){
 const original=fsp[op];
 fsp[op]=async function(...args){
  const full=typeof args[0]==='string'?path.resolve(args[0]):'';
  if(full.endsWith('.tmp')&&roots.some(r=>full.startsWith(r))){
   const cfg=JSON.parse(fs.readFileSync(control,'utf8'));
   if(cfg.id!==lastId){lastId=cfg.id;attempt=0;}
   if(cfg.operation===op&&++attempt===cfg.failAt){
    if(op==='writeFile'&&cfg.partial)await original.call(fsp,args[0],'SYNTHETIC_PARTIAL_BYTES',{flag:'wx',mode:0o600});
    throw Object.assign(Error('PRIVATE_OS_MESSAGE /PRIVATE_TARGET_PATH'),{code:op==='writeFile'?'ENOSPC':'EACCES'});
   }
  }
  return original.apply(fsp,args);
 };
}
