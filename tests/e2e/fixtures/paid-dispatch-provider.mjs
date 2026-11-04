// All outbound traffic is intercepted; nothing is forwarded to real providers.
import fs from 'node:fs';
globalThis.fetch=async(url,init={})=>{const u=String(url),method=init.method||'GET';fs.appendFileSync(process.env.TS_DISPATCH_NETWORK,JSON.stringify({url:u,method})+'\n');
 if(method==='GET'&&u.endsWith('/models'))return Response.json({data:[{id:'same',billing:{unit:'token',base_tokens:1,coefficient:{input:0,output:0}}}]});
 if(method==='GET'&&u.includes('/voices'))return Response.json({voices:[]});
 if(method==='POST'&&u.includes('/audio/speech'))return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/mpeg'}});
 throw Error('Unexpected synthetic request');
};
