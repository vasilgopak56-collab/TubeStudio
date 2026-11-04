import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { ApiError, ok, fail } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { DirectorWork, listDirector, loadDirector, saveDirector, deleteDirector, directorReport, directorApprove, directorCompile, directorZip, directorToProject, generateDirector, uploadDirectorAsset, readDirectorAsset } from "../services/director.js";
export const directorRoute=new Hono();
async function json(c:Context):Promise<unknown>{try{return await c.req.json();}catch{throw new ApiError("VALIDATION","Некорректный JSON",400);}}
directorRoute.use("/director/*",bodyLimit({maxSize:8*1024*1024,onError:c=>fail(c,new ApiError("VALIDATION","Запрос больше 8 МиБ",413))}));
directorRoute.use("/director/*",async(c,next)=>{c.header("Cache-Control","no-store");await next();});
directorRoute.get("/director/packages",async c=>{try{return ok(c,await listDirector());}catch(e){return fail(c,e);}});
directorRoute.get("/director/packages/:id",async c=>{try{const raw=c.req.query("revision");const rev=raw===undefined?undefined:z.coerce.number().int().min(1).parse(raw);return ok(c,await loadDirector(c.req.param("id"),rev));}catch(e){return fail(c,e);}});
directorRoute.post("/director/packages",async c=>{try{return ok(c,await saveDirector(await json(c)));}catch(e){return fail(c,e);}});
directorRoute.delete("/director/packages/:id",async c=>{try{const {revision}=z.object({revision:z.number().int().min(1)}).strict().parse(await json(c));return ok(c,await deleteDirector(c.req.param("id"),revision));}catch(e){return fail(c,e);}});
directorRoute.post("/director/assets",async c=>{try{return ok(c,await uploadDirectorAsset(await json(c)));}catch(e){return fail(c,e);}});
directorRoute.get("/director/assets/:id",async c=>{try{const bytes=await readDirectorAsset(c.req.param("id"));c.header("Content-Type","image/jpeg");c.header("X-Content-Type-Options","nosniff");return c.body(new Uint8Array(bytes));}catch(e){return fail(c,e);}});
for(const action of ["check","approve","preview","export","to-project","plan"]){directorRoute.post("/director/"+action,async c=>{try{const w=DirectorWork.parse(await json(c));switch(action){case "check":return ok(c,directorReport(w));case "approve":return ok(c,directorApprove(w));case "preview":return ok(c,directorCompile(w,false));case "export":c.header("Content-Type","application/zip");c.header("Content-Disposition",'attachment; filename="director-package.zip"');return c.body(new Uint8Array(await directorZip(w)));case "to-project":return ok(c,await directorToProject(w));default:return ok(c,{jobId:startJob(ctx=>generateDirector(w,ctx))});}}catch(e){return fail(c,e);}});}
