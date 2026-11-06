// Public lookup is only an indication of an existing channel, never proof a handle is available.
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {rethrowCancelled} from '../../lib/taskContext.js';
import {loadBrainstormBrandPlan} from './brainstormBrandPlanLoad.js';
import {webChannel,type WebChannel} from './ytweb.js';

export const BrainstormHandleAsk=z.object({projectId:z.string().uuid(),planArtifactId:z.string().uuid()}).strict();
type Ask=z.infer<typeof BrainstormHandleAsk>;
export async function checkBrainstormHandle(raw:Ask, lookup:(handle:string)=>Promise<WebChannel>=webChannel){
 const input=BrainstormHandleAsk.parse(raw);
 const before=await loadBrainstormBrandPlan(input.projectId,input.planArtifactId);
 const handle=before.plan.brand.handleCandidate;
 let channel:WebChannel|null=null;
 try{channel=await lookup('@'+handle);}catch(e){rethrowCancelled(e);}
 const after=await loadBrainstormBrandPlan(input.projectId,input.planArtifactId);
 if(before.projectSnapshot!==after.projectSnapshot||before.planHash!==after.planHash)throw new ApiError('VALIDATION','Проект или черновик изменились во время проверки. Проверьте адрес снова.',409);
 const found=!!channel&&typeof channel.handle==='string'&&channel.handle.toLowerCase()===('@'+handle).toLowerCase()&&/^UC[A-Za-z0-9_-]{22}$/.test(channel.id)&&typeof channel.name==='string'&&channel.name.trim().length>0&&channel.name.length<=200;
 return {handle,status:found?'found' as const:'unknown' as const,channel:found?{name:channel!.name.trim(),url:'https://www.youtube.com/channel/'+channel!.id}:null,checkedAt:new Date().toISOString(),notice:'Отсутствие совпадения не подтверждает, что адрес свободен. Окончательно проверьте его в YouTube Studio. Результат проверки не сохраняется.'};
}
