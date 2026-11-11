// Помощник по всей программе: бесплатные действия «Собрать монтаж» и «Собрать Shorts».
// Запуск только кнопкой владельца. Сборка та же, что по кнопкам на страницах «Монтаж» и «Shorts», с теми же проверками.
// Принять ролик, принять Shorts и сохранить файлы Помощник не может: это делается на страницах после просмотра.
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
import type {JobCtx} from '../lib/jobs.js';
import {getChannel} from './studio/channels.js';
import {montageExporting} from './studio/montageExport.js';
import {montageBusy,renderMontage} from './studio/montageRender.js';
import {MAX_PICK,buildShorts,shortsState} from './studio/shortCuts.js';
import {visualBusy} from './studio/visual.js';

const ID=z.string().uuid();
export const MontageRenderAsk=z.object({projectId:ID,channelId:ID,confirmed:z.literal(true)}).strict();
export const ShortsBuildAsk=z.object({projectId:ID,channelId:ID,ids:z.array(z.string().regex(/^\d+-\d+$/)).min(1).max(MAX_PICK),confirmed:z.literal(true)}).strict();
export type MontageRenderAction=z.infer<typeof MontageRenderAsk>;
export type ShortsBuildAction=z.infer<typeof ShortsBuildAsk>;

/** Те же проверки, что у кнопок на страницах: вторая сборка или сохранение одновременно не начинаются. */
function idle(projectId:string){
 if(montageBusy(projectId))throw new ApiError('VALIDATION','Сборка этого ролика уже идёт.',409);
 if(montageExporting(projectId))throw new ApiError('VALIDATION','Идёт сохранение файлов этого ролика. Дождитесь окончания.',409);
}

/** Бесплатная проверка до запуска. Ничего не собирает. */
export async function reserveMontageRender(raw:unknown):Promise<MontageRenderAction>{
 const parsed=MontageRenderAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION','Сборка не подтверждена или не выбран ролик. Ничего не запущено.');
 const a=parsed.data;
 await getChannel(a.channelId);
 if(visualBusy(a.projectId))throw new ApiError('VALIDATION','В этом проекте идёт работа «Визуала». Дождитесь окончания.',409);
 idle(a.projectId);
 return a;
}
export const runMontageRenderAction=(a:MontageRenderAction,ctx:JobCtx,render:typeof renderMontage=renderMontage)=>render(a.projectId,ctx);

/** Монтаж должен быть принят, куски — из текущего списка страницы «Shorts». Ничего не собирает. */
export async function reserveShortsBuild(raw:unknown):Promise<ShortsBuildAction>{
 const parsed=ShortsBuildAsk.safeParse(raw);
 if(!parsed.success)throw new ApiError('VALIDATION',`Сборка не подтверждена, не выбран ролик или отмечено не от 1 до ${MAX_PICK} кусков. Ничего не запущено.`);
 const a=parsed.data;
 if(new Set(a.ids).size!==a.ids.length)throw new ApiError('VALIDATION','Один кусок отмечен дважды. Ничего не запущено.');
 await getChannel(a.channelId);
 idle(a.projectId);
 const s=await shortsState(a.projectId);
 if(s.blocker)throw new ApiError('VALIDATION',`${s.blocker} Ничего не запущено.`);
 if(a.ids.some(id=>!s.fragments.some(f=>f.id===id)))throw new ApiError('VALIDATION','Список кусков изменился. Выберите куски заново. Ничего не запущено.',409);
 return a;
}
export const runShortsBuildAction=(a:ShortsBuildAction,ctx:JobCtx,build:typeof buildShorts=buildShorts)=>build(a.projectId,{ids:a.ids},ctx);
