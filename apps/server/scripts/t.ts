import { generateText } from "../src/services/llm.ts";
for (let i=0;i<2;i++){ const t=Date.now(); const r = await generateText({ system: "Answer briefly", user: "Назови 3 факта о каменном веке, по одному предложению." , maxTokens: 400}); console.log(r.model, ((Date.now()-t)/1000).toFixed(1)+"s", r.text.slice(0,80)); }
