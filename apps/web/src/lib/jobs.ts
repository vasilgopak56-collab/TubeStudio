import { useCallback, useRef, useState } from "react";
import { api, ApiError } from "./api";

export type PriceChallenge = { id:string; scopeHash:string; jobId?:string; expiresAt:string; message:string; tasks:{provider:string;model:string;kind:string}[] };
export type JobState<T> = { status: "idle" | "running" | "done" | "error"; stage?: string; pct: number; data?: T; partial?: Partial<T>; error?: ApiError; consents?: PriceChallenge[]; consentError?: string };

/** POST → { jobId } → SSE /api/jobs/:id/stream */
export function useJob<T, I = unknown>(path: string) {
  const [state, setState] = useState<JobState<T>>({ status: "idle", pct: 0 });
  const es = useRef<EventSource | null>(null);
  const generation = useRef(0);
  const jobId = useRef<string | null>(null);
  const launch = useRef<string | null>(null);
  const deciding = useRef(new Set<string>());

  const start = useCallback(async (input: I, pathOverride?: string, options?: { serverConsent?: boolean }) => {
    const run = ++generation.current;
    es.current?.close(); jobId.current = null;
    const owner = options?.serverConsent ? crypto.randomUUID() : null; launch.current = owner;
    setState({ status: "running", pct: 1, stage: "Запуск" });
    try {
      const { jobId: id } = await api<{ jobId: string }>(pathOverride ?? path, { method: "POST", json: input, ...(owner ? {headers:{"x-ts-launch-id":owner}} : {}) });
      if (run !== generation.current) { await api(`/jobs/${id}/cancel`, { method: "POST" }); return; }
      jobId.current = id;
      const src = new EventSource(`/api/jobs/${id}/stream`);
      es.current = src;
      src.addEventListener("progress", (e) => { if (run !== generation.current) return; const d = JSON.parse((e as MessageEvent).data); setState((s) => ({ ...s, stage: d.stage, pct: d.pct })); });
      src.addEventListener("partial", (e) => { if (run !== generation.current) return; const d = JSON.parse((e as MessageEvent).data); setState((s) => ({ ...s, partial: { ...(s.partial ?? {}), ...d.data } })); });
      if (owner) {
        src.addEventListener("price-consent", (e) => { if(run!==generation.current)return; const c=JSON.parse((e as MessageEvent).data).consent as PriceChallenge; if(c.jobId!==id)return; setState(s=>({...s,consents:[...(s.consents??[]).filter(x=>x.id!==c.id),c]})); });
        src.addEventListener("price-consent-resolved", (e) => { if(run!==generation.current)return; const r=JSON.parse((e as MessageEvent).data).resolution; setState(s=>({...s,consents:(s.consents??[]).filter(c=>c.id!==r.id)})); });
        src.addEventListener("open",()=>{if(run===generation.current)setState(s=>({...s,consentError:undefined}));});
      }
      src.addEventListener("done", (e) => { if (run !== generation.current) return; jobId.current = null; const d = JSON.parse((e as MessageEvent).data); setState({ status: "done", pct: 100, data: d.data }); src.close(); });
      src.addEventListener("error", (e) => {
        if (run !== generation.current) return;
        const raw = (e as MessageEvent).data;
        if (!raw && owner) { const closed=src.readyState===EventSource.CLOSED; setState(s=>({...s,consentError:closed?"Поток закрыт. Задача может продолжаться; попробуйте остановить её и проверьте результат, прежде чем запускать снова.":"Связь прервана, повторно подключаемся. Задача может продолжаться; не запускайте её повторно. При необходимости нажмите «Остановить»."})); return; }
        jobId.current = null;
        if (raw) { const d = JSON.parse(raw); setState((s) => ({ ...s, status: "error", error: new ApiError(d.error.code, d.error.message) })); }
        else setState((s) => (s.status === "running" ? { ...s, status: "error", error: new ApiError("NETWORK", "Соединение с сервером прервано") } : s));
        src.close();
      });
    } catch (e) { if (run !== generation.current) return; setState({ status: "error", pct: 0, error: e as ApiError }); }
  }, [path]);

  const cancel = useCallback(async () => {
    const id = jobId.current;
    if (!id) { ++generation.current; es.current?.close(); jobId.current=null; setState({status:"idle",pct:0}); return; }
    try {
      await api(`/jobs/${id}/cancel`, { method: "POST" });
      ++generation.current; es.current?.close(); jobId.current=null;
      setState({ status: "idle", pct: 0 });
    } catch (e) {
      if (launch.current) setState(s=>({...s,consentError:"Не удалось подтвердить остановку. Задача может продолжаться; попробуйте остановить ещё раз и проверьте результат."}));
      else { ++generation.current; es.current?.close(); jobId.current=null; setState({ status: "error", pct: 0, error: e as ApiError }); }
    }
  }, []);

  const decideConsent = useCallback(async (challenge:PriceChallenge, decision:"approve"|"deny") => {
    const owner=launch.current; if(!owner || !jobId.current || challenge.jobId!==jobId.current || deciding.current.has(challenge.id))return;
    deciding.current.add(challenge.id);
    try { await api(`/budget/consents/${challenge.id}/decision`, {method:"POST",headers:{"x-ts-launch-id":owner},json:{scopeHash:challenge.scopeHash,decision}}); setState(s=>({...s,consents:(s.consents??[]).filter(c=>c.id!==challenge.id),consentError:undefined})); }
    catch(e){setState(s=>({...s,consentError:`Решение не подтверждено: ${(e as Error).message}. Не запускайте задачу повторно без проверки результата.`}));}
    finally {deciding.current.delete(challenge.id);}
  },[]);

  const set = useCallback((data: T) => setState({ status: "done", pct: 100, data }), []);
  return { ...state, start, cancel, set, decideConsent };
}
