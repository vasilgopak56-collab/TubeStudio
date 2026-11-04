import {useEffect,useState} from 'react';
import {Button} from '@/components/ui';
import type {EditorTransfer} from '@/lib/storyboardEditorTransfer';

type Draft={script:string;projectId?:string};
export function StoryboardEditorTransfer({value,draft,draftFingerprint,running,onApply,onCancel}:{value:EditorTransfer|null;draft:Draft;draftFingerprint:string;running:boolean;onApply:(data:EditorTransfer)=>void;onCancel:()=>void}){
 const [consent,setConsent]=useState(false);
 useEffect(()=>{setConsent(false);},[draftFingerprint,running]);
 return <section className="mb-4 space-y-3 rounded-lg border p-4" aria-label="Передача из редактора сценария">
  <h2 className="font-semibold">Текст из редактора сценариста</h2>
  {!value?<p className="text-sm">Временная передача недоступна или уже использована. Вернитесь в открытую вкладку сценариста и отправьте текст заново. Текущий черновик не изменён.</p>:<>
   <p className="text-sm">Это копия текста на момент нажатия, {value.edited?'отличающийся от открытого результата':'из открытого результата'}. Изменения в исходной вкладке не синхронизируются. Исходная вкладка остаётся открытой; это не подтверждение сохранённой версии или её происхождения.</p>
   <p className="text-xs break-words [overflow-wrap:anywhere]">Проект для нового черновика: {value.projectId||'нет'} · {value.text.length} символов. Привязка проекта не проверена.</p>
   <details><summary>Текущий черновик · {draft.script.length} символов</summary><p className="text-xs break-all">Текущий проект: {draft.projectId||'нет'}</p><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{draft.script||'(пусто)'}</pre></details>
   <details open><summary>Переданный текст целиком</summary><pre className="whitespace-pre-wrap break-words text-xs [overflow-wrap:anywhere]">{value.text}</pre></details>
   <p className="text-xs text-muted-foreground">При применении заменятся текст и привязка проекта; остальные настройки сохранятся. Показанный результат будет убран с экрана, сохранённые записи не удаляются. AI не запускается. До применения обновление этой вкладки отменит передачу.</p>
   <label className="flex gap-2 text-sm"><input type="checkbox" aria-label="Подтверждаю текст из редактора" checked={consent} disabled={running} onChange={e=>setConsent(e.target.checked)}/>Проверил оба текста; заменить черновик без генерации.</label>
   <Button type="button" size="sm" disabled={!consent||running} onClick={()=>onApply(value)}>Применить текст из редактора</Button>
  </>}
  <Button type="button" size="sm" variant="outline" onClick={onCancel}>Отменить передачу из редактора</Button>
 </section>;
}
