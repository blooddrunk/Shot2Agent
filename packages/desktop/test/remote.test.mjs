import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { DesktopController } from '../src/controller.ts';
import { RemoteClient } from '../../../services/relay/src/client.ts';
import { createRelay } from '../../../services/relay/src/server.ts';
import { openCore } from '../../core/src/core.ts';
import { sha256 } from '../../core/src/blobs.ts';
import { syntheticSubmission } from '../../../apps/cli/src/fixture.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
import { credentialStore } from '../../../apps/desktop/tests/fixtures.mjs';
const devices = ['a', 'b', 'c'].map(deviceId => ({ ownerId: 'test-owner', deviceId, token: deviceId.repeat(40), role: 'desktop' }));
const caps = [{ id: FAKE_PROFILE.id, version: FAKE_PROFILE.version, fingerprint: FAKE_PROFILE.fingerprint, provider: 'fake' }];
const info = { profileFingerprint: FAKE_PROFILE.fingerprint, adapterName: 'fake', adapterVersion: '1', timeoutMs: 5000 };
function clipboard() { return { session: 'isolated-remote', seq: '1', image: undefined, writes: [], files: [], notices: 0,
  async sequence() { return this.seq; }, async readImage() { return this.image ? { bytes: this.image, sequence: this.seq } : undefined; },
  async writeText(text, expected) { if (expected && expected !== this.seq) return false; this.writes.push(text); return true; },
  async writeFiles(files, expected) { if (expected && expected !== this.seq) return false; for (const f of files) assert.match(readFileSync(f, 'utf8'), /Fake result/); this.files.push(files); return true; },
  async notify() { this.notices++; }, close() {} }; }
const rpc = (d, command, args = {}) => d.dispatch({ v: 1, command, ...args });
async function harness(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-m10-'))); let core = openCore(join(root, 'relay'), 'remote');
  let registry = JSON.parse(JSON.stringify(devices)); let server; let url; let requests = 0;
  const connect = async port => { server = await createRelay(core, registry, () => { requests++; return registry; }); url = await server.listen({ host: '127.0.0.1', port: port ?? 0 }); };
  await connect(); const cb = clipboard(); const credentials = credentialStore(); let calls = 0;
  const adapter = { name: 'fake', version: '1', async execute(...args) { calls++; return new FakeAgent().execute(...args); } };
  let a = new DesktopController(join(root, 'a'), cb, undefined, 'legacy', async () => [], { credentials });
  let b = new DesktopController(join(root, 'b'), clipboard(), { adapter, profile: FAKE_PROFILE }, 'legacy', async () => [], { credentials: credentialStore() });
  await a.start(); await b.start();
  const configure = async (d, token, receive) => { await rpc(d, 'remote-configure', { url, token, receive }); await rpc(d, 'remote-test'); };
  await configure(b, devices[1].token, true); await configure(a, devices[0].token, false);
  await rpc(a, 'remote-select', { deviceId: 'b', id: FAKE_PROFILE.id, version: FAKE_PROFILE.version }); await rpc(a, 'remote-configure', { mode: 'remote' });
  const client = () => new RemoteClient(url, devices[0].token);
  const sync = async d => { await rpc(d, 'remote-retry'); await rpc(d, 'remote-test'); };
  const work = async () => b.app.work(undefined, new RemoteClient(url, devices[1].token));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); await a.close(); await b.close(); await server.close(); core.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, cb, credentials, configure, sync, work, client, addCleanup: fn => cleanups.push(fn), get a() { return a; }, get b() { return b; }, get core() { return core; }, get server() { return server; }, get url() { return url; }, get calls() { return calls; }, get requests() { return requests; },
    rotate() { registry = registry.map(d => d.deviceId === 'a' ? { ...d, token: 'z'.repeat(40) } : d); },
    async restartA() { await a.close(); a = new DesktopController(join(root, 'a'), cb, undefined, 'legacy', async () => [], { credentials }); await a.start(); },
    async restartRelay() { const port = Number(new URL(url).port); await server.close(); core.close(); core = openCore(join(root, 'relay'), 'remote'); await connect(port); },
  };
}
for (const count of [1, 5]) test(`R02 desktop Remote ${count} ordered images -> Relay -> independent controller Worker -> verified history/delivery`, async t => {
  const h = await harness(t); const { images } = await syntheticSubmission(count);
  await rpc(h.a, 'configure', { delivery: { clipboard: 'manual', saveDirectory: join(h.root, 'exports'), notification: true } });
  if (count === 1) { h.cb.image = images[0]; await rpc(h.a, 'current'); }
  else { const paths = images.map((b, i) => { const p = join(h.root, `${i}.png`); writeFileSync(p, b); return p; }); await rpc(h.a, 'composer-add-files', { paths }); await rpc(h.a, 'composer-move', { index: 0, to: 4 }); await rpc(h.a, 'composer-submit'); }
  const id = h.a.app.list()[0].submission.taskId;
  assert.equal(h.a.app.core.list('local-user').tasks.length, 0); assert.equal(h.a.remote.info(id).upload, 'pending_upload');
  await h.sync(h.a); assert.equal((await h.client().get(id)).submission.targetWorkerId, 'b');
  assert.equal(await new RemoteClient(h.url, devices[2].token).claim(caps).catch(() => null), null);
  await h.work(); await h.sync(h.a); await h.a.app.work();
  const task = h.a.app.get(id); assert.equal(task.status, 'succeeded'); assert.equal(task.attempts.length, 1); assert.equal(task.result.workerId, 'b'); assert.equal(h.calls, 1);
  assert.deepEqual(task.submission.images.map(i => i.sha256), (count === 1 ? images : [...images.slice(1), images[0]]).map(sha256));
  assert.equal(readFileSync(join(h.root, 'exports', `${id}.md`), 'utf8'), task.result.contentMarkdown);
  await rpc(h.a, 'copy', { id }); await rpc(h.a, 'copy-files', { id });
  assert.equal(h.cb.writes.at(-1), task.result.contentMarkdown); assert.equal(h.cb.files.length, 1); assert.equal(h.cb.notices, 1);
  await h.sync(h.a); await h.a.app.work(); assert.equal(h.cb.notices, 1); assert.equal(h.calls, 1);
  await h.restartA(); assert.equal(h.a.app.get(id).status, 'succeeded'); await h.a.app.work(); assert.equal(h.cb.notices, 1);
  await rpc(h.a, 'delete-history', { ids: [id] }); assert.equal(h.a.app.list().length, 0); assert.equal(readFileSync(join(h.root, 'exports', `${id}.md`), 'utf8'), task.result.contentMarkdown);
  await h.restartA(); await h.sync(h.a); assert.equal(h.a.app.list().length, 0);
});

test('R03 offline upload, lost acceptance ACK and origin restart reuse one UUID/key without duplicate execution', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission();
  const original = globalThis.fetch; let phase = 'offline';
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/v1/tasks') && init?.method === 'POST') {
      if (phase === 'offline') throw new Error('synthetic offline');
      const response = await original(url, init);
      if (phase === 'lost') { phase = 'online'; await response.arrayBuffer(); throw new Error('synthetic lost ACK'); }
      return response;
    }
    return original(url, init);
  };
  t.after(() => { globalThis.fetch = original; });
  const id = await h.a.app.submitImages(images); await h.sync(h.a); assert.equal(h.a.remote.info(id).upload, 'pending_upload'); assert.equal(h.core.list('test-owner').tasks.length, 0);
  await h.restartA(); phase = 'lost'; await h.sync(h.a); assert.equal(h.core.list('test-owner').tasks.length, 1); assert.equal(h.a.remote.info(id).upload, 'pending_upload');
  await h.restartA(); await h.sync(h.a); await h.work(); await h.sync(h.a);
  assert.equal(h.core.list('test-owner').tasks.length, 1); assert.equal(h.a.app.get(id).status, 'succeeded'); assert.equal(h.calls, 1); assert.equal(h.a.app.core.store.tasks().length, 0);
});

test('R04 paused B, Relay restart, offline A completion and reconnect persist capability/task/result/receipts', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission();
  await rpc(h.b, 'remote-configure', { receive: false }); await h.sync(h.b);
  const id = await h.a.app.submitImages(images); await h.sync(h.a); await h.restartRelay();
  assert.equal((await h.client().workers()).find(w => w.deviceId === 'b').profiles[0].fingerprint, FAKE_PROFILE.fingerprint);
  await assert.rejects(h.work, /RELAY_409/); assert.equal((await h.client().get(id)).status, 'queued');
  await rpc(h.b, 'remote-configure', { receive: true }); await h.sync(h.b); await h.work();
  await h.restartRelay(); await h.restartA(); await h.sync(h.a); assert.equal(h.a.app.get(id).status, 'succeeded'); assert.equal(h.calls, 1);
});

test('R05 wrong target and stale proof denied; after-start interruption becomes execution_unknown without replay', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission(); const id = await h.a.app.submitImages(images); await h.sync(h.a);
  const b = new RemoteClient(h.url, devices[1].token); const c = new RemoteClient(h.url, devices[2].token); await c.presence('C', caps, true);
  assert.equal(await c.claim(caps), null);
  const claim = await b.claim(caps); assert.ok(claim);
  await assert.rejects(() => c.start(id, claim.proof, info), /RELAY_409/);
  await assert.rejects(() => b.start(id, claim.proof, { ...info, profileFingerprint: '0'.repeat(64) }), /RELAY_409/);
  await b.start(id, claim.proof, info);
  const stored = h.core.store.attempts(id)[0]; stored.leaseUntil = 0; h.core.store.putAttempt(stored);
  await h.restartRelay(); assert.equal((await h.client().get(id)).status, 'execution_unknown');
  assert.equal(await b.claim(caps), null); await assert.rejects(() => b.complete(id, claim.proof, { status: 'succeeded', summary: 'late', contentMarkdown: 'late', artifacts: [] }), /RELAY_409/);
  await h.sync(h.a); assert.equal(h.a.app.get(id).status, 'execution_unknown'); assert.equal(h.calls, 0);
});

test('R06 authorization, token rotation, malformed target and input corruption fail closed', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission();
  await assert.rejects(() => new RemoteClient(h.url, 'bad'.repeat(15)).session(), /RELAY_401/);
  assert.throws(() => new RemoteClient('http://example.com', devices[0].token), /HTTPS_REQUIRED/);
  const id = await h.a.app.submitImages(images); const row = h.a.app.get(id);
  await assert.rejects(() => h.client().submit(id, { ...row.submission, targetWorkerId: 'forged' }, images), /RELAY_409/);
  await assert.rejects(() => h.client().submit(id, row.submission, [Buffer.from('partial png')]), /RELAY_400/);
  await assert.rejects(() => h.client().submit(id, { ...row.submission, images: [{ ...row.submission.images[0], fileName: '../escape.png' }] }, images), /RELAY_400/);
  h.rotate(); await assert.rejects(() => h.client().session(), /RELAY_401/);
  await rpc(h.a, 'remote-configure', { token: 'z'.repeat(40) }); await h.sync(h.a); assert.equal(h.a.remote.info(id).upload, 'acknowledged');
  const snapshot = JSON.stringify(await rpc(h.a, 'snapshot')); const settings = readFileSync(join(h.root, 'a', 'settings.json'), 'utf8');
  for (const token of [devices[0].token, 'z'.repeat(40)]) { assert.equal(snapshot.includes(token), false); assert.equal(settings.includes(token), false); }
  await rpc(h.a, 'remote-delete-token'); assert.equal(h.credentials.values.size, 0); assert.equal((await rpc(h.a, 'snapshot')).remote.mode, 'local');
});

test('R06 receiver rejects forged origin, corrupted artifact and oversized response before local publication', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission(); const id = await h.a.app.submitImages(images); await h.sync(h.a); await h.work();
  const original = globalThis.fetch; let fault = 'hash';
  globalThis.fetch = async (url, init) => {
    const response = await original(url, init);
    if (String(url).includes(`/v1/tasks/${id}/files/`) && fault === 'hash') return new Response('corrupt');
    if (String(url).endsWith(`/v1/tasks/${id}`) && fault === 'origin') { const task = await response.json(); task.originDeviceId = 'other-device'; return Response.json(task); }
    if (String(url).endsWith(`/v1/tasks/${id}`) && fault === 'oversize') return new Response('x'.repeat(8 * 1024 * 1024 + 1));
    return response;
  };
  t.after(() => { globalThis.fetch = original; });
  await h.sync(h.a); assert.equal(h.a.remote.info(id).error, 'ARTIFACT_INTEGRITY'); assert.equal(h.a.app.get(id).status, 'queued'); assert.equal(h.cb.files.length, 0);
  fault = 'origin'; await h.sync(h.a); assert.equal(h.a.remote.info(id).error, 'REMOTE_IDENTITY_MISMATCH');
  fault = 'oversize'; await h.sync(h.a); assert.equal(h.a.remote.info(id).error, 'RELAY_RESPONSE_TOO_LARGE');
  fault = ''; await h.sync(h.a); assert.equal(h.a.app.get(id).status, 'succeeded');
});

test('R02/R04 two desktop processes: background Worker polls and origin automatically receives once', async t => {
  const h = await harness(t);
  await rpc(h.b, 'remote-configure', { receive: false }); await h.sync(h.b);
  const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('./remote-host.mjs', import.meta.url)), join(h.root, 'process-b')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', b => { stderr += b; });
  const pending = []; const lines = createInterface({ input: child.stdout });
  lines.on('line', line => { const next = pending.shift(); if (next) next(JSON.parse(line)); });
  const call = async (command, args = {}) => {
    const response = new Promise(resolve => pending.push(resolve)); child.stdin.write(JSON.stringify({ v: 1, command, ...args }) + '\n');
    const value = await Promise.race([response, delay(15000, undefined, { ref: false }).then(() => { throw Error(`process RPC timeout ${command} ${stderr}`); })]);
    assert.equal(value.ok, true, JSON.stringify(value)); return value.value;
  };
  h.addCleanup(async () => { child.stdin.end(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); lines.close(); });
  child.stdin.write('SHOT2AGENT/1\n');
  await call('remote-configure', { url: h.url, token: devices[1].token, receive: true }); await call('remote-test');
  const { images } = await syntheticSubmission(); h.cb.image = images[0]; await rpc(h.a, 'current');
  const id = h.a.app.list()[0].submission.taskId;
  for (let i = 0; i < 160 && h.a.app.get(id).status !== 'succeeded'; i++) { await h.a.tick(); await delay(60); }
  assert.equal(h.a.app.get(id).status, 'succeeded'); assert.equal((await call('snapshot')).testExecutions, 1); assert.equal(h.a.app.get(id).attempts.length, 1);
  assert.equal((await call('snapshot')).total, 0); // B never auto-delivers/browses another origin's task.
});

test('R07 independent return channels, history-only, sticky Smart guard and real local file references', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission();
  const blocked = join(h.root, 'blocked'); writeFileSync(blocked, 'not a directory');
  await rpc(h.a, 'configure', { delivery: { clipboard: 'always', clipboardPayload: 'files', saveDirectory: blocked, notification: true }, alwaysConsent: true });
  const id = await h.a.app.submitImages(images, { session: h.cb.session, sequence: h.cb.seq }); await h.sync(h.a); await h.work(); await h.sync(h.a); await h.a.app.work();
  assert.equal(h.a.app.state.get(id, 'save').status, 'failed'); assert.equal(h.a.app.state.get(id, 'clipboard').status, 'succeeded'); assert.equal(h.cb.notices, 1); assert.equal(h.cb.files.length, 1);
  assert.ok(h.cb.files[0][0].startsWith(join(h.root, 'a'))); assert.ok(!h.cb.files[0][0].startsWith('http'));
  await rpc(h.a, 'configure', { delivery: { clipboard: 'smart' } });
  const smart = await h.a.app.submitImages(images, { session: h.cb.session, sequence: '1' }); h.cb.seq = '2'; await h.sync(h.a); await h.work(); await h.sync(h.a); await h.a.app.work();
  assert.equal(h.a.app.state.get(smart, 'clipboard').status, 'blocked_by_clipboard_change');
  await rpc(h.a, 'configure', { delivery: { clipboard: 'off' } });
  const off = await h.a.app.submitImages(images); await h.sync(h.a); await h.work(); await h.sync(h.a); await h.a.app.work();
  assert.equal(h.a.app.get(off).status, 'succeeded'); for (const c of ['save', 'clipboard', 'notification']) assert.equal(h.a.app.state.get(off, c).status, 'disabled');
});

test('R01/R08 mode changes affect new tasks only, standalone Local makes zero Relay calls and shared execution slot', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission();
  const remote = await h.a.app.submitImages(images);
  await rpc(h.a, 'remote-configure', { mode: 'local' }); const local = await h.a.app.submitImages(images); const before = h.requests;
  await h.a.app.work(); assert.equal(h.requests, before); assert.equal(h.a.app.get(local).status, 'succeeded'); assert.equal(h.a.app.get(remote).status, 'queued');
  assert.equal(h.a.app.core.store.tasks().length, 1);
  await h.sync(h.a); let release; let active = 0; let max = 0;
  const slow = { name: 'fake', version: '1', async execute(...args) { active++; max = Math.max(max, active); if (!release) await new Promise(r => { release = r; }); active--; return new FakeAgent().execute(...args); } };
  const entry = { adapter: slow, profile: FAKE_PROFILE }; h.b.app.setRegistry([entry], FAKE_PROFILE.id, FAKE_PROFILE.version);
  const localB = await h.b.app.submitImages(images); const working = h.b.app.work();
  while (!release) await delay(2);
  assert.equal(await h.b.app.work(undefined, new RemoteClient(h.url, devices[1].token)), false); release(); await working;
  await h.work(); await h.sync(h.a); assert.equal(max, 1); assert.equal(h.b.app.get(localB).status, 'succeeded'); assert.equal(h.a.app.get(remote).status, 'succeeded');
});

test('R08 private orphan cleanup runs only once after exclusive ownership, never during capture rearm', async t => {
  const h = await harness(t);
  const staged = h.a.remote.core.blobs.put(Buffer.from('synthetic partial download'), { fileName: 'result.txt', contentType: 'text/plain' });
  const path = join(h.root, 'a', 'remote', 'blobs', staged.fileId);
  await h.a.start(); assert.equal(existsSync(path), true, 'rearm must not remove an in-flight download');
  await h.restartA(); assert.equal(existsSync(path), false, 'a new exclusively owned process can remove the abandoned blob');
});

test('R06 bounded receiver refuses cache exhaustion before downloading or publishing a result', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission(); const id = await h.a.app.submitImages(images); await h.sync(h.a); await h.work();
  // Synthetic accounting fixture reaches the budget without allocating 512 MiB on the test machine.
  const sentinel = randomUUID(); const task = h.a.app.get(id);
  h.a.remote.core.store.putMetadata(`outbox:${sentinel}`, JSON.stringify({ version: 1, key: sentinel, deleted: true, metadata: { ...task.submission, taskId: sentinel }, files: [{ fileId: randomUUID(), byteSize: 512 * 1024 * 1024 }] }));
  await h.sync(h.a); assert.equal(h.a.remote.info(id).error, 'REMOTE_CACHE_FULL'); assert.equal(h.a.app.get(id).status, 'queued'); assert.equal(h.cb.files.length, 0);
});

test('R08 changing device Token never migrates an existing outbox to the new identity', async t => {
  const h = await harness(t); const { images } = await syntheticSubmission(); const id = await h.a.app.submitImages(images);
  await rpc(h.a, 'remote-configure', { token: devices[2].token }); await h.sync(h.a);
  assert.equal(h.core.store.tasks().length, 0); assert.equal(h.a.remote.info(id).error, 'REMOTE_CONNECTION_CHANGED');
  await rpc(h.a, 'remote-configure', { token: devices[0].token }); await h.sync(h.a);
  assert.equal(h.core.store.tasks()[0].originDeviceId, 'a'); assert.equal(h.a.app.list()[0].submission.taskId, id);
});
