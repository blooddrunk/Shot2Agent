import test from 'node:test';
import { PassThrough } from 'node:stream';
import { waitForParent } from '../src/protocol.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, realpathSync, appendFileSync, existsSync } from 'node:fs';
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
  // Append-only publication avoids replacing a file held by the Windows reader.
  const event = (image, extra = {}) => appendFileSync(fixture, JSON.stringify({ sequence: String(seq++), image: image?.toString('base64'), ...extra }) + '\n');
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
  async function until(predicate, attempts = 150) { for (let n=0;n<attempts;n++) { const s = await rpc('snapshot'); if (predicate(s)) return s; await sleep(25); } throw Error('snapshot condition timeout'); }
  async function close() { if (exit === undefined) await rpc('quit'); await stopped; assert.equal(exit,0); }
  return { root, child, rpc, raw, event, until, close, stopped };
}
const configure = (h, clipboard = 'manual', saveDirectory) => h.rpc('configure', { capture: { enabled: true, mode: 'auto' }, autoConsent: true, delivery: { clipboard, ...(saveDirectory ? { saveDirectory } : {}) } });

test('desktop process: first-run confirmation, startup safety, staged replacement/discard, duplicate/non-image', async t => {
  const h = host(); t.after(() => h.child.kill());
  let s = await h.rpc('snapshot'); assert.equal(s.settings.enabled,false); assert.equal(s.settings.mode,'confirm'); assert.equal(s.total,0);
  await h.rpc('configure', { capture: { enabled: true, mode: 'confirm' }, delivery: { clipboard: 'manual' } });
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

test('fresh Always selection requires consent, preserves existing choices and guards explicit submission', async () => {
  const root = temp(); let writes = 0;
  const cb = { session: 'fresh', async sequence() { return '1'; }, async readImage() {}, async writeText() { writes++; return true; }, close() {} };
  const desktop = new DesktopController(root, cb);
  try {
    assert.equal(desktop.settings.delivery.clipboard, 'always');
    assert.equal(desktop.settings.desktop.alwaysConsent, false);
    assert.equal(desktop.app.config.clipboard, 'manual');
    await desktop.start();
    const id = await desktop.app.submit(png2); await desktop.app.work();
    assert.equal(desktop.app.state.get(id, 'clipboard').status, 'manual'); assert.equal(writes, 0);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'configure', capture: { enabled: true } }), /ALWAYS_OVERWRITE_CONSENT_REQUIRED/);
    await desktop.dispatch({ v: 1, command: 'configure', capture: { enabled: true }, alwaysConsent: true });
    const approved = await desktop.app.submit(png); await desktop.app.work();
    assert.equal(desktop.app.state.get(approved, 'clipboard').status, 'succeeded'); assert.equal(writes, 1);
  } finally { await desktop.close(); }
  const settings = loadSettings(root); settings.delivery.clipboard = 'smart'; saveSettings(root, settings);
  assert.equal(loadSettings(root).delivery.clipboard, 'smart');
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
  // Give Windows process-tree termination several seconds before the Worker safety deadline.
  const settings=defaults(); settings.adapter='codex'; settings.codex={ id:'codex-readonly',version:'v1',workspace:realpathSync(workspace),program:{executable:process.execPath,args:[fileURLToPath(new URL('../../local/test/mock-codex.mjs',import.meta.url))]},cliVersion:'codex-cli mock-1',timeoutMs:mode==='hang'?15000:5000,prompt:'Analyze synthetic image only.' };
  saveSettings(root,settings); const h=host(root); t.after(()=>h.child.kill()); await configure(h,'off'); h.event(png2);
  const expected=mode==='success'?'succeeded':'execution_unknown'; let s=await h.until(s=>s.tasks[0]?.status===expected,mode==='hang'?600:150); const id=s.tasks[0].id;
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

test('desktop fixture ignores an incomplete appended event until its newline is published', async t => {
  const h = host(); t.after(() => h.child.kill());
  await h.rpc('configure', { capture: { enabled: true, mode: 'confirm' }, delivery: { clipboard: 'manual' } });
  const event = JSON.stringify({ sequence: '99', image: png2.toString('base64') });
  const fixture = join(h.root, 'synthetic-clipboard.json'); const middle = Math.floor(event.length / 2);
  appendFileSync(fixture, event.slice(0, middle));
  await h.rpc('recover'); // Force a clipboard state read while the final record is incomplete.
  assert.equal((await h.rpc('snapshot')).pending, null);
  appendFileSync(fixture, event.slice(middle) + '\n');
  await h.until(s => !!s.pending); assert.equal((await h.rpc('snapshot')).total, 0); await h.close();
});


test('formal Codex entry opens first-run setup without a configured Profile', async () => {
  const root = temp();
  const cb = { session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} };
  const desktop = new DesktopController(root, cb, undefined, 'codex', async () => []);
  try {
    await desktop.start();
    const first = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(first.setupRequired, true); assert.equal(first.status, 'setup_required'); assert.equal(first.total, 0);
    assert.equal(existsSync(join(root, 'settings.json')), true);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'configure', capture: { enabled: true } }), /AGENT_SETUP_REQUIRED/);
    assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).settings.enabled, false);
  } finally { await desktop.close(); }
});

test('legacy and acceptance entries expose explicit mode with separate durable roots', async () => {
  const cb = { session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} };
  const legacy = new DesktopController(temp(), cb);
  const acceptance = new DesktopController(temp(), cb, { adapter: new FakeAgent(), profile: FAKE_PROFILE }, 'staging');
  try {
    const old = await legacy.dispatch({ v: 1, command: 'snapshot' });
    const stage = await acceptance.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(old.launchMode, 'legacy'); assert.equal(stage.launchMode, 'staging');
    assert.equal(stage.profile.adapter, 'fake'); assert.notEqual(old.root, stage.root);
    assert.equal(old.total, 0); assert.equal(stage.total, 0);
  } finally { await legacy.close(); await acceptance.close(); }
});


test('formal mode selects the approved Codex adapter and acceptance refuses it', async () => {
  const root = temp(); const settings = defaults(); settings.adapter = 'codex';
  settings.codex = { id: 'synthetic-codex', version: '1', workspace: realpathSync(root),
    program: { executable: process.execPath, args: [fileURLToPath(new URL('../../local/test/mock-codex.mjs', import.meta.url))] },
    cliVersion: 'codex-cli 0.0.0', timeoutMs: 5000, prompt: 'Synthetic fixture only' };
  saveSettings(root, settings);
  const before = readFileSync(join(root, 'settings.json'), 'utf8');
  const cb = { session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} };
  assert.throws(() => new DesktopController(root, cb, undefined, 'staging'), /FAKE_ACCEPTANCE_PROFILE_REQUIRED/);
  const desktop = new DesktopController(root, cb, undefined, 'codex');
  try {
    const s = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(s.launchMode, 'codex'); assert.equal(s.profile.adapter, 'codex'); assert.equal(s.profile.sandbox, 'read-only');
    assert.equal(s.profile.id, settings.codex.id); assert.equal(s.profile.version, settings.codex.cliVersion);
    assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), before);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'snapshot', adapter: 'fake' }), /COMMAND_REFUSED/);
  } finally { await desktop.close(); }
});


test('native formal startup presents first-run setup without a Profile', { skip: process.platform !== 'win32' }, async t => {
  const root = temp();
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../src/main.ts', import.meta.url)), root, '--codex'], { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  const lines = createInterface({ input: child.stdout }); const pending = []; let receive;
  lines.on('line', line => { if (receive) { const current = receive; receive = undefined; current.resolve(JSON.parse(line)); } else pending.push(JSON.parse(line)); });
  const next = () => pending.length ? Promise.resolve(pending.shift()) : new Promise(resolve => { receive = { resolve }; });
  const closed = new Promise(resolve => child.once('close', resolve)); child.once('error', error => { throw error; });
  child.stdin.write('SHOT2AGENT/1\n' + JSON.stringify({ v: 1, command: 'snapshot' }) + '\n');
  let timer;
  const response = await Promise.race([next(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('FIRST_RUN_SETUP_DID_NOT_OPEN')), 15000); })]).finally(() => clearTimeout(timer));
  assert.equal(response.ok, true, response.error); assert.equal(response.value.setupRequired, true); assert.equal(response.value.status, 'setup_required');
  child.stdin.write(JSON.stringify({ v: 1, command: 'quit' }) + '\n');
  const code = await closed;
  assert.equal(code, 0); assert.equal(existsSync(join(root, 'settings.json')), true);
});

test('global action process: pause atomic toggle, no startup image, no result, persistence and allowlist', async t => {
  const h = host(); t.after(() => h.child.kill());
  assert.equal((await h.raw('action', { action: 'copy-latest' })).error, 'NO_COMPLETED_RESULT');
  assert.equal((await h.raw('action', { action: 'exec' })).error, 'ACTION_REFUSED');
  assert.equal((await h.raw('action', { action: 'current', executable: 'evil' })).error, 'COMMAND_REFUSED');
  assert.equal((await h.rpc('action', { action: 'toggle-pause' })).settings.paused, true);
  assert.equal((await h.rpc('action', { action: 'toggle-pause' })).settings.paused, false);
  await sleep(100); assert.equal((await h.rpc('snapshot')).total, 0);
  assert.equal((await h.raw('configure-hotkeys', { hotkeys: { current: 'Win+L' } })).error, 'INVALID_HOTKEY');
  assert.equal((await h.raw('configure-hotkeys', { hotkeys: { current: 'Ctrl+Alt+X', 'copy-latest': 'Ctrl+Alt+X' } })).error, 'DUPLICATE_HOTKEY');
  const hotkeys = { 'toggle-pause': 'Ctrl+Alt+P', 'copy-latest': 'Ctrl+Alt+C' };
  assert.deepEqual((await h.rpc('configure-hotkeys', { hotkeys })).hotkeys, hotkeys);
  await h.rpc('action', { action: 'current' });
  await h.until(s => s.tasks[0]?.status === 'succeeded');
  const s = await h.rpc('action', { action: 'copy-latest' }); assert.equal(s.lastAction.status, 'succeeded');
  assert.equal((await h.raw('action', { action: 'retry-latest-delivery' })).error, 'NO_ELIGIBLE_FAILED_DELIVERY');
  assert.equal((await h.raw('action', { action: 'cycle-agent' })).error, 'NO_OTHER_APPROVED_AGENT');
  await h.close(); const next = host(h.root); t.after(() => next.child.kill());
  assert.deepEqual((await next.rpc('snapshot')).hotkeys, hotkeys); await next.close();
});

test('latest completed output ordering excludes newer queued/failed; hotkey retries only safe failed channel', async () => {
  const { completedResults } = await import('../src/actions.ts');
  const root = temp(); let writes = 0; let calls = 0;
  const cb = { session: 'm6', async sequence() { return '1'; }, async readImage() {}, async writeText() { writes++; return true; }, close() {} };
  const agent = { name: 'fake', version: 'm6', execute: (...args) => { calls++; return new FakeAgent().execute(...args); } };
  const desktop = new DesktopController(root, cb, { adapter: agent, profile: FAKE_PROFILE });
  try {
    const a = await desktop.app.submit(png, undefined, true); await desktop.app.work();
    await sleep(5); const b = await desktop.app.submit(png2, undefined, true); await desktop.app.work();
    const queued = await desktop.app.submit(png, undefined, true);
    assert.equal(completedResults(desktop.app)[0].submission.taskId, b);
    assert.equal(desktop.app.get(queued).status, 'queued');
    await desktop.dispatch({ v: 1, command: 'action', action: 'copy-latest' });
    assert.equal(desktop.app.state.get(a, 'clipboard').status, 'manual'); assert.equal(desktop.app.state.get(b, 'clipboard').status, 'succeeded');
    desktop.app.config.clipboard = 'always'; desktop.app.config.saveDirectory = join(root, 'safe-output');
    desktop.app.state.put(b, 'save', { status: 'failed', attempts: 1, classification: 'transient' });
    desktop.app.state.put(b, 'clipboard', { status: 'interrupted', attempts: 1, classification: 'ambiguous' });
    const before = calls; await desktop.dispatch({ v: 1, command: 'action', action: 'retry-latest-delivery' });
    assert.equal(calls, before); assert.equal(writes, 1); assert.equal(desktop.app.state.get(b, 'clipboard').status, 'interrupted');
    assert.equal(desktop.app.state.get(b, 'save').status, 'succeeded');
    await assert.rejects(desktop.dispatch({ v: 1, command: 'action', action: 'retry-latest-delivery' }), /NO_ELIGIBLE/);
  } finally { await desktop.close(); }
});

test('completion ordering uses durable finish time over submission order and excludes failed/running output', async () => {
  const { completedResults } = await import('../src/actions.ts');
  const tasks = Array.from({ length: 70 }, (_, n) => ({ status: 'succeeded', submission: { taskId: String(n).padStart(4, '0') }, createdAt: 1000 - n, result: { status: 'succeeded', finishedAt: n } }));
  tasks.push({ status: 'failed', submission: { taskId: 'failed' }, result: { status: 'failed', finishedAt: 9999 } });
  tasks.push({ status: 'running', submission: { taskId: 'running' } });
  assert.equal(completedResults({ list: () => tasks })[0].submission.taskId, '0069');
  tasks[0].result.finishedAt = 10000;
  assert.equal(completedResults({ list: () => tasks })[0].submission.taskId, '0000');
});
