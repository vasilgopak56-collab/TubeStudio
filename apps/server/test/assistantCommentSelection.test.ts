import {test} from 'node:test';import assert from 'node:assert/strict';
import {commentChoices,filterCommentChoices,selectedCommentDraft} from '../../web/src/features/assistant/commentSelection.js';
const comment=(id:string,text:string,truncated=false)=>({id,text,truncated});
const source=(id:string,comments:ReturnType<typeof comment>[],commentsStatus='ok')=>({id,title:'Город',url:'https://www.youtube.com/watch?v=abcdefghijk',commentsStatus,comments});
test('comment selection keeps identical comment IDs from different sources separate and filters locally',()=>{
 const {rows,ambiguous}=commentChoices([source('source-1',[comment('id','Первый вопрос')]),source('source-2',[comment('id','Второй вопрос',true)])]);assert.equal(ambiguous,0);assert.equal(rows.length,2);assert.notEqual(rows[0].key,rows[1].key);assert.equal(rows[1].truncated,true);assert.deepEqual(filterCommentChoices(rows,'ВТОРОЙ').map(r=>r.sourceId),['source-2']);assert.equal(filterCommentChoices(rows,'город').length,2);assert.equal(filterCommentChoices(rows,'несуществующее').length,0);
});
test('ambiguous identifiers and unavailable sources are not selectable',()=>{
 const a=commentChoices([source('a',[comment('id','A'),comment('id','B'),comment('ok','C')]),source('x',[comment('x','X')]),source('x',[comment('y','Y')]),source('z',[comment('z','Z')],'unavailable')]);assert.equal(a.ambiguous,4);assert.deepEqual(a.rows.map(r=>r.commentId),['ok']);
});
test('draft retains exact text, uses source and comment IDs, limits selection and never truncates',()=>{
 const rows=commentChoices([source('s',[comment('c','private comment text')])]).rows;const d=selectedCommentDraft('Мой черновик\n',rows)!;assert.ok(d.startsWith('Мой черновик\n\n\n'));assert.ok(d.includes('{"sourceId":"s","commentId":"c"}'));assert.ok(!d.includes('private comment text'));assert.equal(selectedCommentDraft('x'.repeat(9999),rows),null);assert.equal(selectedCommentDraft('',[]),null);assert.equal(selectedCommentDraft('',[...rows,...rows]),null);
 const many=commentChoices([source('s',Array.from({length:21},(_,i)=>comment('c'+i,'Текст')))]).rows;assert.equal(selectedCommentDraft('',many),null);assert.ok(selectedCommentDraft('',many.slice(0,20)));
});
