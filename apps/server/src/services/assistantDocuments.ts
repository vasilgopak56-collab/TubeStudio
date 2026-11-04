/** Local, text-only DOCX preview. No disk writes, URL resolution, office automation or model calls. */
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {Inflate} from 'fflate';
import {z} from 'zod';
import {ApiError} from '../lib/errors.js';
type XmlNode={local:string;uri:string;attributes:Record<string,{value:string}>};
type XmlParser={onopentag?:(n:XmlNode)=>void;onclosetag?:()=>void;ontext?:(s:string)=>void;oncdata?:(s:string)=>void;ondoctype?:()=>void;onerror?:(e:Error)=>void;write:(s:string)=>XmlParser;close:()=>void};
const sax=createRequire(import.meta.url)('sax') as {parser:(strict:boolean,opts:{xmlns:boolean})=>XmlParser};
const bad=(s:string)=>new ApiError('VALIDATION',s);
const MAX_FILE=180000,MAX_XML=2*1024*1024;
export const DocumentPreviewAsk=z.object({name:z.string().trim().min(1).max(180).regex(/\.docx$/i,'Нужен файл DOCX'),base64:z.string().min(4).max(240000).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,'Некорректные данные файла')}).strict();
function decode(b:Uint8Array){try{return new TextDecoder('utf-8',{fatal:true}).decode(b);}catch{throw bad('DOCX должен содержать корректный XML UTF-8.');}}
function crc32(b:Uint8Array){let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
type Entry={name:string;start:number;end:number;size:number;crc:number;method:number};
/** Read central/local headers before inflating. Never trust originalSize as an output bound. */
function entries(b:Buffer){
 if(b.length<22||b.length>MAX_FILE||b.readUInt32LE(0)!==0x04034b50)throw bad('Нужен обычный DOCX (ZIP) до 180 КБ, без пароля.');
 let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
 if(end<0)throw bad('DOCX повреждён: нет конца ZIP.');
 const count=b.readUInt16LE(end+10),cd=b.readUInt32LE(end+16),cdSize=b.readUInt32LE(end+12);
 if(b.readUInt16LE(end+4)||b.readUInt16LE(end+6)||b.readUInt16LE(end+8)!==count||!count||count>256||cd+cdSize!==end)throw bad('Многотомный, ZIP64 или слишком сложный DOCX не поддерживается.');
 let p=cd,total=0;const result:Entry[]=[],names=new Set<string>(),ranges:{start:number;end:number}[]=[];
 for(let n=0;n<count;n++){
  if(p+46>end||b.readUInt32LE(p)!==0x02014b50)throw bad('Повреждён каталог DOCX.');
  const flags=b.readUInt16LE(p+8),method=b.readUInt16LE(p+10),crc=b.readUInt32LE(p+16),packed=b.readUInt32LE(p+20),size=b.readUInt32LE(p+24),nl=b.readUInt16LE(p+28),extra=b.readUInt16LE(p+30),comment=b.readUInt16LE(p+32),local=b.readUInt32LE(p+42);
  if(p+46+nl+extra+comment>end||!nl||nl>512||flags&~0x80e||![0,8].includes(method)||b.readUInt16LE(p+34))throw bad('Зашифрованный или неподдерживаемый ZIP внутри DOCX.');
  const raw=b.subarray(p+46,p+46+nl),name=decode(raw);p+=46+nl+extra+comment;
  if(name.includes('\\')||name.startsWith('/')||name.includes(':')||name.includes('\0')||name.split('/').some(x=>x==='..'||x==='.')||names.has(name))throw bad('Небезопасные или повторяющиеся пути внутри DOCX.');names.add(name);
  total+=size;if(total>16*1024*1024)throw bad('Распакованный DOCX превышает 16 МиБ.');
  if(local+30>cd||b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method)throw bad('Несогласованные заголовки DOCX.');
  const ln=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),start=local+30+ln+le,endData=start+packed;
  if(endData>cd||ln!==nl||!b.subarray(local+30,local+30+ln).equals(raw))throw bad('Повреждённая часть DOCX.');
  if(!(flags&8)&&(b.readUInt32LE(local+14)!==crc||b.readUInt32LE(local+18)!==packed||b.readUInt32LE(local+22)!==size))throw bad('Размеры частей DOCX не совпадают.');
  ranges.push({start:local,end:endData});result.push({name,start,end:endData,size,crc,method});
 }
 if(p!==end)throw bad('Некорректный размер каталога DOCX.');ranges.sort((a,b)=>a.start-b.start);if(ranges.some((r,i)=>i>0&&r.start<ranges[i-1].end))throw bad('Перекрывающиеся части DOCX.');
 if(result.some(e=>/vbaProject|\.bin$|afchunk/i.test(e.name)))throw bad('DOCX с макросами, вложенными объектами или altChunk не принимается. Сохраните обычный текстовый DOCX.');
 return result;
}
function extract(b:Buffer,e:Entry,limit:number){
 if(e.size>limit)throw bad('XML-часть DOCX слишком велика.');let size=0;const chunks:Uint8Array[]=[];
 const take=(chunk:Uint8Array)=>{size+=chunk.length;if(size>limit||size>e.size)throw bad('Превышен лимит распаковки DOCX.');chunks.push(chunk.slice());};
 try{if(e.method===0)take(b.subarray(e.start,e.end));else{const stream=new Inflate(take);for(let i=e.start;i<e.end;i+=1024)stream.push(b.subarray(i,Math.min(i+1024,e.end)),i+1024>=e.end);}}catch(err){if(err instanceof ApiError)throw err;throw bad('Не удалось распаковать DOCX.');}
 const data=Buffer.concat(chunks);if(size!==e.size||crc32(data)!==e.crc)throw bad('Контрольная сумма DOCX не совпадает.');return decode(data);
}
function parse(xml:string,open:(n:XmlNode,parents:XmlNode[])=>void,text:(s:string,parents:XmlNode[])=>void,close:(n:XmlNode)=>void){
 if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw bad('DTD и пользовательские XML-сущности в DOCX запрещены.');
 const stack:XmlNode[]=[];let count=0;const parser=sax.parser(true,{xmlns:true});
 parser.ondoctype=()=>{throw bad('DTD в DOCX запрещён.');};parser.onerror=()=>{throw bad('Некорректный XML в DOCX.');};
 parser.onopentag=n=>{if(++count>100000||stack.length>=100)throw bad('XML DOCX слишком сложен.');open(n,stack);stack.push(n);};parser.onclosetag=()=>{close(stack.pop()!);};parser.ontext=s=>text(s,stack);parser.oncdata=parser.ontext;
 try{parser.write(xml).close();}catch(err){if(err instanceof ApiError)throw err;throw bad('Не удалось прочитать XML DOCX.');}
}
const WORD=new Set(['http://schemas.openxmlformats.org/wordprocessingml/2006/main','http://purl.oclc.org/ooxml/wordprocessingml/main']);
const isWord=(n:XmlNode,name?:string)=>WORD.has(n.uri)&&(!name||n.local===name);
export function previewAssistantDocument(raw:unknown){
 const input=DocumentPreviewAsk.parse(raw),bytes=Buffer.from(input.base64,'base64');if(bytes.toString('base64')!==input.base64)throw bad('Некорректные данные файла.');
 const all=entries(bytes),main=all.find(e=>e.name==='word/document.xml'),types=all.find(e=>e.name==='[Content_Types].xml');if(!main||!types)throw bad('В DOCX нет основной текстовой части.');
 let docx=false;parse(extract(bytes,types,65536),n=>{if(n.uri==='http://schemas.openxmlformats.org/package/2006/content-types'&&n.local==='Override'&&n.attributes.PartName?.value==='/word/document.xml'&&n.attributes.ContentType?.value==='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')docx=true;},()=>{},()=>{});
 if(!docx)throw bad('Поддерживается только обычный DOCX, не DOCM, шаблон или другой ZIP.');
 const warnings=new Set<string>(['Прочитан только текст основной части DOCX. Картинки, колонтитулы, сноски, комментарии, вложения и внешние ссылки не читаются.','Оформление и автоматическая нумерация списков не сохраняются. Сверьте порядок и полноту с оригиналом; это не проверка фактов или смысла.']);
 let root=false,body=false,value='',hiddenRun=false;const excluded=new Set(['drawing','pict','object','del','moveFrom','txbxContent','altChunk']);
 const add=(s:string)=>{value+=s;if(value.length>60000)throw bad('Текст DOCX превышает лимит 30 000 символов; сократите файл, автоматического обрезания нет.');};
 parse(extract(bytes,main,MAX_XML),(n,parents)=>{
  if(parents.length===0){if(!isWord(n,'document'))throw bad('Неверная основная часть DOCX.');root=true;}
  if(isWord(n,'body'))body=true;if(isWord(n,'r'))hiddenRun=false;
  if(isWord(n,'vanish')||isWord(n,'webHidden')){const val=Object.values(n.attributes).find(a=>(a as {local?:string}).local==='val')?.value;if(!['0','false','off'].includes(val??'')){hiddenRun=true;warnings.add('Скрытый текст пропущен.');}}
  if(isWord(n)&&['ins','del','moveFrom','moveTo'].includes(n.local))warnings.add('Есть исправления: включён вставленный текст, удалённый текст пропущен. Примите или отклоните исправления в Word перед использованием.');
  if(isWord(n,'altChunk'))throw bad('В DOCX есть altChunk: сохраните документ как обычный текстовый DOCX.');
  if(parents.some(p=>isWord(p,'body'))&&!parents.some(p=>isWord(p)&&excluded.has(p.local))&&!hiddenRun){if(isWord(n,'tab'))add('\t');if(isWord(n,'br')||isWord(n,'cr'))add('\n');}
 },(s,parents)=>{const last=parents.at(-1);if(last&&isWord(last,'t')&&parents.some(p=>isWord(p,'body'))&&!hiddenRun&&!parents.some(p=>isWord(p)&&excluded.has(p.local)))add(s);},n=>{if(isWord(n,'p'))add('\n');if(isWord(n,'tc'))add('\t');if(isWord(n,'tr'))add('\n');if(isWord(n,'r'))hiddenRun=false;});
 const text=value.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();if(!root||!body||!text)throw bad('В DOCX нет доступного текста основной части. Сканы и картинки требуют OCR, которого здесь нет.');if(text.length>30000)throw bad('Текст DOCX превышает 30 000 символов; сократите файл. Автоматического обрезания нет.');
 return {name:input.name,text,chars:text.length,sourceHash:createHash('sha256').update(bytes).digest('hex'),extraction:'docx-main-text' as const,warnings:[...warnings]};
}
