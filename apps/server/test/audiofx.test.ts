// Скорость/тон озвучки: цепочка фильтров FFmpeg
import { test } from "node:test";
import assert from "node:assert/strict";
const { fxFilter } = await import("../src/services/audioFx.js");

test("скорость без тона — один atempo; большие значения — цепочкой", () => {
  assert.equal(fxFilter(1.2, 0), "atempo=1.2000");
  assert.equal(fxFilter(1, 0), "");
});
test("тон: asetrate + компенсация темпа (длительность не меняется)", () => {
  const f = fxFilter(1, 12);
  assert.match(f, /asetrate=48000/); assert.match(f, /atempo=0\.5000/);
});
