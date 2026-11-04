import {randomUUID} from 'node:crypto';
import {Hono,type MiddlewareHandler} from 'hono';
import {bodyLimit} from 'hono/body-limit';
import {z} from 'zod';
import {ApiError,fail,ok} from '../lib/errors.js';
import {runTask} from '../lib/taskContext.js';
import {priceConsents, type PriceConsentBroker} from '../services/priceConsent.js';
const Owner=z.string().uuid();
/** Optional capability scope only. No body read, consent, or provider calls on opening a page. */
export const priceConsentScope:MiddlewareHandler=async(c,next)=>{
 const owner=Owner.safeParse(c.req.header('x-ts-launch-id'));
 if(!owner.success)return next();
 return runTask({launch:{owner:owner.data,requestId:randomUUID(),route:c.req.path}},next);
};
export function createPriceConsentRoute(broker:PriceConsentBroker=priceConsents){
 const route=new Hono();
 route.use('/budget/consents/*',bodyLimit({maxSize:2048,onError:c=>fail(c,new ApiError('VALIDATION','Решение слишком большое.',413))}));
 route.use('/budget/consents*',async(c,next)=>{
  const origin=c.req.header('origin');if(origin&&origin!==new URL(c.req.url).origin)return fail(c,new ApiError('UNAUTHORIZED','Подтверждение разрешено только в исходном приложении.',403));
  if(!Owner.safeParse(c.req.header('x-ts-launch-id')).success)return fail(c,new ApiError('UNAUTHORIZED','Нужна область исходного запуска.',403));
  return next();
 });
 route.get('/budget/consents',c=>ok(c,{pending:broker.list(c.req.header('x-ts-launch-id')!)}));
 route.post('/budget/consents/:id/decision',async c=>{try{
  const id=z.string().uuid().parse(c.req.param('id'));
  const input=z.object({scopeHash:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(['approve','deny'])}).strict().parse(await c.req.json().catch(()=>{throw new ApiError('VALIDATION','Решение должно быть корректным JSON.');}));
  return ok(c,{accepted:broker.decide(c.req.header('x-ts-launch-id')!,id,input.scopeHash,input.decision)});
 }catch(e){return fail(c,e);}});
 return route;
}
export const priceConsentRoute=createPriceConsentRoute();
