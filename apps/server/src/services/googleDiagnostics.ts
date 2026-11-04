import { ApiError } from '../lib/errors.js';

export type GoogleService = 'youtube-reporting' | 'youtube-data';
export type GoogleFailureReason = 'service_disabled' | 'insufficient_scopes' | 'quota_exceeded' | 'rate_limited' | 'access_denied' | 'unauthenticated' | 'not_found' | 'upstream_unavailable' | 'unknown';
const MAX_ERROR_BYTES = 16 * 1024;
const READ_TIMEOUT_MS = 1500;
const legacy = new Map<string, GoogleFailureReason>([
  ['accessNotConfigured', 'service_disabled'], ['insufficientPermissions', 'insufficient_scopes'],
  ['quotaExceeded', 'quota_exceeded'], ['dailyLimitExceeded', 'quota_exceeded'],
  ['rateLimitExceeded', 'rate_limited'], ['userRateLimitExceeded', 'rate_limited'],
  ['forbidden', 'access_denied'], ['authError', 'unauthenticated'],
]);
const modern = new Map<string, GoogleFailureReason>([
  ['SERVICE_DISABLED', 'service_disabled'], ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficient_scopes'],
  ['QUOTA_EXCEEDED', 'quota_exceeded'], ['RATE_LIMIT_EXCEEDED', 'rate_limited'],
]);
function compatible(reason: GoogleFailureReason, status: number) {
  if (reason === 'unauthenticated') return status === 401;
  if (reason === 'rate_limited' || reason === 'quota_exceeded') return status === 403 || status === 429;
  return status === 403;
}
/** Never trust provider prose, URLs, metadata, project IDs or arbitrary reason strings. */
export function classifyGoogleFailure(status: number, payload?: unknown): {reason: GoogleFailureReason; evidence: 'google_reason' | 'http_status' | 'none'} {
  const error = payload && typeof payload === 'object' ? (payload as any).error : null;
  const found = new Set<GoogleFailureReason>();
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    for (const item of Array.isArray(error.errors) ? error.errors.slice(0, 10) : []) {
      const reason = item && typeof item.reason === 'string' ? legacy.get(item.reason) : undefined;
      if (reason && compatible(reason, status)) found.add(reason);
    }
    for (const item of Array.isArray(error.details) ? error.details.slice(0, 10) : []) {
      if (!item || item['@type'] !== 'type.googleapis.com/google.rpc.ErrorInfo' || item.domain !== 'googleapis.com') continue;
      const reason = typeof item.reason === 'string' ? modern.get(item.reason) : undefined;
      if (reason && compatible(reason, status)) found.add(reason);
    }
  }
  // Generic forbidden adds no competing explanation when a precise reason is supplied.
  if (found.size > 1) found.delete('access_denied');
  // Contradictory precise signals must not become a confident diagnosis.
  if (found.size > 1) return {reason: 'unknown', evidence: 'none'};
  if (found.size === 1) return {reason: [...found][0], evidence: 'google_reason'};
  if (status === 401) return {reason: 'unauthenticated', evidence: 'http_status'};
  if (status === 404 || status === 410) return {reason: 'not_found', evidence: 'http_status'};
  if (status === 429) return {reason: 'rate_limited', evidence: 'http_status'};
  if (status >= 500 && status <= 599) return {reason: 'upstream_unavailable', evidence: 'http_status'};
  return {reason: 'unknown', evidence: 'none'};
}
async function safeErrorPayload(response: Response): Promise<unknown> {
  const cancel = () => { void response.body?.cancel().catch(() => {}); };
  if (response.status >= 300 && response.status < 400) { cancel(); return; }
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type && type !== 'application/json' && !/^application\/[a-z0-9.+-]+\+json$/.test(type)) { cancel(); return; }
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_ERROR_BYTES) { cancel(); return; }
  const reader = response.body?.getReader();
  if (!reader) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = async () => {
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_ERROR_BYTES) throw new Error('LIMIT');
        chunks.push(part.value);
      }
      return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks)));
    };
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('TIMEOUT')), READ_TIMEOUT_MS); })]);
  } catch { return; }
  finally {
    if (timer) clearTimeout(timer);
    // Cancellation is best effort and must not block returning the redacted diagnostic.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Fixed diagnostic projection only. No raw Google response is returned or logged. */
export async function googleFailure(response: Response, service: GoogleService, method: 'GET' | 'POST' | 'DELETE'): Promise<ApiError> {
  const {reason, evidence} = classifyGoogleFailure(response.status, await safeErrorPayload(response));
  const label = service === 'youtube-reporting' ? 'YouTube Reporting API' : 'YouTube Data API (проверка канала)';
  const api = service === 'youtube-reporting' ? 'YouTube Reporting API' : 'YouTube Data API v3';
  const hints: Record<GoogleFailureReason, string> = {
    service_disabled: `Google сообщил, что API выключен для проекта запроса. В Google Cloud выберите проект OAuth-клиента TubeStudio и включите ${api}. После включения подождите несколько минут.`,
    insufficient_scopes: 'Google сообщил, что у OAuth-токена недостаточно разрешений. Проверьте выданный доступ к чтению YouTube и аналитики; при необходимости повторите подключение нужного канала. Не пересоздавайте OAuth-клиент и не запрашивайте финансовые права только ради Reach Basic.',
    quota_exceeded: 'Google сообщил об исчерпании квоты. Проверьте Quotas в Google Cloud для проекта OAuth-клиента; частые повторы не восстанавливают квоту. Это не сообщение о балансе AI.',
    rate_limited: 'Google ограничил частоту запросов. Подождите и проверьте лимиты запросов в Google Cloud. Автоматических повторов здесь нет.',
    access_denied: 'Google отказал в доступе без более точной причины. Проверьте, что выбран нужный канал, аккаунту разрешён доступ и используется правильный проект OAuth-клиента. Один HTTP 403 не доказывает, что API выключен.',
    unauthenticated: 'Google не принял авторизацию. Проверьте подключение; если ошибка сохраняется, повторно подключите нужный канал. Не присылайте токены или Client secret в чат.',
    not_found: 'Запрошенный ресурс не найден или больше недоступен. Обновите список заданий/отчётов и выберите доступный ресурс; точную причину истечения или удаления по одному статусу определить нельзя.',
    upstream_unavailable: 'На стороне Google возникла серверная ошибка. Повторите чтение позже; исход команды создания или удаления перед повтором проверьте по списку заданий.',
    unknown: `Точная причина не распознана. Проверьте включение ${api} в проекте OAuth-клиента, разрешения и доступность ресурса. По одному HTTP ${response.status} нельзя выбрать единственную причину.`,
  };
  const next = method === 'GET'
    ? ' Запрос автоматически не повторялся. Если ошибка появилась после команды создания или удаления, сначала проверьте список заданий.'
    : ' Команда автоматически не повторялась. Перед повторным созданием или удалением сначала обновите список заданий; не повторяйте команду вслепую.';
  return new ApiError('UPSTREAM', `${label} ответил HTTP ${response.status}. ${hints[reason]}${next}`, 502, false,
    {provider: service, upstreamStatus: response.status, reason, evidence, method});
}
