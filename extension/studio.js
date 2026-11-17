/* YouTube Studio: по кнопке владельца вставляет название, описание и теги из сохранённой карточки «Публикации».
   Никогда не нажимает «Далее», «Сохранить» и «Опубликовать». Страница YouTube — недоверенные данные. */
(() => {
 const send=msg=>new Promise(resolve=>chrome.runtime.sendMessage(msg,r=>resolve(r??{ok:false,error:{message:'Расширение недоступно. Обновите вкладку'}})));
 const api=path=>send({type:'api',path,method:'GET'});
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.addEventListener('click',fn);return b;};
 const yesNo=v=>v===null||v===undefined?'не отвечено в карточке':v?'да':'нет';
 // Поиск и сквозь открытые shadow root: разметка Studio меняется.
 function deep(selector,root=document){const hit=root.querySelector(selector);if(hit)return hit;for(const el of root.querySelectorAll('*'))if(el.shadowRoot){const x=deep(selector,el.shadowRoot);if(x)return x;}return null;}
 const first=list=>{for(const s of list){const el=deep(s);if(el)return el;}return null;};
 const TITLE=['ytcp-video-title #textbox','#title-textarea #textbox'];
 const DESCRIPTION=['ytcp-video-description #textbox','#description-textarea #textbox'];
 const TAGS=['ytcp-free-text-chip-bar #text-input','#tags-container input','input[aria-label="Tags"]','input[aria-label="Теги"]'];
 const MORE=['ytcp-video-metadata-editor #toggle-button','ytcp-uploads-details #toggle-button'];
 const text=el=>(el?.innerText??'').replace(/ /g,' ').trim();
 const same=(a,b)=>a.replace(/\s+/g,' ').trim()===b.replace(/\s+/g,' ').trim();
 function replaceText(el,value){el.focus();document.execCommand('selectAll',false);if(value)document.execCommand('insertText',false,value);else document.execCommand('delete',false);el.dispatchEvent(new Event('input',{bubbles:true}));el.blur();}
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 async function tagsInput(){let input=first(TAGS);if(input)return input;const more=first(MORE);if(!more)return null;more.click();for(let i=0;i<10&&!input;i++){await wait(200);input=first(TAGS);}return input;}

 let panel,select,status,info,cards=[],busy=false;
 function say(lines){status.replaceChildren(...lines.map(([t,ok])=>{const p=node('div',t,ok?'ts-ok':'ts-bad');return p;}));}
 async function loadList(){
  if(busy)return;busy=true;say([['Загружаю список из TubeStudio…',true]]);
  try{const r=await api('/ext/publish-cards');if(!r.ok)return say([[r.error?.message??'Нет связи с TubeStudio',false]]);
   cards=Array.isArray(r.data)?r.data:[];select.replaceChildren(...cards.map(c=>{const o=node('option',`${c.project} — ${c.title}`);o.value=c.projectId;return o;}));
   say(cards.length?[[`Роликов с карточкой: ${cards.length}. Выберите и нажмите «Заполнить».`,true]]:[['Нет сохранённых карточек. Заполните карточку на странице «Публикация» и нажмите «Сохранить».',false]]);
  }finally{busy=false;}
 }
 async function fill(){
  if(busy||!select.value)return;busy=true;const out=[];
  try{
   const r=await api('/ext/publish-cards/'+encodeURIComponent(select.value));if(!r.ok)return say([[r.error?.message??'Нет связи с TubeStudio',false]]);
   const c=r.data,title=first(TITLE),desc=first(DESCRIPTION);
   if(!title&&!desc)return say([['Не нашёл поля «Название» и «Описание». Откройте шаг «Сведения» загрузки или страницу ролика в Studio.',false]]);
   if(desc&&text(desc)&&!same(text(desc),c.description)&&!confirm('В описании на YouTube уже есть текст. Заменить его описанием из TubeStudio?')){out.push(['Описание не тронуто: вы отказались заменять.',false]);}
   else if(!desc)out.push(['Не нашёл поле «Описание».',false]);
   else{replaceText(desc,c.description);out.push(same(text(desc),c.description)?['Описание с главами вставлено.',true]:['Описание вставлено не полностью — проверьте поле.',false]);}
   if(!title)out.push(['Не нашёл поле «Название».',false]);
   else{replaceText(title,c.title);out.push(same(text(title),c.title)?['Название вставлено.',true]:['Название вставлено не полностью — проверьте поле.',false]);}
   if(!c.tags.length)out.push(['Тегов в карточке нет.',true]);
   else{const input=await tagsInput();if(!input)out.push(['Не нашёл поле «Теги». Нажмите «Показать больше» и вставьте теги вручную: '+c.tags.join(', '),false]);
    else{input.focus();document.execCommand('insertText',false,c.tags.join(',')+',');input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));input.blur();out.push([`Теги добавлены (${c.tags.length}) к уже стоящим — проверьте список.`,true]);}}
   out.push(['Ничего не сохранено и не опубликовано: проверьте поля и нажимайте кнопки YouTube сами.',true]);
   say(out);
   info.replaceChildren(node('b','Отметьте сами:'),...[`Для детей: ${yesNo(c.madeForKids)}`,`Изменённый или созданный ИИ контент: ${yesNo(c.syntheticMedia)}`,`Категория: ${c.category??'не выбрана в карточке'}`,`Язык: ${c.language??'не указан в карточке'}`,`Обложка: ${c.thumbnail?'есть в программе — загрузите файл вручную':'в карточке нет'}`].map(t=>node('div',t)));
  }catch{say([['Ошибка при заполнении. Обновите вкладку и попробуйте снова.',false]]);}finally{busy=false;}
 }
 function build(){
  panel=node('div',undefined,'ts-studio');const head=node('div',undefined,'ts-head');head.append(node('b','TubeStudio'),button('×',()=>{panel.hidden=true;closed=true;}));
  select=node('select');status=node('div',undefined,'ts-status');info=node('div',undefined,'ts-info');
  const row=node('div',undefined,'ts-btns');row.append(button('Заполнить',fill),button('Обновить список',loadList));
  panel.append(head,select,row,status,info);document.body.append(panel);loadList();
 }
 let closed=false;
 setInterval(()=>{const show=TITLE.some(s=>document.querySelector(s));if(show&&!panel&&!closed)build();if(panel)panel.hidden=closed||!show;if(!show)closed=false;},1500);
})();
