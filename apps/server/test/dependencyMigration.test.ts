import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { SettingsSchema, FiltersSchema } from "../src/services/settings.js";
import { PipelineInput } from "../src/services/pipeline.js";
import { CalInput, CalPatchInput } from "../src/services/calendar.js";
import { ThumbInput } from "../src/services/thumbnail.js";
import { SavedTopicInput } from "../src/services/topics.js";

test("dependency migration: missing legacy settings recursively receive defaults", () => {
 const s=SettingsSchema.parse({});
 assert.equal(s.research.pages,1); assert.equal(s.research.viral.outlierMin,20);
 assert.equal(s.research.keywords.maxPick,5); assert.equal(s.research.competitors.digestAuto,false);
 assert.equal(s.research.comments.perVideo,200); assert.ok(s.models.gemini.length>0);
 assert.equal(s.anymodel.enabled,true); assert.ok(s.budget.prices.length>0);
 assert.deepEqual(FiltersSchema.parse({}),{type:"all",viralOnly:false});
});
test("dependency migration: partial legacy settings retain explicit choices", () => {
 const s=SettingsSchema.parse({research:{comments:{perVideo:100,order:"time"}},theme:"light"});
 assert.equal(s.theme,"light"); assert.equal(s.research.comments.perVideo,100);
 assert.equal(s.research.comments.order,"time"); assert.equal(s.research.comments.channelVideos,3);
 assert.equal(s.research.pages,1);
});
test("dependency migration: pipeline nested defaults are parsed, not empty objects", () => {
 const p=PipelineInput.parse({topic:"Test topic"});
 assert.deepEqual(p.voice,{speed:1,pitch:0});
 assert.deepEqual(p.video,{images:10,vertical:false,subtitles:true});
 const q=PipelineInput.parse({topic:"Test topic",voice:{speed:1.5},video:{vertical:true}});
 assert.equal(q.voice.speed,1.5);assert.equal(q.voice.pitch,0);assert.equal(q.video.images,10);
});
test("dependency migration: calendar PATCH never inserts create defaults", () => {
 assert.deepEqual(CalPatchInput.parse({}),{});
 assert.deepEqual(CalPatchInput.parse({title:"Renamed"}),{title:"Renamed"});
 const old=CalInput.parse({date:"2026-10-28",title:"Saved",status:"published",format:"short",remindDays:8});
 const next={...old,...CalPatchInput.parse({notes:"Only notes"})};
 assert.equal(next.status,"published");assert.equal(next.format,"short");assert.equal(next.remindDays,8);
 assert.equal(CalInput.parse({date:"2026-10-28",title:"New"}).status,"plan");
 assert.equal(CalPatchInput.safeParse({status:"invalid"}).success,false);
});
test("dependency migration: omitted thumbnail choices remain absent", () => {
 assert.deepEqual(ThumbInput.parse({title:"Test title"}).steps,{});
 assert.deepEqual(ThumbInput.parse({title:"Test title",steps:{text:"skip"}}).steps,{text:"skip"});
});
test("dependency migration: metadata record accepts string keys and preserves values", () => {
 const meta={arbitrary:{nested:true},score:0,nullable:null};
 assert.deepEqual(SavedTopicInput.parse({title:"Test topic",meta}).meta,meta);
 assert.equal(SavedTopicInput.safeParse({title:"Test topic",meta:[]}).success,false);
});
test("dependency migration: over-limit arrays are rejected before element transforms", () => {
 let processed=0;
 const schema=z.array(z.string().transform(v=>{processed++;return v;})).max(2);
 assert.equal(schema.safeParse(Array(100).fill("x")).success,false);
 assert.equal(processed,0);
});
