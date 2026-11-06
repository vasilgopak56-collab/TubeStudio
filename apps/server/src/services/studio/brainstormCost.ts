// A transparent estimate for ONE model call, not a hard spending cap or the full release workflow.
// No network, model invocation, or changing project/channel data.
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ApiError} from '../../lib/errors.js';
import {PriceSnapshotSchema,operationCost,type PriceSnapshot} from '../usagePricing.js';
export const BRAINSTORM_IDEAS_OUTPUT_LIMIT=8000;
const Ask=z.object({model:z.string().trim().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/),contextHash:z.string().regex(/^[a-f0-9]{64}$/),characters:z.number().int().min(1).max(100000),outputLimit:z.number().int().min(1).max(12000),purpose:z.enum(['brainstorm-ideas-one-call','brainstorm-brand-plan-one-call','brainstorm-planning-one-call']).default('brainstorm-ideas-one-call')}).strict();
/** Use the precise captured tariff's version; capturedAt alone doesn't bind prices. */
export function estimateBrainstormModelCall(raw:z.input<typeof Ask>,price:PriceSnapshot){
 const p=Ask.parse(raw),tariff=PriceSnapshotSchema.parse(price);
 if(tariff.provider!=='anymodel'||tariff.model!==p.model||tariff.kind!=='text')throw new ApiError('VALIDATION','Тариф не соответствует выбранной модели. Запрос не отправлен.',409);
 // This deliberately pessimistic input assumption is not a tokenizer or a provider guarantee.
 // The model may produce fewer/more billed units due to provider tokenization or reasoning.
 const inputTokens=Math.ceil(p.characters/2),outputTokens=p.outputLimit;
 const estimate=operationCost(tariff,{known:true,input:inputTokens,output:outputTokens});
 if(!tariff.known||estimate.usd===null)throw new ApiError('BUDGET_PRICE_UNKNOWN','Не удалось рассчитать цену: тариф модели неизвестен или устарел. Обновите каталог; запрос не отправлен.',402);
 const bound={version:1,...p,priceVersion:tariff.priceVersion,inputTokens,outputTokens,estimate};
 return {...bound,previewHash:createHash('sha256').update(JSON.stringify(bound)).digest('hex'),notice:'Предварительная оценка только одного текстового запроса, не всего мозгового штурма. Вход оценён примерно как 1 токен на 2 символа, выход — заданный лимит; фактическая токенизация, рассуждения и списание могут отличаться. Это не ограничение расходов. Другие этапы, G-Labs и повторные запросы в сумму не включены.'};
}
