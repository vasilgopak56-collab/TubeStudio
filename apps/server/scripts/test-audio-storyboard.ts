/** Opt-in paid smoke: AUDIO_TEST_FILE=/path/audio.mp3 ANYMODEL_API_KEY=... DATA_DIR=/tmp/... npx tsx scripts/test-audio-storyboard.ts
 * Never commit credentials. Uses the normal budget/model settings, prints progress but no secrets. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {uploadAudio,analyzeAudio,transcribeAudio,generateAudioStoryboard,PauseOptions,exportAudio,loadAudio} from '../src/services/audioStoryboard.js';
if(!process.env.AUDIO_TEST_FILE || !process.env.ANYMODEL_API_KEY)throw new Error('Set AUDIO_TEST_FILE and ANYMODEL_API_KEY; this smoke makes paid calls.');
const signal=new AbortController().signal;
const ctx={signal,progress:(stage:string,pct:number)=>console.log(pct,stage),partial:()=>{}};
const file=process.env.AUDIO_TEST_FILE;
let d=process.env.AUDIO_TEST_ID?await loadAudio(process.env.AUDIO_TEST_ID):await uploadAudio(path.basename(file),await fs.readFile(file));
if(!process.env.AUDIO_TEST_ID)d=await analyzeAudio({audioId:d.id,revision:d.revision,...PauseOptions.parse({minPause:.12,targetFragments:36})},ctx);
console.log('Measured:',d.duration,'seconds,',d.fragments.length,'fragments,',d.pauses.length,'internal pauses');
d=await transcribeAudio({audioId:d.id,revision:d.revision,model:process.env.AUDIO_TEST_MODEL??'ag/gemini-2.5-flash',onlyMissing:!!process.env.AUDIO_TEST_ID},ctx);
if(process.env.AUDIO_TEST_PROMPTS==='1')d=await generateAudioStoryboard({audioId:d.id,revision:d.revision,style:'universal',customStyle:'Cinematic historical documentary, photorealistic period-accurate details, muted earthy tones, natural light, subtle film grain, no text overlays.',imageModel:'flux',videoModel:'kling',clip:5},ctx);
const out=process.env.AUDIO_TEST_OUTPUT??'/tmp/tubestudio-audio-smoke';await fs.mkdir(out,{recursive:true});
for(const format of ['csv','txt','json','srt'])await fs.writeFile(path.join(out,`audio-storyboard-36.${format}`),exportAudio(d,format));
console.log('Saved',d.id,'rows:',d.result?.rows.length,'revision',d.revision,'output:',out);
