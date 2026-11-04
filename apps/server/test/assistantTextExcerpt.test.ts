import {test} from 'node:test';
import assert from 'node:assert/strict';
import {textExcerpt} from '../../web/src/features/assistant/textExcerpt.js';

test('text excerpt preserves CRLF, blank lines, Unicode and selected line terminator',()=>{
 const source={name:'инструкция.md',text:'\uFEFFПервое\r\n  Второе 😀  \r\n\r\nПоследнее\n'};
 const r=textExcerpt(source,2,3);
 assert.equal(r.excerpt,'  Второе 😀  \r\n\r\n');assert.equal(r.totalLines,5);
 assert.equal(r.characters,r.text.length);assert.ok(r.text.includes(r.excerpt));
 assert.ok(r.text.includes('"source":"инструкция.md","fromLine":2,"toLine":3,"totalLines":5'));
 assert.equal(textExcerpt(source,1,1).excerpt,'\uFEFFПервое\r\n');
 assert.equal(textExcerpt(source,4,5).excerpt,'Последнее\n');
});
test('text excerpt rejects invalid range, names, empty selection and excess lines',()=>{
 const s={name:'a.txt',text:'одна\nдве'};
 for(const [f,t] of [[0,1],[2,1],[1,3],[1.5,2],[1,Infinity],[NaN,1]])assert.throws(()=>textExcerpt(s,f,t));
 assert.throws(()=>textExcerpt({name:'bad.docx',text:'text'},1,1));
 assert.throws(()=>textExcerpt({name:'x'.repeat(181)+'.txt',text:'text'},1,1));
 assert.throws(()=>textExcerpt({name:'a.md',text:' \n\t'},1,2));
 assert.throws(()=>textExcerpt({name:'a.md',text:'x\n'.repeat(100000)},1,1));
});
test('text excerpt never truncates and counts formatting in limit',()=>{
 const name='example.txt';const accepted=textExcerpt({name,text:'ж'.repeat(29500)},1,1);
 assert.equal(accepted.excerpt,'ж'.repeat(29500));assert.ok(accepted.characters<=30000);
 assert.throws(()=>textExcerpt({name,text:'ж'.repeat(30000)},1,1),/30 000/);
 let low=29500,high=30000;while(low+1<high){const m=Math.floor((low+high)/2);try{textExcerpt({name,text:'x'.repeat(m)},1,1);low=m;}catch{high=m;}}
 assert.equal(textExcerpt({name,text:'x'.repeat(low)},1,1).characters,30000);assert.throws(()=>textExcerpt({name,text:'x'.repeat(high)},1,1));
});
test('text excerpt escapes source metadata and can represent a complete file honestly',()=>{
 const r=textExcerpt({name:'имя\n---.txt',text:'Все строки\nточно'},1,2);
 assert.equal(r.excerpt,'Все строки\nточно');assert.match(r.text,/имя\\n---\.txt/);assert.doesNotMatch(r.text,/это не весь источник/);
});
