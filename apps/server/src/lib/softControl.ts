/** Local authenticated stop channel. A descriptor is private process-control material, not app data. */
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root=path.resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
// The portable launcher keeps control descriptors next to the data it guards (TubeStudioData).
const folder=process.env.TUBESTUDIO_CONTROL_DIR?path.resolve(process.env.TUBESTUDIO_CONTROL_DIR):path.join(root,'.tubestudio-control');
export const controlFolder=()=>folder;
/** Extra commands for the launcher: LINK returns a fresh one-time login link, PING the version. */
export type ControlExtras={link?:()=>string;version?:string};
export async function openSoftControl(appPort:number,onStop:(socket:net.Socket)=>boolean,extras:ControlExtras={}){
 await fs.mkdir(folder,{mode:0o700}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='EEXIST')throw e;});
 const st=await fs.lstat(folder);if(st.isSymbolicLink()||!st.isDirectory())throw Error('UNSAFE_CONTROL_DIRECTORY');
 const token=crypto.randomBytes(32).toString('hex'),instance=crypto.randomUUID();let count=0;
 const server=net.createServer(socket=>{
  if(++count>8){count--;socket.destroy();return;}socket.once('close',()=>count--);socket.setTimeout(3000,()=>socket.destroy());let text='';
  socket.on('error',()=>{});
  socket.on('data',chunk=>{text+=chunk.toString('utf8');if(Buffer.byteLength(text)>100){socket.destroy();return;}if(!text.includes('\n'))return;
   socket.removeAllListeners('data');const m=/^(STOP|LINK|PING) ([0-9a-f]{64})\n$/.exec(text);if(!m||!crypto.timingSafeEqual(Buffer.from(m[2],'hex'),Buffer.from(token,'hex'))){socket.end('DENIED\n');return;}
   if(m[1]==='PING'){socket.end(`PONG ${extras.version??'?'} ${process.pid}\n`);return;}
   if(m[1]==='LINK'){if(!extras.link){socket.end('DENIED\n');return;}socket.end(`LINK ${extras.link()}\n`);return;}
   socket.setTimeout(0);if(!onStop(socket))socket.end('BUSY\n');
  });
 });
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0,exclusive:true},()=>{server.off('error',reject);resolve();});});
 server.on('error',()=>{});const address=server.address();if(!address||typeof address==='string'){server.close();throw Error('CONTROL_ADDRESS');}
 const file=path.join(folder,`${instance}.json`),body=JSON.stringify({schema:1,instance,pid:process.pid,appPort,controlPort:address.port,token,version:extras.version??null,program:process.env.TUBESTUDIO_PROGRAM_DIR??null})+'\n';
 try {const h=await fs.open(file,'wx',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}}
 catch(e){server.close();throw e;}
 let closed=false;
 return {async close(){if(closed)return;server.close();const x=await fs.lstat(file);if(x.isSymbolicLink()||!x.isFile()||x.nlink!==1||x.size>4096||await fs.readFile(file,'utf8')!==body)throw Error('CONTROL_CHANGED');await fs.unlink(file);closed=true;}};
}
