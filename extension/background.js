importScripts('shared.js');
const X=TubeStudioExtension;
let migration;
async function config() {
 if(!migration)migration=(async()=>{const local=await chrome.storage.local.get(null);if(local.server!==undefined)return X.config(local);const old=await chrome.storage.sync.get(X.defaults);const c=X.config(old);await chrome.storage.local.set(c);await chrome.storage.sync.remove(['server','token','badges','panel']);return c;})().catch(()=>{migration=null;return {...X.defaults};});
 await migration;return X.config(await chrome.storage.local.get(X.defaults));
}
const failure=(code,message)=>({ok:false,error:{code,message}});
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
 (async()=>{
  const popup=sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
  const content=sender.id===chrome.runtime.id&&sender.tab&&typeof sender.url==='string'&&new URL(sender.url).origin==='https://www.youtube.com';
  if(!popup&&!content)return failure('DENIED','Недоверенный источник сообщения');
  const c=await config();
  if(msg?.type==='cfg')return {ok:true,data:{badges:c.badges,panel:c.panel}}; // Never disclose origin/token to the page.
  if(msg?.type==='popup-config'&&popup)return {ok:true,data:c};
  if(msg?.type==='configure'&&popup){const next=X.config(msg.config??{});await chrome.storage.local.set(next);await chrome.storage.sync.remove(['server','token','badges','panel']);return {ok:true};}
  if(msg?.type==='open'){await chrome.tabs.create({url:c.server+X.openPath(msg.path)});return {ok:true};}
  if(msg?.type==='api'){
   const req=X.request(msg),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
   try{const r=await fetch(c.server+'/api'+req.path,{method:req.method,headers:{'content-type':'application/json',...(c.token?{'x-ts-token':c.token}:{})},body:req.body?JSON.stringify(req.body):undefined,signal:controller.signal,credentials:'omit',redirect:'error'});const text=await r.text();if(text.length>1024*1024)return failure('RESPONSE_LIMIT','Слишком большой ответ');const j=JSON.parse(text);if(!r.ok||j.ok!==true)return failure(r.status===401?'UNAUTHORIZED':j.error?.code??'HTTP',r.status===401?'Нужен токен со страницы «Расширение Chrome»':String(j.error?.message??`HTTP ${r.status}`).slice(0,500));return j;}
   catch{return failure('OFFLINE','Нет связи с TubeStudio или истёк таймаут. Повторите вручную');}finally{clearTimeout(timer);}
  }
  return failure('DENIED','Действие недоступно');
 })().then(reply).catch(()=>reply(failure('VALIDATION','Проверьте адрес, параметры и разрешения расширения')));
 return true;
});
