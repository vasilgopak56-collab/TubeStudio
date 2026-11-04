import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {CONTENT_LANGUAGES} from '../../web/src/lib/constants.js';
import {LANG_NAME,defaultTtsModel} from '../src/services/languages.js';
import {findMarkers} from '../src/services/aiHeuristics.js';
import {scanVoice} from '../src/services/humanVoice.js';
import {checkScript} from '../src/services/scriptCheck.js';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ts-languages-'));process.env.DATA_DIR=dir;
const {analyzeVoice,saveVoiceProfile,activeVoicePrompt}=await import('../src/services/channelVoice.js');
after(()=>fs.rmSync(dir,{recursive:true,force:true}));
const requested=['ru','uk','sr','fr','pt','es','it','en','de','he','ar','vi','ja','ko','zh','id','hi','tr'];
test('all 18 requested language codes plus legacy Polish match server prompt names',()=>{
 assert.deepEqual(CONTENT_LANGUAGES.map(x=>x.value),[...requested,'pl']);
 assert.equal(new Set(CONTENT_LANGUAGES.map(x=>x.value)).size,19);
 assert.deepEqual(new Set(CONTENT_LANGUAGES.map(x=>x.value)),new Set(Object.keys(LANG_NAME)));
 for(const c of requested)assert.ok(LANG_NAME[c]&&CONTENT_LANGUAGES.find(x=>x.value===c)?.label);
 assert.equal(LANG_NAME.he,'Hebrew');assert.equal(LANG_NAME.id,'Indonesian');assert.equal(LANG_NAME.sr,'Serbian');
});
test('voice passports preserve each selected language, do not relabel it as Russian',()=>{
 for(const c of requested){const p=analyzeVoice(['Une histoire calme. Chaque jour commence autrement.'],c);assert.equal(p.language,c);if(!['ru','en'].includes(c))assert.equal(p.address,'neutral');}
});
test('channel voice requires exact matching language, including non-English pairs',async()=>{
 await saveVoiceProfile({enabled:true,language:'fr',samples:[{title:'Exemple',text:'Une histoire calme commence au petit matin. '.repeat(12)}]});
 assert.ok((await activeVoicePrompt('fr')).includes('CHANNEL VOICE'));
 for(const c of ['ru','es','he','en'])assert.equal(await activeVoicePrompt(c),'');
});
test('non-RU/EN checks never silently use English or Russian marker dictionaries',()=>{
 const text='This pivotal moment. В современном мире. It is important to note the story.';
 assert.ok(findMarkers(text,'en').length>0);assert.ok(findMarkers(text,'ru').length>0);
 for(const c of requested.filter(x=>!['ru','en'].includes(x))){assert.deepEqual(findMarkers(text,c),[]);assert.equal(scanVoice(text,c).filter(h=>['§10','§12','§13'].includes(h.rule)).length,0);}
});
test('default TTS voice matches language instead of reusing a Russian Edge voice',()=>{
 const voices=[{model:'edge-tts/ru-RU-DmitryNeural'},{model:'edge-tts/fr-FR-HenriNeural'},{model:'edge-tts/he-IL-AvriNeural'}];
 assert.equal(defaultTtsModel('fr','edge-tts/ru-RU-DmitryNeural',voices),'edge-tts/fr-FR-HenriNeural');
 assert.equal(defaultTtsModel('he','edge-tts/ru-RU-DmitryNeural',voices),'edge-tts/he-IL-AvriNeural');
 assert.equal(defaultTtsModel('ja','edge-tts/ru-RU-DmitryNeural',voices),'fish-farm/s2.1-pro-free');
 assert.equal(defaultTtsModel('ar','fish-farm/s2.1-pro-free',voices),'fish-farm/s2.1-pro-free');
});
test('script CTA checks recognize the requested new languages without English fallback',()=>{
 for(const [language,cta] of Object.entries({sr:'претплатите',it:'iscriviti',he:'להירשם',ar:'اشتراك',vi:'đăng ký',ja:'チャンネル登録',ko:'구독',zh:'订阅',id:'berlangganan',hi:'सदस्यता',tr:'abone'})){
 const r=checkScript('a'.repeat(40)+' '+cta+' '+'b'.repeat(60)+'?',{language,cta:true});assert.notEqual(r.metrics.ctaPos,null,language);assert.ok(!r.errors.some(x=>x.includes('Нет призыва')),language);
 }
});
