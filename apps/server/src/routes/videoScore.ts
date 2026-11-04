import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ApiError, fail, ok } from "../lib/errors.js";
import { startJob } from "../lib/jobs.js";
import { VideoScoreInput, runVideoScore, loadVideoScore, listVideoScores } from "../services/videoScore.js";
export const videoScoreRoute=new Hono();
videoScoreRoute.post("/video-scorecard",bodyLimit({maxSize:8192,onError:c=>c.json({ok:false,error:{code:"VALIDATION",message:"Слишком большой запрос"}},413)}),async c=>{
  try{const d=VideoScoreInput.parse(await c.req.json());return ok(c,{jobId:startJob(ctx=>runVideoScore(d,ctx))});}catch(e){return fail(c,e instanceof SyntaxError?new ApiError("VALIDATION","Некорректный JSON запроса"):e);}
});
videoScoreRoute.get("/video-score-runs",async c=>{try{return ok(c,await listVideoScores());}catch(e){return fail(c,e);}});
videoScoreRoute.get("/video-score-runs/:id",async c=>{try{const r=await loadVideoScore(c.req.param("id"));if(!r)throw new ApiError("NOT_FOUND","Снимок не найден или повреждён",404);return ok(c,r);}catch(e){return fail(c,e);}});
