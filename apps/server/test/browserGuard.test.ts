import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { browserGuard } from '../src/lib/browserGuard.js';

const app=new Hono();let reached=0;
app.use('*',browserGuard);app.all('*',c=>{reached++;return c.text('handler');});
async function request(path:string,headers:Record<string,string>={},method='GET',url='http://127.0.0.1:8787') {
 return app.request(url+path,{method,headers:{host:'127.0.0.1:8787',...headers}});
}
const ext='chrome-extension://abcdefghijklmnopabcdefghijklmnop';
test('same-origin requests, local tools, IPv6 and local frontend pass',async()=>{
 for(const [p,h,m,u] of [
  ['/api/system/runtime',{},'GET','http://127.0.0.1:8787'],
  ['/api/system/cache/clear',{origin:'http://127.0.0.1:8787','sec-fetch-site':'same-origin'},'POST','http://127.0.0.1:8787'],
  ['/api/auth/status',{host:'localhost:5173',origin:'http://localhost:5173','sec-fetch-site':'same-origin'},'GET','http://localhost:5173'],
  ['/files/a',{host:'[::1]:8787','sec-fetch-site':'none'},'GET','http://[::1]:8787'],
  ['/',{'sec-fetch-site':'cross-site'},'GET','http://127.0.0.1:8787'],
 ] as [string,Record<string,string>,string,string][]) assert.equal((await request(p,h,m,u)).status,200);
});
test('untrusted origins, null origin and fetch metadata are rejected before handler',async()=>{
 for(const h of [
  {origin:'https://evil.example'}, {origin:'null'}, {origin:'http://127.0.0.1:8888'},
  {'sec-fetch-site':'same-site'}, {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'unknown'},
  {origin:'http://127.0.0.1:8787','sec-fetch-site':'cross-site'},
 ]) { const before=reached; assert.equal((await request('/api/system/cache/clear',h,'POST')).status,403);assert.equal(reached,before); }
 assert.equal((await request('/files/a',{'sec-fetch-site':'cross-site'})).status,403);
});
test('Host whitelist applies to every path and forwarded headers never override it',async()=>{
 for(const host of ['evil.example:8787','127.0.0.2:8787','localhost.evil:8787','localhost:0','localhost:65536','localhost:8787,evil.example','evil.example']) {
  assert.equal((await request('/',{host,'x-forwarded-host':'localhost:8787'})).status,403,host);
 }
 assert.equal((await request('/api/auth/status',{host:'127.0.0.1:8787'},'GET','http://evil.example:8787')).status,403);
 assert.equal((await request('/api/auth/status',{host:'localhost:8787'},'GET','http://127.0.0.1:8787')).status,403);
});
test('extension exception is restricted by origin, exact path and method',async()=>{
 for(const [method,p] of [['GET','/api/ext/ping'],['GET','/api/ext/videos'],['POST','/api/saved-topics']]) assert.equal((await request(p,{origin:ext,'sec-fetch-site':'cross-site'},method)).status,200);
 for(const [method,p] of [['POST','/api/ext/ping'],['GET','/api/ext/token'],['POST','/api/system/cache/clear'],['GET','/api/saved-topics'],['GET','/api/ext/ping/extra']]) assert.equal((await request(p,{origin:ext,'sec-fetch-site':'cross-site'},method)).status,403);
 assert.equal((await request('/api/ext/ping',{origin:'chrome-extension://not-an-id','sec-fetch-site':'cross-site'})).status,403);
});
test('only GET OAuth callback bypasses browser origin checks; host still validated',async()=>{
 assert.equal((await request('/api/yt-oauth/callback',{origin:'https://accounts.google.com','sec-fetch-site':'cross-site'})).status,200);
 assert.equal((await request('/api/yt-oauth/callback',{origin:'https://accounts.google.com','sec-fetch-site':'cross-site'},'POST')).status,403);
 assert.equal((await request('/api/yt-oauth/callback',{host:'evil.example:8787','sec-fetch-site':'cross-site'})).status,403);
});
