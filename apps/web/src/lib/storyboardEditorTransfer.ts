/** Temporary, same-origin transfer to a newly opened tab. Not a saved version. */
export type EditorTransfer = {source:'script-editor-v1'; text:string; projectId?:string; edited:boolean};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const key=(id:string)=>`ts:storyboard-editor-transfer:${id}`;
export function validEditorTransfer(x:unknown):x is EditorTransfer {
 if(!x||typeof x!=='object'||Array.isArray(x))return false;
 const v=x as Record<string,unknown>;
 return Object.keys(v).every(k=>['source','text','projectId','edited'].includes(k))&&v.source==='script-editor-v1'&&typeof v.text==='string'&&v.text.trim().length>=200&&v.text.length<=60000&&(v.projectId===undefined||(typeof v.projectId==='string'&&uuid.test(v.projectId)))&&typeof v.edited==='boolean';
}
export function openStoryboardEditorTransfer(data:EditorTransfer):void {
 if(!validEditorTransfer(data))throw new Error('Для передачи нужен текст от 200 непустых до 60 000 символов и корректный проект. Текст не обрезается.');
 let id:string;try{id=crypto.randomUUID();sessionStorage.setItem(key(id),JSON.stringify(data));}catch{throw new Error('Не удалось подготовить временную передачу. Сценарий остался в редакторе; сохраните его и проверьте доступность хранилища браузера.');}
 try {
  const tab=window.open('/storyboard?editorTransfer='+encodeURIComponent(id),'_blank');
  if(!tab)throw new Error('Не удалось открыть вкладку раскадровки. Разрешите всплывающие окна и попробуйте ещё раз; сценарий остался в редакторе.');
  try{tab.opener=null;}catch{/* не меняет передаваемый текст */}
 }finally{try{sessionStorage.removeItem(key(id));}catch{/* временная копия остаётся только в текущей сессии */}}
}
/** Pure read before useEffect clears the child copy, tolerating React StrictMode. */
export function readStoryboardEditorTransfer(id:string|null):EditorTransfer|null {
 if(!id||!uuid.test(id))return null;
 try{const raw=sessionStorage.getItem(key(id));if(!raw)return null;const data:unknown=JSON.parse(raw);return validEditorTransfer(data)?data:null;}catch{return null;}
}
export function clearStoryboardEditorTransfer(id:string|null):void {if(!id||!uuid.test(id))return;try{sessionStorage.removeItem(key(id));}catch{/* storage may be unavailable */}}
