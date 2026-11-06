// Draft validation and deterministic 4-week scheduling; no changes and no provider calls.
import {z} from 'zod';import {ApiError} from '../../lib/errors.js';
const t=(max:number)=>z.string().trim().min(1).max(max);
const Video=z.object({title:t(180),pillar:t(100),thumbnailText:t(120),hook:t(700),whyNow:t(700),shortsIdea:t(700)}).strict();
const Profile=z.object({niche:t(300),audience:t(500),format:t(300),style:t(4000),skills:t(20000),language:z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),lengthMin:z.number().min(1).max(120)}).strict();
export const BrandPlanProposal=z.object({
 brand:z.object({name:t(80),handleCandidate:z.string().trim().regex(/^@?[A-Za-z0-9._-]{3,30}$/),description:t(4000),keywords:z.array(t(80)).min(4).max(20),playlists:z.array(t(100)).min(2).max(8),palette:z.array(z.string().regex(/^#[A-Fa-f0-9]{6}$/)).min(3).max(6),thumbnailFormula:t(900),titleFormula:t(900),structure:t(1200),intro:t(800),outro:t(800),voiceAndSound:t(800),styleAnchor:t(2000),imageBriefs:z.object({avatar:t(2000),banner:t(2000),preview1:t(2000),preview2:t(2000)}).strict()}).strict(),
 pillars:z.array(t(100)).min(3).max(4),profile:Profile,videos:z.array(Video).length(12),backupTopics:z.array(t(180)).min(20).max(40),pilotReview:t(1200),youtubeChecklist:z.array(t(400)).min(1).max(15),
}).strict();
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{const d=new Date(s+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s&&s>='1970-01-01'&&s<='2099-12-01';},'Нужна существующая дата');
const norm=(s:string)=>s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
const dates=(start:string,n:number)=>{const d=new Date(start+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
/** 12 proposals in 28 days, not a claim of an optimal posting time or a calendar write. */
export function buildBrandPlan(raw:unknown,startDate:string){
 const p=BrandPlanProposal.safeParse(raw),start=date.safeParse(startDate);
 if(!p.success||!start.success)throw new ApiError('VALIDATION','Черновик оформления или дата начала не прошли проверку. Ничего не изменено.',400);
 const b=p.data,keys=b.pillars.map(norm);if(new Set(keys).size!==keys.length)throw new ApiError('VALIDATION','Названия рубрик повторяются. Ничего не изменено.',400);
 if(b.videos.some(v=>!keys.includes(norm(v.pillar))))throw new ApiError('VALIDATION','Ролик ссылается на неизвестную рубрику. Ничего не изменено.',400);
 const all=[...b.videos.map(v=>v.title),...b.backupTopics].map(norm);if(new Set(all).size!==all.length)throw new ApiError('VALIDATION','Темы плана и запасные темы повторяются. Ничего не изменено.',400);
 const offsets=[0,2,4,7,9,11,14,16,18,21,23,25];
 const videos=b.videos.map((v,i)=>({...v,number:i+1,date:dates(start.data,offsets[i]),slot:(i<3?'pilot':i===8||i===11?'flexible':'planned') as 'pilot'|'flexible'|'planned'}));
 const {imageBriefs,...brand}=b.brand;
 return {version:1 as const,brand:{...brand,handleCandidate:brand.handleCandidate.replace(/^@/,''),handleAvailability:'not-checked' as const},pillars:b.pillars,profile:b.profile,videos,backupTopics:b.backupTopics,pilotReview:{date:dates(start.data,6),instructions:b.pilotReview},youtubeChecklist:b.youtubeChecklist,
  images:[{kind:'avatar' as const,target:'800×800',brief:imageBriefs.avatar},{kind:'banner' as const,target:'2560×1440',brief:imageBriefs.banner},{kind:'preview1' as const,target:'16:9',brief:imageBriefs.preview1},{kind:'preview2' as const,target:'16:9',brief:imageBriefs.preview2}],
  notice:'Это черновик модели: спрос, актуальность и факты требуют проверки. Адрес @ не проверен. Даты — пример на 28 дней, не рекомендация времени публикации. Гибкие слоты меняются после разбора пилотов. Профиль, календарь и G-Labs не изменены; размеры картинок — цели, изображения ещё не созданы.'};
}
