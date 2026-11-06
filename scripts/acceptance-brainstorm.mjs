// Packaged-app smoke test; browser catalog is synthetic, no model or research request is made.
import crypto from 'node:crypto';
import path from 'node:path';

export async function brainstormChecks({port,cookie,page,out,errors},{check,api}) {
  const call=(method,p,body)=>api(port,method,`/api${p}`,{cookie,body});
  const channel=await call('POST','/studio/channels',{name:'Проверка мозгового штурма',language:'en',niche:'winter history',radar:{region:'US'}});
  const channelId=channel.json?.data?.id;
  if(!check('O: тестовый канал создан',channel.status===200&&!!channelId,channel.text.slice(0,300)))return;
  const projectId=crypto.randomUUID(),create={projectId,channelId,title:'Мозговой штурм — проверка'};
  const made=await call('POST','/assistant/brainstorm/projects',create);
  check('O: проект связан с каналом',made.status===200&&made.json?.data?.project?.channelId===channelId,made.text.slice(0,300));
  const again=await call('POST','/assistant/brainstorm/projects',create);
  check('O: повтор создания не делает копию',again.status===200&&again.json?.data?.alreadySaved===true,again.text.slice(0,300));
  const initial=await call('GET',`/assistant/brainstorm/projects/${projectId}`);
  check('O: проект открывается без отчёта и без задач',initial.status===200&&initial.json?.data?.project?.channelId===channelId&&['plans','evidence','reports','brands','uploads','imageRuns'].every(k=>Array.isArray(initial.json.data[k])&&initial.json.data[k].length===0),initial.text.slice(0,300));
  const unapproved=await call('POST','/assistant/brainstorm/planning',{projectId,attemptId:crypto.randomUUID(),scanRunId:crypto.randomUUID(),task:'Проверить историю зимы',model:'synthetic-model',region:'US',previewHash:'a'.repeat(64),confirmed:false});
  check('O: запуск без подтверждения отклонён',unapproved.status===400,unapproved.text.slice(0,300));
  let starts=0;
  await page.route('**/api/anymodel/models',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{models:[{id:'synthetic-model',kind:'text'}],selected:{text:'synthetic-model',script:'synthetic-model'}}})}));
  await page.route('**/api/assistant/brainstorm/planning',r=>{starts++;return r.abort();});
  await page.goto(`http://127.0.0.1:${port}/script`);
  await page.getByRole('button',{name:'Открыть помощника',exact:true}).click();
  await page.getByRole('dialog',{name:'Помощник TubeStudio'}).waitFor({timeout:30000});
  await page.getByRole('button',{name:'Мозговой штурм канала',exact:true}).click();
  const select=page.getByLabel('Проект мозгового штурма',{exact:true});
  await select.locator(`option[value="${projectId}"]`).waitFor({state:'attached',timeout:30000});
  await select.selectOption(projectId);
  const task=page.getByLabel('Задание мозгового штурма',{exact:true});
  await task.waitFor({timeout:30000});await task.fill('Изучить историю выживания зимой и предложить идеи.');
  check('O: экран задания открылся и принимает текст',await task.inputValue()==='Изучить историю выживания зимой и предложить идеи.');
  check('O: без подтверждения модель не запускается',starts===0&&await page.getByRole('button',{name:'Подтвердить этот этап',exact:true}).count()===0);
  await page.screenshot({path:path.join(out,'brainstorm-start.png')}).catch(()=>{});
  await page.getByRole('button',{name:'Закрыть помощника',exact:true}).click();
  await page.getByRole('button',{name:'Открыть помощника',exact:true}).click();
  await page.getByRole('button',{name:'Мозговой штурм канала',exact:true}).click();
  const after=await call('GET',`/assistant/brainstorm/projects/${projectId}`);
  check('O: закрытие и открытие не запускает работу и сохраняет проект',starts===0&&after.status===200&&after.json?.data?.project?.id===projectId&&after.json?.data?.plans?.length===0,after.text.slice(0,300));
  check('O: экран без ошибок JavaScript',errors.length===0,errors.join('\n'));
}
