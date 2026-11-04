// Test-only preload; never imported by production. Deny all external fetches.
import fs from 'node:fs';
const original=globalThis.fetch;
globalThis.fetch=async(url,init={})=>{
 const u=String(url);
 if(/^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(u))return original(url,init);
 const parsed=new URL(u);
 if(parsed.host==='www.googleapis.com'&&parsed.pathname.startsWith('/youtube/v3/')){
  fs.appendFileSync(process.env.TS_ASSISTANT_FIXTURE,JSON.stringify({kind:'youtube',endpoint:parsed.pathname,limit:parsed.searchParams.get('maxResults'),order:parsed.searchParams.get('order'),pageToken:parsed.searchParams.get('pageToken')})+'\n');
  if(parsed.pathname.endsWith('/channels'))return Response.json({items:[{id:'UC'+ 'a'.repeat(22),snippet:{title:'Синтетический канал'},contentDetails:{relatedPlaylists:{uploads:'UU'+'a'.repeat(22)}}}]});
  if(parsed.pathname.endsWith('/playlistItems')){const token=parsed.searchParams.get('pageToken');const ids=token==='NEXT_NOT_FETCHED'?['0123456789a','lmnopqrstuv']:token==='PAGE_THREE'?['0123456789b','0123456789c']:['abcdefghijk','lmnopqrstuv'];return Response.json({items:ids.map(videoId=>({contentDetails:{videoId}})),nextPageToken:token==='NEXT_NOT_FETCHED'?'PAGE_THREE':token==='PAGE_THREE'?'PAGE_FOUR':'NEXT_NOT_FETCHED'});}
  if(parsed.pathname.endsWith('/videos')){const ids=parsed.searchParams.get('id').split(',');return Response.json({items:ids.map((id,i)=>({id,snippet:{title:i?'Другой ролик':'История города · донор',channelTitle:'Донор',channelId:ids.length>1?'UC'+'a'.repeat(22):'fixture-channel',description:'Публичное описание, не просмотр ролика.',publishedAt:i?'2024-01-01T00:00:00Z':'2025-01-01T00:00:00Z',tags:[],thumbnails:{}},statistics:{commentCount:'1000',viewCount:i?'200':'100'},contentDetails:{duration:'PT12M'}}))});}
  if(parsed.pathname.endsWith('/commentThreads'))return Response.json({items:[{id:'thread-not-comment',snippet:{topLevelComment:{id:'fixture_comment',snippet:{textDisplay:'Расскажите, пожалуйста, про городскую канализацию XIX века в следующем видео.',authorDisplayName:'Зритель',likeCount:8,publishedAt:'2025-01-01T00:00:00Z'}},totalReplyCount:3}}],nextPageToken:'NOT_REQUESTED'});
  throw new Error('Unexpected YouTube endpoint');
 }
 if(u==='https://anymodel.org/v1/audio/speech'){
  const body=JSON.parse(String(init.body));fs.appendFileSync(process.env.TS_ASSISTANT_FIXTURE,JSON.stringify({kind:'speech',model:body.model,input:body.input,redirect:init.redirect})+'\n');
  if(body.model.endsWith('synthetic-error'))return Response.json({error:{message:'PRIVATE_SYNTHETIC_PROVIDER_ERROR'}},{status:503});
  if(body.model.endsWith('synthetic-slow'))await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,3000);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
  return new Response(fs.readFileSync(new URL('./tts-tone.mp3',import.meta.url)),{headers:{'content-type':'audio/mpeg'}});
 }
 if(u!=='https://api.anthropic.com/v1/messages')throw new Error('Unexpected external request in assistant fixture');
 const body=JSON.parse(String(init.body)),user=JSON.parse(body.messages[0].content),log=process.env.TS_ASSISTANT_FIXTURE;
 fs.appendFileSync(log,JSON.stringify({model:body.model,task:user.task,mode:user.mode,url:u})+'\n');
 if(user.question.includes('ПОДОЖДИ'))await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,2000);init.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
 const clarified=user.question.includes('XIX')||user.task!=='routine';
 const data={reply:clarified?'Задание уточнено. Действия ещё не выполнялись.':'Перед продолжением уточните период.',brief:'Документальный ролик о городе. Длительность — 12 минут.',questions:clarified?[]:['О каком историческом периоде рассказать?'],steps:['Уточнить исходные условия','Проверить факты','Подготовить сценарий'],deliverable:user.task==='routine'?'':user.task==='script'?'АВТОРСКИЙ СЦЕНАРИЙ: город просыпается на рассвете.':'АВТОРСКИЕ ПРОМПТЫ: городской пейзаж на рассвете.',approach:{name:'Спокойная документальная интрига',description:'Для исторического рассказа с постепенным раскрытием.',instructions:'Уточнить тему и период. Проверить факты. Подготовить план. Авторский сценарий писать основной моделью.'}};
 if(user.question.includes('СИНТЕТИЧЕСКИЙ JSON СЦЕН')&&(user.task==='imagePrompt'||user.task==='animationPrompt'))data.deliverable=JSON.stringify([[1,'image','КАДР JSON'],[1,'video','ДВИЖЕНИЕ JSON'],[2,'image','ВТОРОЙ КАДР JSON']]);
 if(user.context?.sources?.length&&user.question.includes('audienceIdeas')){const source=user.context.sources[0],c=source.comments[0];data.reply='Найден кандидат из ограниченной выборки; проверьте интерпретацию.';data.questions=[];data.audienceIdeas=[{title:'Как работала городская канализация XIX века',reason:'Зритель прямо просит отдельное видео.',evidence:[{sourceId:source.id,commentId:c.id,quote:c.text}]}];}
 if(user.context?.sources?.length&&user.question.startsWith('Выбираю идею:')){data.reply='Идея выбрана. Нужно уточнить условия сценария.';data.questions=['Какую длительность и подачу выбрать?'];data.deliverable='';}
 if(user.mode==='process-plan'){
  const source=user.context.documents[0],text=source?.text??user.question,sourceId=source?'document:0':'prompt';
  const quote=text.includes('Напиши оригинальный документальный сценарий.')?'Напиши оригинальный документальный сценарий.':text.slice(0,Math.min(220,text.length));
  const needQuestion=user.question.includes('СПРОСИ ПЕРИОД'),issues=needQuestion?[{question:'О каком историческом периоде подготовить сценарий?',requirementIds:['r1']}]:[];
  data.reply='Подготовлен разбор требований, действия не выполнялись.';data.questions=issues.map(x=>x.question);data.deliverable='';
  data.processProposal={title:'Процесс из моих материалов',requirements:[{id:'r1',text:'Подготовить оригинальный документальный сценарий.',evidence:[{sourceId,quote:user.question.includes('НЕВЕРНАЯ ЦИТАТА')?'ТАКОЙ ЦИТАТЫ В ИСТОЧНИКЕ НЕТ.':quote}]}],steps:[{title:'Оригинальный сценарий',task:'script',instructions:'Напиши оригинальный документальный сценарий по явно согласованным условиям. Если условий не хватает, сначала задай вопросы.',requirementIds:['r1']}],issues,exclusions:[],coverageNote:'Проверить полноту по исходному файлу. Это тестовая интерпретация, не доказательство охвата.'};
 }
 return new Response(JSON.stringify({content:[{type:'text',text:JSON.stringify(data)}],usage:{input_tokens:100,output_tokens:100}}),{headers:{'content-type':'application/json'}});
};
