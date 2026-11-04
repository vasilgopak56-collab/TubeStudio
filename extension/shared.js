/* Pure validation shared by the popup, background and content script. */
(() => {
 const defaults={server:"http://127.0.0.1:8787",token:"",badges:"search",panel:true};
 const id=/^[\w-]{11}$/;
 function serverOrigin(raw) {
  const u=new URL(String(raw).trim());
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||(u.pathname!=='/'&&u.pathname!==''))throw Error('Укажите только HTTP/HTTPS origin без пути, пароля и параметров');
  if(u.protocol==='http:'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw Error('HTTP допустим только на loopback; удалённый HTTPS не поддерживается TubeStudio .148');
  return u.origin;
 }
 function config(c) {return {server:serverOrigin(c.server??defaults.server),token:typeof c.token==='string'&&c.token.length<=256?c.token.trim():'',badges:['off','search','all'].includes(c.badges)?c.badges:defaults.badges,panel:typeof c.panel==='boolean'?c.panel:true};}
 function videoId(href,base='https://www.youtube.com') {try{const u=new URL(href,base);if(u.origin!=='https://www.youtube.com')return null;const v=u.pathname==='/watch'?u.searchParams.get('v'):u.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1];return id.test(v??'')?v:null;}catch{return null;}}
 function request(msg) {
  if(msg.method&&msg.method!=='GET'&&msg.method!=='POST')throw Error('Действие недоступно');
  const method=msg.method??'GET';
  if(method==='GET'&&msg.path==='/ext/ping')return {path:msg.path,method};
  if(method==='GET'&&typeof msg.path==='string'&&msg.path.startsWith('/ext/videos?')){const u=new URL(msg.path,'https://local.invalid');if(u.pathname!=='/ext/videos'||u.hash||[...u.searchParams.keys()].some(k=>k!=='ids')||u.searchParams.getAll('ids').length!==1)throw Error('Некорректный запрос');const ids=u.searchParams.get('ids').split(',');if(!ids.length||ids.length>50||ids.some(v=>!id.test(v)))throw Error('От 1 до 50 ID');return {method,path:'/ext/videos?ids='+[...new Set(ids)].join(',')};}
  if(method==='POST'&&msg.path==='/saved-topics'){const b=msg.body;if(!b||typeof b.title!=='string'||b.title.length<3||b.title.length>300||b.source!=='research'||typeof b.notes!=='string'||b.notes.length>5000)throw Error('Некорректная тема');return {path:msg.path,method,body:{title:b.title,source:'research',notes:b.notes}};}
  throw Error('Действие недоступно');
 }
 function openPath(value) {if(typeof value!=='string'||value.length>6000||/[\\\r\n]/.test(value))throw Error('Некорректный переход');const u=new URL(value,'https://local.invalid');if(u.origin!=='https://local.invalid'||!['/','/research','/comments','/script','/thumbnail','/competitors','/saved'].includes(u.pathname)||!value.startsWith('/'))throw Error('Переход недоступен');u.searchParams.delete('auto');return u.pathname+u.search;}
 globalThis.TubeStudioExtension={defaults,config,serverOrigin,videoId,request,openPath};
})();
