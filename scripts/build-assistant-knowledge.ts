// Deterministic local export. No model calls; HELP remains the single source.
import fs from 'node:fs';
import {HELP} from '../apps/web/src/lib/help.ts';
const entries=HELP.flatMap(g=>g.sections).map(s=>({id:s.id,title:s.title,route:s.route??'/help',short:s.short,what:s.what,steps:s.steps??[],details:s.details??[],cost:s.cost??''}));
const text='// Generated from apps/web/src/lib/help.ts by scripts/build-assistant-knowledge.ts\nexport const ASSISTANT_KNOWLEDGE = '+JSON.stringify(entries,null,2)+' as const;\n';
fs.writeFileSync(new URL('../apps/server/src/services/assistantKnowledge.ts',import.meta.url),text);
console.log('Exported '+entries.length+' help entries');
