// All provider traffic is synthetic and never leaves this test process.
import fs from 'node:fs';
globalThis.fetch=async(url,init={})=>{const u=String(url),method=init.method??'GET';
 if(method==='GET'&&u.endsWith('/models'))return Response.json({data:[{id:'fixture/audio',capabilities:{audioInput:true},billing:{unit:'token',coefficient:{input:1,output:1}}}]});
 if(method==='POST'&&u.endsWith('/chat/completions')){const body=JSON.parse(init.body);const n=Number(body.messages[1].content[0].text.match(/n=(\d+)/)[1]);fs.appendFileSync(process.env.TS_AUDIO_POSTS,`${n}\n`);return Response.json({choices:[{message:{content:`Речь фрагмента ${n}`}}],usage:{prompt_tokens:10,completion_tokens:5}});}
 throw Error('Unexpected outbound request blocked');
};
