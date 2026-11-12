import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-script-plan-test-'));
process.env.DATA_DIR = dir;
const { config } = await import('../src/config.js');
const { ScriptInput, runScript } = await import('../src/services/script.js');
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test('script plan prompt tells the model the 2–10 beats-per-act limit of the plan schema', async () => {
    const ctx = { signal: new AbortController().signal, progress: () => { }, partial: () => { } };
    const oldFetch = globalThis.fetch, keys = { ...config.keys };
    Object.assign(config.keys, { anthropic: 'test-only', gemini: '', anymodel: '' });
    const bodies: any[] = [];
    globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); throw Error('stop after plan request'); };
    try {
        const input = ScriptInput.parse({ topic: 'How Did the Pilgrims Survive Their First Winter?', language: 'en', value: 2500, research: false, humanize: false, channelVoice: false, cta: false });
        await assert.rejects(() => runScript(input, ctx as any));
        assert.ok(bodies.length >= 1, 'plan request was built');
        const user = String(bodies[0].messages[0].content);
        assert.match(user, /Create the narrative PLAN/);
        assert.match(user, /every act has 2–10 beats \(never more than 10, never fewer than 2\)/);
    } finally {
        globalThis.fetch = oldFetch;
        Object.assign(config.keys, keys);
    }
});
