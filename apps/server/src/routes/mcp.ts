import { APP_VERSION } from "../lib/version.js";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { config } from "../config.js";
import { ok, fail } from "../lib/errors.js";
export const mcpRoute=new Hono();
mcpRoute.get("/mcp/info",async c=>{try{
 const scriptPath=fileURLToPath(new URL("../../../mcp/dist/index.js",import.meta.url));
 const built=await fs.stat(scriptPath).then(s=>s.isFile()).catch(()=>false);
 return ok(c,{version:APP_VERSION,transport:"stdio",readOnly:true,built,nodePath:process.execPath,scriptPath,dataDir:config.dataDir,defaultScopes:["projects","reports"],scopes:["projects","reports","transcripts","audio","ad-breaks","profit"],tools:["ts_status","ts_list_saved","ts_read_saved","ts_read_script","ts_read_transcript"]});
 }catch(e){return fail(c,e);}});
