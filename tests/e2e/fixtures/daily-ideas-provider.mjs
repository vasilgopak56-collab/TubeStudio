// Synthetic data only; every server fetch is intercepted and all unknown origins blocked.
import fs from 'node:fs';
const file=process.env.TS_TEST_DAILY_CONTROL;if(!file)throw Error('Synthetic fixture control required');
const ideas=()=>({ideas:Array.from({length:5},(_,i)=>({title:['Как Рим доставлял воду без насосов','Что скрывали тоннели акведуков','Кто обслуживал водную сеть города','Почему фонтан работал день и ночь','Куда исчезала вода после бани'][i],angle:'Инженерия и повседневная жизнь: проверить историю по независимым источникам.',hook:'Откуда в доме римлянина бралась вода?',why:'Гипотеза по названиям в сохранённом исследовании, не подтверждённый спрос.',check:'Проверить устройство водовода, даты и право использования иллюстраций.',evidenceRefs:['E1']}))});
globalThis.fetch=async(input,init={})=>{
 const u=new URL(String(input)),{mode}=JSON.parse(fs.readFileSync(file,'utf8'));if(u.origin!=='https://api.anthropic.com')throw Error('Outbound request blocked');
 if(u.pathname==='/v1/models'){fs.appendFileSync(file+'.calls',JSON.stringify({kind:'models'})+'\n');return Response.json({data:[{id:'claude-haiku-4-5'}]});}
 if(u.pathname!=='/v1/messages')throw Error('Unexpected provider path');const body=JSON.parse(String(init.body)),kind=body.max_tokens===1?'diagnostic':'generation';fs.appendFileSync(file+'.calls',JSON.stringify({kind,body})+'\n');
 if(kind==='diagnostic')return Response.json({content:[{type:'text',text:'1'}]});
 if(mode==='slow')await new Promise((resolve,reject)=>{const t=setTimeout(resolve,15000);const abort=()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));};init.signal?.addEventListener('abort',abort,{once:true});if(init.signal?.aborted)abort();});
 if(mode==='fail')return Response.json({error:{message:'SECRET_PROVIDER_LEAK'}},{status:400});
 const answer=ideas();if(mode==='refs')answer.ideas[0].evidenceRefs=['E10'];if(mode==='duplicate')answer.ideas[1].title=answer.ideas[0].title;
 return Response.json({content:[{type:'text',text:mode==='invalid'?'{}':JSON.stringify(answer)}],usage:{input_tokens:100,output_tokens:300}});
};
