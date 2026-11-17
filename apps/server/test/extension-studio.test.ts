import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { Hono } from 'hono';
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ts-ext-studio-'));
process.env.DATA_DIR = dir;
const { config } = await import('../src/config.js');
const { auth, requireAuth, extToken } = await import('../src/routes/auth.js');
const { exploreRoute } = await import('../src/routes/explore.js');
const { createProject } = await import('../src/services/projects.js');
const { projectFile } = await import('../src/services/studio/montageCheck.js');
const { extPublishCards } = await import('../src/services/extPublish.js');

test('extension studio: list shows only projects with a saved card title', async () => {
  const withCard = await createProject({ title: 'Наполеон' }), empty = await createProject({ title: 'Пустой' });
  const file = projectFile(withCard.id, 'publish/card.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ title: '  Последний день Наполеона ', description: 'Текст', tags: ['история'] }));
  const list = await extPublishCards();
  assert.deepEqual(list.map((c) => [c.projectId, c.project, c.title]), [[withCard.id, 'Наполеон', 'Последний день Наполеона']]);
  assert.ok(!list.some((c) => c.projectId === empty.id));
});

test('extension studio: token reads cards but cannot change cards or reach other studio data', async () => {
  const old = config.password;
  config.password = 'test-ext-studio-password';
  const app = new Hono();
  app.use('/api/*', requireAuth);
  app.route('/api', auth);
  app.route('/api', exploreRoute);
  const h = { 'x-ts-token': extToken() };
  try {
    assert.equal((await app.request('/api/ext/publish-cards')).status, 401);
    assert.equal((await app.request('/api/ext/publish-cards', { headers: h })).status, 200);
    for (const [p, method] of [['/api/studio/publish/projects/abc', 'GET'], ['/api/studio/publish/projects/abc', 'PUT'], ['/api/studio/publish/projects/abc/seo', 'POST'], ['/api/ext/publish-cards/abc', 'PUT'], ['/api/ext/publish-cards/abc/x', 'GET'], ['/api/ext/publish-cards/a.b', 'GET']] as const)
      assert.equal((await app.request(p, { method, headers: h })).status, 403, `${method} ${p}`);
  } finally { config.password = old; }
});

test('extension studio: shared allowlist and background accept studio.youtube.com only for allowed reads', async () => {
  const sharedCode = await fs.readFile(new URL('../../../extension/shared.js', import.meta.url), 'utf8');
  const ctx: any = vm.createContext({ URL }); vm.runInContext(sharedCode, ctx); const x = ctx.TubeStudioExtension;
  assert.equal(x.request({ path: '/ext/publish-cards' }).path, '/ext/publish-cards');
  assert.equal(x.request({ path: '/ext/publish-cards/abc-1_2' }).path, '/ext/publish-cards/abc-1_2');
  for (const msg of [{ path: '/ext/publish-cards', method: 'POST' }, { path: '/ext/publish-cards/../settings' }, { path: '/ext/publish-cards/abc?x=1' }, { path: '/studio/publish/projects/abc' }]) assert.throws(() => x.request(msg), JSON.stringify(msg));
  const code = await fs.readFile(new URL('../../../extension/background.js', import.meta.url), 'utf8'); let handler: any, fetched = '';
  const storage = (d: any) => ({ get: async (k: any) => (k === null ? { ...d } : { ...k, ...d }), set: async (v: any) => Object.assign(d, v), remove: async () => {} });
  const chrome: any = { runtime: { id: 'ext-id', getURL: (p: string) => 'chrome-extension://ext-id/' + p, onMessage: { addListener: (f: any) => (handler = f) } }, storage: { local: storage({ server: 'http://127.0.0.1:8787', token: 'T', badges: 'search', panel: true }), sync: storage({}) }, tabs: { create: async () => {} } };
  const bg = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, chrome, Response, fetch: async (u: string) => { fetched = u; return new Response(JSON.stringify({ ok: true, data: [] })); }, importScripts: () => vm.runInContext(sharedCode, bg) }); vm.runInContext(code, bg);
  const ask = (msg: any, url: string) => new Promise<any>((r) => handler(msg, { id: 'ext-id', url, tab: { id: 1 } }, r));
  assert.equal((await ask({ type: 'api', path: '/ext/publish-cards' }, 'https://studio.youtube.com/channel/UC/videos/upload')).ok, true);
  assert.equal(fetched, 'http://127.0.0.1:8787/api/ext/publish-cards');
  assert.equal((await ask({ type: 'api', path: '/ext/publish-cards' }, 'https://evil.test/')).ok, false);
});
