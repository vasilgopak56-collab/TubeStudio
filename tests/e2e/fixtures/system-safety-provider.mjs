// No request is forwarded to the network. Keys and responses are synthetic only.
import fs from 'node:fs';
import {promises as fsp} from 'node:fs';
const file=process.env.TS_SAFETY_CONTROL;if(!file)throw Error('Isolated control required');
const rename=fsp.rename;fsp.rename=async(a,b)=>{const c=JSON.parse(fs.readFileSync(file,'utf8'));if(c.failRename&&String(b)===process.env.ENV_FILE)throw Object.assign(Error('Synthetic disk failure'),{code:'EACCES'});return rename(a,b);};
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input));const c=JSON.parse(fs.readFileSync(file,'utf8'));const call={path:u.pathname,method:init.method??'GET'};fs.appendFileSync(file+'.calls',JSON.stringify(call)+'\n');
 if(init.method==='POST')throw Error('Generation forbidden by acceptance fixture');
 if(u.origin==='https://api.anthropic.com'&&u.pathname==='/v1/models')return Response.json({data:[{id:'claude-haiku-synthetic'}]});
 if(u.origin==='https://www.googleapis.com'&&u.pathname==='/youtube/v3/channels')return c.failYoutube?Response.json({error:{message:'Synthetic quota error',errors:[{reason:'quotaExceeded'}]}},{status:403}):Response.json({items:[]});
 throw Error('Unexpected provider request blocked');
};
