import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {HELP_SECTIONS,helpIdForRoute} from '../../web/src/lib/help.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
test('audio help documents current JSON schema and a valid self-contained example',()=>{const s=HELP_SECTIONS.find(s=>s.id==='audio-storyboard')!;assert.ok(s);assert.equal(helpIdForRoute('/audio-storyboard'),'audio-storyboard');const j=JSON.parse(s.codeExample!.code);assert.equal(j.schema_version,'1.0');assert.equal(j.scenes[0].speech.start,'00:00:00.120');assert.equal(j.scenes[0].timeline.end,'00:00:02.000');assert.deepEqual(Object.keys(j.scenes[0]),['scene','filename','speech','timeline','text','concept','image_prompt','animation_prompt']);assert.deepEqual(j,JSON.parse(fs.readFileSync(path.join(root,'docs/audio-storyboard-json-example.json'),'utf8')));});
test('audio help covers optional script, review, exports, limits and backup caveat',()=>{const s=JSON.stringify(HELP_SECTIONS.find(s=>s.id==='audio-storyboard'));for(const term of ['Исходный сценарий','TXT','UTF-8','60 000','50 МБ','30 минут','JSON промптов','Полный JSON','Сверить со сценарием','Взять текст сценария','120 с','audio-storyboards','DATA_DIR','v0.12.2','OAuth','512 МиБ','сверка'])assert.ok(s.toLowerCase().includes(term.toLowerCase()),term);assert.ok(!s.includes('\uFFFD'));});
