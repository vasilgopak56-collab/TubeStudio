// Isolated synthetic provider: every outbound request is explicitly handled or rejected.
import fs from 'node:fs';
const file=process.env.TS_TEST_TRANSCRIPT_CONTROL;if(!file)throw Error('Synthetic control required');
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode}=JSON.parse(fs.readFileSync(file,'utf8'));let kind,body;
 if(u.origin==='https://api.anthropic.com'&&u.pathname==='/v1/models'){fs.appendFileSync(file+'.calls',JSON.stringify({kind:'models'})+'\n');return Response.json({data:[{id:'claude-haiku-4-5'}]});}
 if(u.origin==='https://api.anthropic.com'&&u.pathname==='/v1/messages'){body=JSON.parse(String(init.body));kind=body.max_tokens===1?'diagnostic':'generation';}
 else if(u.origin==='https://www.youtube.com'&&u.pathname==='/watch'){fs.appendFileSync(file+'.calls',JSON.stringify({kind:'watch'})+'\n');return new Response('Synthetic unavailable captions',{status:403});}
 else throw Error('Outbound request blocked');
 fs.appendFileSync(file+'.calls',JSON.stringify({kind,body})+'\n');if(kind==='diagnostic')return Response.json({content:[{type:'text',text:'1'}]});
 if(mode==='slow-ai')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000),abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail-ai')return Response.json({error:{message:'SECRET_PROVIDER_LEAK'}},{status:400});
 const remix=/Task mode: remix/.test(body.system[0].text),out={title:'От акведука до дома <img src=x onerror=alert(1)> עברית 日本語',summary:'Источник обсуждает водоснабжение и требует проверки дат.',keyPoints:['Распределение воды — утверждение источника, не проверенный факт.'],outline:[{heading:'Путь воды',notes:'Сверить независимые источники.'}],cautions:['Внешняя проверка фактов не выполнялась.'],script:remix?'Новая композиция для самостоятельного объяснения системы воды. '.repeat(10):''};
 if(mode==='bad-mode')out.script=remix?'':'Несоответствующий режиму сценарий';
 return Response.json({content:[{type:'text',text:mode==='invalid'?'not JSON':JSON.stringify(out)}],usage:{input_tokens:100,output_tokens:200}});
};
