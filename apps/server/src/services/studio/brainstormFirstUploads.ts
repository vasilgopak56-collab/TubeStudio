// Оценка только доступных публичных загрузок. Сеть предоставляется вызывающим кодом;
// сама функция не расходует квоту и не доказывает отсутствие удалённых/скрытых роликов.
import {checkCancelled, taskSignal, withTaskSignal} from '../../lib/taskContext.js';

const DAY = 86_400_000;
const channelPattern = /^UC[A-Za-z0-9_-]{22}$/;
const uploadsPattern = /^UU[A-Za-z0-9_-]{22}$/;
const videoPattern = /^[A-Za-z0-9_-]{11}$/;
const record = (value: unknown): Record<string, unknown> | null =>
 value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

// YouTube возвращает RFC 3339 timestamps. Принимаем UTC с точностью до миллисекунды;
// не нормализуем несуществующие дни и не подставляем приблизительные даты.
function utcTimestamp(value: unknown): number | null {
 if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
 const time = Date.parse(value);
 if(!Number.isFinite(time)) return null;
 const [base, fraction = ''] = value.slice(0,-1).split('.');
 return new Date(time).toISOString() === `${base}.${fraction.padEnd(3,'0')}Z` ? time : null;
}

export type UploadObservation = {
 channelId: string;
 playlistId: string;
 observedAt: string;
 pagesRead: number;
 validPublicCount: number;
 complete: boolean;
 reason: 'complete' | 'empty' | 'page-limit' | 'invalid-page' | 'invalid-item' | 'invalid-token';
 earliest: {videoId: string; url: string; publishedAt: string; ageDays: number} | null;
 // 'new' означает только, что полная доступная выборка не старше 150 дней.
 freshness: 'new' | 'not-new' | 'unknown';
};

/** playlistId должен быть получен из contentDetails.relatedPlaylists.uploads этого канала,
 * а не выведен из его идентификатора. Любые сетевые ошибки передаются вызывающему коду. */
export async function inspectFirstVisibleUploads(
 input: {channelId: string; playlistId: string; observedAt: string; maxPages: number; signal?: AbortSignal},
 fetchPage: (playlistId: string, pageToken: string | undefined, signal?: AbortSignal) => Promise<unknown>,
): Promise<UploadObservation> {
 if(!channelPattern.test(input.channelId) || !uploadsPattern.test(input.playlistId)) throw new Error('Invalid channel or verified uploads playlist ID');
 if(!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 3) throw new Error('Invalid page limit');
 const now = utcTimestamp(input.observedAt);
 if(now === null) throw new Error('Invalid observation timestamp');
 return withTaskSignal(input.signal, async () => {
  let token: string | undefined;
  let pagesRead = 0, validPublicCount = 0;
  let earliest: UploadObservation['earliest'] = null;
  let reason: UploadObservation['reason'] = 'page-limit';
  let invalidItem = false;
  const tokens = new Set<string>(), ids = new Set<string>();
  for(let pageNo=0; pageNo<input.maxPages; pageNo++) {
   checkCancelled();
   const value = await fetchPage(input.playlistId, token, taskSignal());
   checkCancelled();
   pagesRead++;
   const page = record(value);
   if(!page || !Array.isArray(page.items) || page.items.length > 50) {reason='invalid-page';break;}
   for(const entry of page.items) {
    const item=record(entry), details=record(item?.contentDetails), status=record(item?.status);
    const id=details?.videoId, publishedAt=details?.videoPublishedAt, time=utcTimestamp(publishedAt);
    if(typeof id !== 'string' || !videoPattern.test(id) || ids.has(id) || status?.privacyStatus !== 'public' || time === null || time > now) {invalidItem=true;continue;}
    ids.add(id);validPublicCount++;
    if(!earliest || time < Date.parse(earliest.publishedAt)) earliest={videoId:id,url:`https://www.youtube.com/watch?v=${id}`,publishedAt:publishedAt as string,ageDays:(now-time)/DAY};
   }
   const next=page.nextPageToken;
   if(next === undefined) {reason=invalidItem?'invalid-item':validPublicCount?'complete':'empty';break;}
   if(typeof next !== 'string' || !next.length || next.length>2048 || tokens.has(next)) {reason='invalid-token';break;}
   if(page.items.length===0) invalidItem=true;
   tokens.add(next);token=next;
  }
  const complete=reason==='complete';
  const freshness=earliest && earliest.ageDays>150?'not-new':complete && earliest?'new':'unknown';
  return {channelId:input.channelId,playlistId:input.playlistId,observedAt:input.observedAt,pagesRead,validPublicCount,complete,reason,earliest,freshness};
 });
}
