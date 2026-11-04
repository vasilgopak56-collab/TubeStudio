// Test-only preload. No request falls through to the real network.
import fs from 'node:fs/promises';
const control = process.env.TS_TEST_GEOGRAPHY_CONTROL;
if (!control) throw Error('Synthetic geography provider requires an explicit control file');
globalThis.fetch = async input => {
 const u = new URL(String(input));
 if (u.origin !== 'https://youtubeanalytics.googleapis.com' || u.pathname !== '/v2/reports') throw Error('Unexpected external request blocked by test fixture');
 const q = Object.fromEntries(u.searchParams); await fs.appendFile(control + '.calls', JSON.stringify(q) + '\n');
 const mode = JSON.parse(await fs.readFile(control, 'utf8')).mode;
 const names = q.metrics.split(','); const columnHeaders = [...(q.dimensions ? [{ name: q.dimensions }] : []), ...names.map(name => ({ name }))];
 if (q.dimensions !== 'country') return new Response(JSON.stringify({ columnHeaders, rows: q.dimensions ? [] : [names.map(() => 0)] }));
 if (mode === 'denied') return new Response(JSON.stringify({ error: { message: 'Тест: география недоступна для этого подключения' } }), { status: 403 });
 if (mode === 'malformed') return new Response(JSON.stringify({ columnHeaders: [], rows: [] }));
 const rows = mode === 'empty' ? undefined : mode === 'zero' ? [['US', 0, 0]] : mode === 'unknown' ? [['US', null, 10], ['ZZ', 5, null]] : mode === 'limit' ? Array.from({length:250},(_,i)=>[String.fromCharCode(65+Math.floor(i/26))+String.fromCharCode(65+i%26),1,2]) : [['US',90,180],['ZZ',10,20],['JP',0,0]];
 return new Response(JSON.stringify({ columnHeaders, ...(rows ? { rows } : {}) }));
};
