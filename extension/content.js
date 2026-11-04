/* All quota-consuming reads are explicit button actions. YouTube DOM is untrusted. */
(() => {
 const X=TubeStudioExtension;
 const send=msg=>new Promise(resolve=>chrome.runtime.sendMessage(msg,r=>resolve(r??{ok:false,error:{message:'Расширение недоступно. Обновите вкладку'}})));
 const api=(path,method='GET',body)=>send({type:'api',path,method,body});
 const open=path=>send({type:'open',path});
 let cfg={badges:'off',panel:false},timer,busy=false;
 const cache=new Map(),ttl=30*60000;
 const compact=n=>typeof n!=='number'||!Number.isFinite(n)?'—':n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(1)+'K':String(Math.round(n*10)/10);
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b;};
 const current=()=>location.pathname==='/watch'?X.videoId(location.href):null;
 const pageKind=()=>location.pathname==='/results'?'search':/^\/(@|channel\/|c\/|user\/)/.test(location.pathname)?'channel':location.pathname==='/'?'home':'other';
 const badgesOn=()=>cfg.badges==='all'||cfg.badges==='search'&&['search','channel'].includes(pageKind());
 function cached(id){const hit=cache.get(id);if(hit&&Date.now()-hit.at<ttl)return hit.row;cache.delete(id);return null;}
 function remember(rows){for(const row of rows??[])if(row&&/^[\w-]{11}$/.test(row.id)){cache.delete(row.id);cache.set(row.id,{at:Date.now(),row});}while(cache.size>500)cache.delete(cache.keys().next().value);}
 function thumbnails(){return [...document.querySelectorAll('a#thumbnail[href],a.reel-item-endpoint[href],a.shortsLockupViewModelHostEndpoint[href],yt-thumbnail-view-model a[href]')].map(a=>({a,id:X.videoId(a.getAttribute('href'))})).filter(x=>x.id);}
 function drawBadge(a,id,r){const old=a.querySelector(':scope > .ts-badge');if(old?.dataset.vid===id)return;old?.remove();if(!r)return;const d=node('div',undefined,'ts-badge');d.dataset.vid=id;d.append(node('b',r.outlier==null?'Outlier —':`${r.outlier}×`),node('span',`${compact(r.vph)}/ч сред.`));if(r.viral===true)d.append(node('span','🔥'));d.title=`VPH средний с публикации, не скорость сейчас. База: ${r.baseline?.kind??'неизвестна'}, n=${r.baseline?.sampleSize??0}. ${r.notice??''}`;if(getComputedStyle(a).position==='static')a.style.position='relative';a.append(d);}
 function renderBadges(){for(const {a,id} of thumbnails()){const old=a.querySelector(':scope > .ts-badge');if(old&&(old.dataset.vid!==id||!cached(id)||!badgesOn()))old.remove();if(badgesOn())drawBadge(a,id,cached(id));}}
 function toolbar(){let bar=document.querySelector('.ts-toolbar');if(!badgesOn()){bar?.remove();return;}if(bar)return;bar=node('div',undefined,'ts-toolbar');const status=node('span','Без автоматических запросов','ts-msg');const load=button('Загрузить бейджи: до 50 видео',async()=>{if(busy)return;const ids=[...new Set(thumbnails().map(x=>x.id))].filter(id=>!cached(id)).slice(0,50);if(!ids.length){status.textContent='Видимые найденные ID уже в кэше либо видео не найдены';return;}busy=true;load.disabled=true;status.textContent='Загрузка…';try{const r=await api('/ext/videos?ids='+ids.join(','));if(r.ok&&Array.isArray(r.data)){remember(r.data);renderBadges();status.textContent=`Получено ${r.data.length} из ${ids.length}. Для следующих — нажмите ещё раз`;}else status.textContent=r.error?.message??'Ошибка. Повторите вручную';}finally{busy=false;load.disabled=false;}});bar.append(load,node('small','Может расходовать квоту YouTube. До 20 баз каналов; оценка до 42 ед. без кэша, повторы отдельно.'),status);document.body.append(bar);}
 function metric(p,label,value){const box=node('span');box.append(node('span',label,'ts-k'),node('span',value,'ts-v'));p.append(box);}
 function watchPanel(){const id=current();document.querySelectorAll('.ts-panel').forEach(p=>{if(p.dataset.vid!==id||!cfg.panel)p.remove();});if(!cfg.panel||!id||document.querySelector(`.ts-panel[data-vid="${id}"]`))return;
  const host=document.querySelector('#above-the-fold')??document.querySelector('ytd-watch-metadata');if(!host)return;
  const p=node('section',undefined,'ts-panel');p.dataset.vid=id;p.append(node('strong','TubeStudio','ts-logo'));const status=node('p','Метрики не загружены. Кнопка может расходовать квоту YouTube; данные могут быть кэшированными.','ts-msg');
  const load=button('Получить метрики',async()=>{if(busy)return;busy=true;load.disabled=true;status.textContent='Получаю метрики…';try{const hit=cached(id);const r=hit?{ok:true,data:[hit]}:await api('/ext/videos?ids='+id);if(!p.isConnected||current()!==id)return;if(!r.ok){status.textContent=r.error?.message??'Нет связи. Повторите кнопкой';return;}const v=r.data?.find(x=>x.id===id);if(!v){status.textContent='Видео недоступно. Повторите позже вручную';return;}remember([v]);p.replaceChildren(node('strong','TubeStudio','ts-logo'));p.append(node('p',v.title));const row=node('div',undefined,'ts-row');metric(row,'Outlier',v.outlier==null?'—':`${v.outlier}×`);metric(row,'VPH средний',compact(v.vph));metric(row,'База',compact(v.baseViews));metric(row,'Просм./подп.',v.ratio==null?'—':`${v.ratio}×`);p.append(row);
   p.append(node('p',`База: ${v.baseline?.kind??'неизвестна'}, n=${v.baseline?.sampleSize??0}. ${v.baseline?.note??''}`,'ts-why'),node('p',`Расчёт: ${v.computedAt??'дата неизвестна'}. ${v.notice??'Данные могут быть кэшированными'}`,'ts-why'),node('p',v.viralWhy??'','ts-why'));
   const actions=node('div',undefined,'ts-btns'),msg=node('span','','ts-msg'),url=`https://www.youtube.com/watch?v=${id}`;
   actions.append(button('Похожие outliers',()=>open('/research?q='+encodeURIComponent(v.title))),button('Комментарии',()=>open('/comments?v='+encodeURIComponent(url))),button('В сценарий',()=>open('/script?topic='+encodeURIComponent(v.title))),button('Ремикс обложки',()=>open('/thumbnail?remix='+encodeURIComponent(`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`)+'&title='+encodeURIComponent(v.title))),button('Открыть трекер',()=>open('/competitors')));
   const save=button('Сохранить тему и проект',async()=>{save.disabled=true;msg.textContent='Сохраняю…';try{const title=String(v.title??'').trim().slice(0,300);const saved=await api('/saved-topics','POST',{title:title.length>=3?title:`Видео ${id}`,source:'research',notes:`${url}\nOutlier ${v.outlier??'—'}×; VPH средний ${v.vph??'—'}; база ${v.baseline?.kind??'неизвестна'}. Снимок ${v.computedAt??'без даты'}, не живые данные.`});if(saved.ok){msg.textContent='Тема сохранена (или найдена по названию). Связанный проект — в TubeStudio';save.textContent='Сохранено';}else{msg.textContent=saved.error?.message??'Ошибка сохранения';save.disabled=false;}}catch{msg.textContent='Ошибка. Повторите вручную';save.disabled=false;}});
   actions.append(save,button('Открыть сохранённые темы',()=>open('/saved')),msg);p.append(actions,node('small','Переходы только заполняют/открывают формы: поиск, AI и отслеживание запускаются вручную в TubeStudio. Повторное сохранение совпадающего названия возвращает существующую тему.'));renderBadges();
  }finally{busy=false;load.disabled=false;}});
  p.append(status,load);host.prepend(p);
 }
 function scan(){renderBadges();toolbar();watchPanel();}
 function schedule(){clearTimeout(timer);timer=setTimeout(scan,350);}
 new MutationObserver(records=>{if(records.some(r=>!r.target.closest?.('.ts-panel,.ts-toolbar,.ts-badge')))schedule();}).observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
 window.addEventListener('yt-navigate-finish',schedule);
 send({type:'cfg'}).then(r=>{if(r.ok)cfg=r.data;schedule();});
})();
