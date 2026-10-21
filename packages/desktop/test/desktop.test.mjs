import test from 'node:test';
import { PassThrough } from 'node:stream';
import { waitForParent } from '../src/protocol.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import sharp from 'sharp';
import { loadSettings, saveSettings, defaults } from '../src/settings.ts';
import { DesktopController } from '../src/controller.ts';
import { LocalApp } from '../../local/src/app.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#abcd12' } }).png().toBuffer();
const png2 = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#123abc' } }).png().toBuffer();
const temp = () => mkdtempSync(join(tmpdir(), 'shot-desktop-'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
function host(root = temp(), mode) {
  const fixture = join(root, 'synthetic-clipboard.json'); let seq = 1;
  const event = (image, extra = {}) => { const temporary = fixture + '.tmp'; writeFileSync(temporary, JSON.stringify({ sequence: String(seq++), image: image?.toString('base64'), ...extra })); renameSync(temporary,fixture); };
  event(png); // Historical image must never create task on startup.
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./fixture.mjs', import.meta.url)), root, fixture, ...(mode ? [mode] : [])], { stdio: ['pipe','pipe','pipe'], shell: false });
  child.stdin.write('SHOT2AGENT/1\n');
  child.stderr.resume(); let receive; let exit;
  const stopped = new Promise(r => { child.once('close', code => { exit = code; receive?.reject(Error(`host exited ${code}`)); r(code); }); });
  const lines = createInterface({ input: child.stdout }); lines.on('line', line => { const current = receive; receive = undefined; current?.resolve(JSON.parse(line)); });
  async function raw(command, args = {}) {
    assert.equal(receive, undefined);
    return new Promise((resolve,reject) => { receive = { resolve, reject }; child.stdin.write(JSON.stringify({ v: 1, command, ...args }) + '\n'); });
  }
  async function rpc(command, args) { const r = await raw(command,args); assert.equal(r.ok,true,r.error); return r.value; }
  async function until(predicate) { for (let n=0;n<150;n++) { const s = await rpc('snapshot'); if (predicate(s)) return s; await sleep(25); } throw Error('snapshot condition timeout'); }
  async function close() { if (exit === undefined) await rpc('quit'); await stopped; assert.equal(exit,0); }
  return { root, child, rpc, raw, event, until, close, stopped };
}
const configure = (h, clipboard = 'manual', saveDirectory) => h.rpc('configure', { capture: { enabled: true, mode: 'auto' }, autoConsent: true, delivery: { clipboard, ...(saveDirectory ? { saveDirectory } : {}) } });

test('desktop process: first-run confirmation, startup safety, staged replacement/discard, duplicate/non-image', async t => {
  const h = host(); t.after(() => h.child.kill());
  let s = await h.rpc('snapshot'); assert.equal(s.settings.enabled,false); assert.equal(s.settings.mode,'confirm'); assert.equal(s.total,0);
  await h.rpc('configure', { capture: { enabled: true, mode: 'confirm' } });
  await sleep(100); assert.equal((await h.rpc('snapshot')).total,0);
  h.event(png); s = await h.until(s=>!!s.pending); assert.match(s.pending,/^data:image\/png;base64,/); assert.equal(s.total,0);
  h.event(png2); await sleep(80); await h.rpc('discard'); assert.equal((await h.rpc('snapshot')).pending,null);
  h.event(png); await h.until(s=>!!s.pending); h.event(undefined); await h.rpc('submit');
  s = await h.until(s=>s.tasks[0]?.status==='succeeded'); assert.equal(s.total,1); assert.equal(s.tasks[0].clipboard.status,'manual');
  await configure(h); h.event(png); await sleep(120); assert.equal((await h.rpc('snapshot')).total,1);
  h.event(undefined); await sleep(80); assert.equal((await h.rpc('snapshot')).total,1);
  await h.close();
});

test('desktop process: opt-in auto, independent Smart/save, pause baseline, restart persists and skips old clipboard', async t => {
  const h = host(); t.after(()=>h.child.kill()); const out = join(h.root,'output');
  assert.equal((await h.raw('configure',{ capture:{mode:'auto',enabled:true} })).error,'AUTO_CLOUD_CONSENT_REQUIRED');
  await configure(h,'smart',out); h.event(png2);
  let s = await h.until(s=>s.tasks[0]?.clipboard?.status==='succeeded'); assert.equal(s.total,1); assert.equal(s.tasks[0].save.status,'succeeded'); assert.match(s.testWrite,/# Fake result/);
  assert.match(readFileSync(join(out,`${s.tasks[0].id}.md`),'utf8'),/# Fake result/);
  await h.rpc('pause',{paused:true}); h.event(png); await sleep(100); assert.equal((await h.rpc('snapshot')).total,1);
  await h.rpc('pause',{paused:false}); await sleep(80); assert.equal((await h.rpc('snapshot')).total,1); await h.close();
  const restarted = host(h.root); t.after(()=>restarted.child.kill()); await sleep(100);
  s = await restarted.rpc('snapshot'); assert.equal(s.total,1); assert.equal(s.settings.mode,'auto'); assert.equal(s.delivery.saveDirectory,out); await restarted.close();
});

test('desktop process: Smart conflict preserves newer text, Copy fallback, Always consent, command isolation and errors', async t => {
  const h = host(undefined,'delay'); t.after(()=>h.child.kill()); await configure(h,'smart'); h.event(png2);
  await h.until(s=>s.tasks[0]?.status==='running'); h.event(undefined,{release:true});
  let s = await h.until(s=>s.tasks[0]?.clipboard?.status==='blocked_by_clipboard_change'); assert.equal(s.testWrite,undefined);
  await h.rpc('copy',{id:s.tasks[0].id}); assert.match((await h.rpc('snapshot')).testWrite,/# Fake result/);
  assert.equal((await h.raw('configure',{delivery:{clipboard:'always'}})).error,'ALWAYS_OVERWRITE_CONSENT_REQUIRED');
  await h.rpc('configure',{delivery:{clipboard:'always'},alwaysConsent:true});
  for (const request of [['exec',{executable:process.execPath}], ['configure',{profile:{command:'bad'}}], ['configure',{capture:{version:2}}], ['detail',{id:'../../secret'}]]) assert.equal((await h.raw(...request)).ok,false);
  h.event(undefined,{error:true}); s = await h.until(s=>s.status==='capture_error'); assert.equal(s.error,'CLIPBOARD_HELPER_STOPPED');
  h.event(undefined); await h.rpc('recover'); assert.equal((await h.rpc('snapshot')).status,'monitoring');
  s = await h.rpc('configure',{capture:{mode:'confirm'},delivery:{clipboard:'manual'},autoConsent:false,alwaysConsent:false});
  assert.equal(s.settings.autoConsent,false); assert.equal(s.settings.alwaysConsent,false); await h.close();
});

for (const mode of ['fail','unknown']) test(`desktop process: ${mode} is visible, never replayed after restart`, async t => {
  const h=host(undefined,mode); t.after(()=>h.child.kill()); await configure(h,'off'); h.event(png2);
  const expected=mode==='fail'?'failed':'execution_unknown'; let s=await h.until(s=>s.tasks[0]?.status===expected); const id=s.tasks[0].id;
  const d=await h.rpc('detail',{id}); assert.equal(d.attempts.length,1); await h.close();
  const next=host(h.root); t.after(()=>next.child.kill()); await sleep(100); s=await next.rpc('snapshot'); assert.equal(s.tasks[0].status,expected); assert.equal((await next.rpc('detail',{id})).attempts.length,1); await next.close();
});

test('settings migration backs up M2 config, preserves DB files, rejects unknown versions', () => {
  const root=temp(); writeFileSync(join(root,'settings.json'),JSON.stringify({adapter:'fake',delivery:{clipboard:'always'}}));
  writeFileSync(join(root,'tasks.sqlite'),'sentinel'); const s=loadSettings(root); assert.equal(s.delivery.clipboard,'manual'); assert.equal(s.desktop.enabled,false);
  assert.equal(readdirSync(root).filter(s=>s.startsWith('settings.m2-backup')).length,1); assert.equal(readFileSync(join(root,'tasks.sqlite'),'utf8'),'sentinel');
  s.desktop.version=2; assert.throws(()=>saveSettings(root,s),/INVALID_DESKTOP_SETTINGS/);
});

test('desktop duplicate worker is refused across coordinators; existing CLI can still inspect history', async () => {
  const root=temp(); const cb={session:'test',async sequence(){return '1';},async readImage(){},async writeText(){return true;},close(){}};
  const a=new DesktopController(root,cb); const b=new DesktopController(root,cb); await a.start();
  await assert.rejects(b.start(),/LOCAL_WORKER_ALREADY_RUNNING/); await b.close();
  const cli=new LocalApp(root,new FakeAgent(),FAKE_PROFILE,{clipboard:'off'}); assert.deepEqual(cli.list(),[]); await assert.rejects(cli.work(),/LOCAL_WORKER_ALREADY_RUNNING/); cli.close(); await a.close();
});

test('desktop EOF gracefully aborts running work and keeps queued work durable', async t => {
  const h=host(undefined,'delay'); t.after(()=>h.child.kill()); await configure(h,'off'); h.event(png2); await h.until(s=>s.tasks[0]?.status==='running');
  h.event(png); await h.until(s=>s.total===2); h.child.stdin.end(); assert.equal(await h.stopped,0);
  const next=host(h.root); t.after(()=>next.child.kill()); const s=await next.rpc('snapshot'); assert.equal(s.total,2); assert.equal(s.tasks.filter(t=>t.status==='queued').length,1); await next.close();
});

for (const mode of ['success', 'exit', 'hang']) test(`desktop pipes -> mock Codex ${mode}: failure/timeout remains visible and never replayed`, async t => {
  const root=temp(); const workspace=join(root,'workspace'); mkdirSync(workspace); writeFileSync(join(workspace,'mode'),mode);
  const settings=defaults(); settings.adapter='codex'; settings.codex={ id:'codex-readonly',version:'v1',workspace:realpathSync(workspace),program:{executable:process.execPath,args:[fileURLToPath(new URL('../../local/test/mock-codex.mjs',import.meta.url))]},cliVersion:'codex-cli mock-1',timeoutMs:5000,prompt:'Analyze synthetic image only.' };
  saveSettings(root,settings); const h=host(root); t.after(()=>h.child.kill()); await configure(h,'off'); h.event(png2);
  const expected=mode==='success'?'succeeded':'execution_unknown'; let s=await h.until(s=>s.tasks[0]?.status===expected); const id=s.tasks[0].id;
  if(mode==='success') assert.match((await h.rpc('detail',{id})).result.contentMarkdown,/# Mock result/);
  else assert.match(s.tasks[0].error,/CODEX_(EXIT|INTERRUPTED)/);
  await sleep(80); assert.equal((await h.rpc('detail',{id})).attempts.length,1); await h.close();
});

test('parent handshake preserves a coalesced first JSON request and refuses invalid gate', async () => {
  const input=new PassThrough(); const ready=waitForParent(input);
  const request=JSON.stringify({v:1,command:'snapshot'})+'\n';
  input.write('SHOT2AGENT/1\n'+request); await ready; assert.equal(input.read().toString(),request); input.destroy();
  const invalid=new PassThrough(); const rejected=waitForParent(invalid); invalid.write('INVALID\n'); await assert.rejects(rejected,/PARENT_HANDSHAKE_INVALID/); invalid.destroy();
});

test('desktop retry settings validated, persisted and shown without exposing execution policy', async t => {
  const h = host(); t.after(() => h.child.kill());
  const retry = { maxRetries: 2, backoffMs: 20, budgetMs: 1000 };
  let s = await h.rpc('configure', { delivery: { clipboard: 'smart', retry } });
  assert.deepEqual(s.delivery.retry, retry);
  for (const bad of [{ ...retry, maxRetries: 11 }, { ...retry, command: 'unsafe' }, { ...retry, budgetMs: 0 }, { ...retry, maxRetries: '2' }]) {
    assert.equal((await h.raw('configure', { delivery: { clipboard: 'smart', retry: bad } })).error, 'INVALID_DELIVERY_RETRY');
  }
  assert.deepEqual((await h.rpc('snapshot')).delivery.retry, retry); await h.close();
  const next = host(h.root); t.after(() => next.child.kill()); s = await next.rpc('snapshot');
  assert.deepEqual(s.delivery.retry, retry); assert.equal(s.total, 0); await next.close();
});
