// Synthetic provider; no real credentials or outbound traffic.
import fs from 'node:fs';
const file=process.env.TS_TEST_COACH_CONTROL;if(!file)throw Error('Synthetic fixture control required');
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input));if(u.origin!=='https://api.anthropic.com')throw Error('Outbound request blocked');
 if(u.pathname==='/v1/models')return Response.json({data:[{id:'claude-haiku-4-5'}]});
 if(u.pathname!=='/v1/messages')throw Error('Unexpected provider path');
 const body=JSON.parse(String(init.body));if(body.max_tokens===1)return Response.json({content:[{type:'text',text:'1'}]});
 fs.appendFileSync(file+'.calls',JSON.stringify(body)+'\n');const {mode}=JSON.parse(fs.readFileSync(file,'utf8'));
 if(mode==='slow')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000);const abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail')return Response.json({error:{message:'Synthetic provider failure'}},{status:400});
 return Response.json({content:[{type:'text',text:mode==='empty'?' ':'По сохранённому контексту: проверьте ясность первого предложения. Это гипотеза, не внешняя проверка фактов. <script>window.coachInjected=1</script>'}],usage:{input_tokens:100,output_tokens:50}});
};
