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
const ctx = { signal: new AbortController().signal, progress: () => { }, partial: () => { } };

test('script plan prompt tells the model the 2–10 beats-per-act limit of the plan schema', async () => {
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

test('author notes reach the plan and act prompts whole even after a long facts dossier', async () => {
    const oldFetch = globalThis.fetch, keys = { ...config.keys };
    Object.assign(config.keys, { anthropic: 'test-only', gemini: '', anymodel: '' });
    const reply = (text: string) => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    const facts = Array.from({ length: 25 }, (_, i) => ({ claim: `Fact ${i}: ` + 'the colonists stored corn and repaired the common house. '.repeat(10), source: null, confidence: 'medium' }));
    const plan = { title: 'First Winter', core_question: 'How?', structure_id: 'S1', hook_strikes: {}, acts: [{ name: 'Act', summary: 'Winter', beats: ['Ship', 'Shore'], words: 150 }], open_loops: [], midroll_cta_line: '', ending_question: 'What would you do?', claims_to_verify: [] };
    const prompts: { plan?: string; act?: string } = {};
    globalThis.fetch = async (url, init) => {
        if (String(url).includes('wikipedia')) return new Response('', { status: 404 });
        const body = JSON.parse(String(init?.body)), user = String(body.messages[0].content), system = JSON.stringify(body.system ?? '');
        if (system.includes('meticulous documentary researcher')) return reply(JSON.stringify({ facts, disputed: [] }));
        if (user.includes('Create the narrative PLAN')) { prompts.plan = user; return reply(JSON.stringify(plan)); }
        if (user.includes('Write ACT 1 of 1')) { prompts.act = user; throw Error('stop after act request'); }
        throw Error('unexpected request');
    };
    try {
        const notes = 'My own version: focus on the Wampanoag alliance. ' + 'Extra author detail. '.repeat(150) + 'NOTES_END_SENTINEL';
        const input = ScriptInput.parse({ topic: 'How Did the Pilgrims Survive Their First Winter?', language: 'en', value: 150, notes, research: true, humanize: false, channelVoice: false, cta: false });
        await assert.rejects(() => runScript(input, ctx as any));
        assert.ok(prompts.plan && prompts.act, 'plan and act requests were built');
        for (const p of [prompts.plan!, prompts.act!]) {
            assert.match(p, /Fact 0:/, 'facts dossier is present');
            assert.match(p, /Author notes:\nMy own version/);
            assert.match(p, /NOTES_END_SENTINEL/, 'author notes are not cut off by the facts limit');
            assert.ok(!p.includes('Fact 24:'), 'the facts dossier is still limited as before');
        }
    } finally {
        globalThis.fetch = oldFetch;
        Object.assign(config.keys, keys);
    }
});
