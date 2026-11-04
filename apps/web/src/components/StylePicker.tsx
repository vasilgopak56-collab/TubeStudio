import { Link } from "react-router-dom";
import { useVisualStyles, motionName } from "@/lib/visualStyles";
import { Select } from "@/components/ui";
export function StylePicker({value,onChange,disabled}:{value?:string;onChange:(id:string)=>void;disabled?:boolean}) {
 const q=useVisualStyles(); const selected=q.data?.find(s=>s.id===value);
 return <section className="native-visual-ui space-y-2 rounded-lg border p-3" aria-label="Выбор из библиотеки стилей">
  <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="visual-style-select" className="text-sm font-semibold">Стиль из библиотеки</label><Link className="text-sm text-primary underline" to="/styles">Открыть библиотеку</Link></div>
  <Select id="visual-style-select" disabled={disabled||q.isLoading} value={value||""} onChange={e=>onChange(e.target.value)}>
   <option value="">Не использовать — прежний стиль / пресет</option>
   {!!value&&!selected&&<option value={value}>Стиль недоступен — выберите другой</option>}
   {[...new Set(q.data?.map(s=>s.group)??[])].map(g=><optgroup label={g} key={g}>{q.data?.filter(s=>s.group===g).map(s=><option value={s.id} key={s.id}>{s.name}{!s.builtin?" · свой":""}</option>)}</optgroup>)}
  </Select>
  {q.error&&<p role="alert" className="text-sm text-red-500">Библиотека не загружена. <button type="button" className="underline" onClick={()=>q.refetch()}>Повторить</button></p>}
  {selected?<><p className="text-sm text-muted-foreground">{selected.description}</p><p className="text-sm text-muted-foreground">{motionName[selected.motionKind]}. Заменяет визуальный пресет и отрисовку ниши, не текст сценария. Поле «Свой стиль» имеет приоритет.</p></>:<p className="text-sm text-muted-foreground">Без выбора здесь всё работает как прежде. Добавляйте свои стили в библиотеке.</p>}
  {!!value&&!selected&&!q.isLoading&&!q.error&&<p role="alert" className="text-sm text-red-500">Стиль удалён или недоступен. Генерация с этим выбором будет отклонена до обращения к AI.</p>}
 </section>;
}
