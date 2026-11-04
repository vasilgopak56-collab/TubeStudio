// Test-only preload: pauses one local read. No network, credentials or application-data changes.
import fs from 'node:fs/promises';import path from 'node:path';
const original=fs.readFile.bind(fs),dir=process.env.DATA_DIR;let sequence=0;
fs.readFile=async function(file,...args){
 if(path.resolve(String(file))===path.join(dir,'voice-profile.json')){
  const own=++sequence;await fs.writeFile(path.join(dir,'test-handler-started'),'yes');await fs.writeFile(path.join(dir,'test-handler-started-'+own),'yes');
  const until=Date.now()+20000;
  while(Date.now()<until){try{await Promise.any([fs.access(path.join(dir,'test-handler-release')),fs.access(path.join(dir,'test-handler-release-'+own))]);break;}catch{await new Promise(r=>setTimeout(r,25));}}
 }
 return original(file,...args);
};
