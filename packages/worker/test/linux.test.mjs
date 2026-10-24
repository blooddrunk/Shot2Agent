import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync, copyFileSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { LinuxWorkerState, DurableWorkerPort, validateLinuxConfig, approveLinux, linuxEntries, preflightLinux, loadLinuxProfiles } from '../src/linux-worker.ts';
import { LinuxProcessOwner, linuxProcesses, privateFile, stopLinuxGroup } from '../src/linux-platform.ts';
import { resolveProgram, programDigest } from '../src/discovery.ts';
import { boundedProcess } from '../src/process.ts';
import { executionRegistry } from '../src/registry.ts';
import { runOnce } from '../src/worker.ts';
import { FAKE_PROFILE, FakeAgent } from '../src/fake.ts';
import { validateRelayUrl, validateWorkerRelayUrl, RemoteClient } from '../../../services/relay/src/client.ts';
import { createRelay } from '../../../services/relay/src/server.ts';
import { openCore } from '../../core/src/core.ts';
import { syntheticSubmission } from '../../../apps/cli/src/fixture.ts';
import { sha256 } from '../../core/src/blobs.ts';
import { DesktopController } from '../../desktop/src/controller.ts';
import { credentialStore } from '../../../apps/desktop/tests/fixtures.mjs';
const linux = process.platform === 'linux' && process.getuid() !== 0;
const native = (name, fn) => test(name, { skip: !linux }, fn);
const info = { profileFingerprint: FAKE_PROFILE.fingerprint, adapterName: 'fake', adapterVersion: '1', timeoutMs: 5000 };
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-linux-')));
  for (const name of ['data', 'scratch', 'workspace', 'secrets']) mkdirSync(join(root, name), { mode: 0o700 });
  writeFileSync(join(root, 'secrets', 'worker.token'), 'w'.repeat(40), { mode: 0o600 });
  writeFileSync(join(root, 'secrets', 'agent'), 'synthetic-gateway-token', { mode: 0o600 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const c = { url: 'http://127.0.0.1:1/', ownerId: 'test', deviceId: 'linux', label: 'Linux VPS', tokenFile: join(root, 'secrets', 'worker.token'), stateRoot: join(root, 'data'), scratchRoot: join(root, 'scratch'), workspace: join(root, 'workspace'), fake: false };
  const pkg = join(root, 'mock-claude'); mkdirSync(pkg);
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', type: 'module', bin: { claude: 'cli.js' } }));
  copyFileSync('scripts/fixtures/linux-mock-cli.mjs', join(pkg, 'cli.js')); chmodSync(join(pkg, 'cli.js'), 0o700);
  return { root, c, pkg, cli: join(pkg, 'cli.js'), secret: join(root, 'secrets', 'agent') };
}
async function approval(h, provider = 'claude-compatible-endpoint') {
  if (provider === 'claude') writeFileSync(h.secret, '{}');
  await approveLinux(h.c, provider, h.cli, 'linux-claude', h.secret, 'https://open.bigmodel.cn/api/anthropic', 'glm-5.3-flash');
  return linuxEntries(h.c)[0];
}
async function relay(t, root, now = Date.now) {
  const devices = [{ ownerId: 'test', deviceId: 'a', token: 'a'.repeat(40), role: 'desktop' }, { ownerId: 'test', deviceId: 'linux', token: 'w'.repeat(40), role: 'worker' }, { ownerId: 'test', deviceId: 'windows', token: 'b'.repeat(40), role: 'desktop' }];
  const core = openCore(join(root, 'relay'), 'remote', now); const server = await createRelay(core, devices);
  await server.listen({ host: '127.0.0.1', port: 0 }); t.after(async () => { await server.close(); core.close(); });
  const url = `http://127.0.0.1:${server.server.address().port}/`;
  return { core, server, url, a: new RemoteClient(url, devices[0].token), b: new RemoteClient(url, devices[1].token), windows: new RemoteClient(url, devices[2].token) };
}
function bind(metadata, entry = { profile: FAKE_PROFILE, adapter: new FakeAgent() }, worker = 'linux') {
  return { ...metadata, profileId: entry.profile.id, profileVersion: entry.profile.version, profileFingerprint: entry.profile.fingerprint, provider: entry.adapter.name, targetWorkerId: worker };
}
function caps(entry = { profile: FAKE_PROFILE, adapter: new FakeAgent() }) { return [{ ...entry.profile, provider: entry.adapter.name }]; }
async function until(fn, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(30); } throw Error('ISOLATED_TEST_TIMEOUT'); }

test('Linux transport option never relaxes desktop HTTPS or allows public/mismatched internal origins', () => {
  for (const url of ['http://relay:3100/', 'http://8.8.8.8/', 'http://relay.evil/', 'http://user@relay:3100/', 'http://relay:3100/path', 'http://relay:3100/?x=1']) assert.throws(() => validateRelayUrl(url), /HTTPS_REQUIRED/);
  for (const url of ['http://8.8.8.8/', 'http://relay.evil/', 'http://relay:3100/path', 'http://relay:3100/?x=1', 'https://relay/']) assert.throws(() => validateWorkerRelayUrl(url, url), /INVALID_INTERNAL_RELAY/);
  assert.throws(() => validateWorkerRelayUrl('http://relay:3100/', 'http://relay:3101/'), /INVALID_INTERNAL_RELAY/);
  if (process.platform === 'linux') validateWorkerRelayUrl('http://relay:3100/', 'http://relay:3100/');
});
native('Linux approval pins executable/uid/workspace, refuses unsafe secrets and shell wrappers, and never invokes a model', async t => {
  const h = fixture(t); validateLinuxConfig(h.c); const e = await approval(h); const policy = loadLinuxProfiles(h.c)[0];
  assert.equal(existsSync(join(h.pkg, 'executions.jsonl')), false); assert.equal(policy.policy.linux.uid, process.getuid());
  assert.equal(policy.policy.digest, programDigest(resolveProgram('claude', h.cli)));
  const link = join(h.root, 'claude'); symlinkSync(h.cli, link); assert.deepEqual(resolveProgram('claude', link), resolveProgram('claude', h.cli));
  const shell = join(h.root, 'shell'); writeFileSync(shell, '#!/bin/sh\necho bad', { mode: 0o700 }); assert.throws(() => resolveProgram('claude', shell), /NATIVE_CLI_REQUIRED/);
  chmodSync(h.secret, 0o644); assert.throws(() => privateFile(h.secret), /UNSAFE_LINUX_SECRET/); chmodSync(h.secret, 0o600);
  assert.throws(() => validateLinuxConfig({ ...h.c, workspace: h.c.stateRoot }), /WORKER_PATHS_OVERLAP/);
  assert.throws(() => validateLinuxConfig({ ...h.c, tokenFile: h.secret }), /INVALID_WORKER_TOKEN/);
  writeFileSync(h.cli, readFileSync(h.cli, 'utf8') + '\n// changed'); await assert.rejects(preflightLinux(policy), /LINUX_APPROVAL_EXPIRED/);
  assert.notEqual(e.profile.fingerprint, FAKE_PROFILE.fingerprint);
});
native('Linux approved Claude subscription and GLM adapters preserve ordered large images, private environment, refusal and cleanup', async t => {
  for (const provider of ['claude', 'claude-compatible-endpoint']) {
    const h = fixture(t); const e = await approval(h, provider); const { metadata, images } = await syntheticSubmission(5);
    const large = await sharp(randomBytes(1200 * 1200 * 3), { raw: { width: 1200, height: 1200, channels: 3 } }).png().toBuffer(); assert.ok(large.length > 4 * 1024 * 1024);
    images[2] = large; metadata.images[2] = { fileName: 'large.png', contentType: 'image/png', byteSize: large.length, sha256: sha256(large) };
    const task = bind(metadata, e); const before = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = 'synthetic-secret-must-not-inherit';
    let result; try { result = await e.adapter.execute(task, e.profile, images, new AbortController().signal); } finally { if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before; }
    assert.equal(result.status, 'succeeded', JSON.stringify(result)); assert.match(result.contentMarkdown, /5 image/);
    const record = JSON.parse(readFileSync(join(h.pkg, 'executions.jsonl'), 'utf8').trim());
    assert.deepEqual(record.images, images.map(b => b.length)); assert.equal(record.inheritedSecret, false); assert.equal(record.cwd, h.c.workspace); assert.equal(existsSync(record.home), false);
    assert.equal(JSON.stringify(result).includes('synthetic-gateway-token'), false);
    const p = loadLinuxProfiles(h.c)[0]; p.policy.linux.uid++;
    const refused = executionRegistry([p])[0]; const refusal = await refused.adapter.execute(bind(metadata, refused), refused.profile, images, new AbortController().signal);
    assert.equal(refusal.status, 'failed'); assert.match(refusal.errorCode, /ISOLATION_REFUSED/);
  }
});
native('Linux process cancellation, timeout, abnormal exit and successful-parent orphan cleanup settle all descendants', async t => {
  const h = fixture(t);
  for (const mode of ['tree', 'orphan', 'exit']) {
    writeFileSync(join(h.pkg, 'mode'), mode); const abort = new AbortController();
    const invocation = JSON.stringify({ message: { content: [{ type: 'image', source: { data: 'eA==' } }] } });
    const result = await boundedProcess({ executable: realpathSync(process.execPath), args: [h.cli] }, [], { cwd: h.c.workspace, input: invocation, timeoutMs: mode === 'tree' ? 500 : 5000, signal: abort.signal });
    await result.settled;
    const record = JSON.parse(readFileSync(join(h.pkg, 'executions.jsonl'), 'utf8').trim().split('\n').at(-1));
    assert.equal(linuxProcesses().some(p => p.pid === record.child && !['Z', 'X'].includes(p.state)), false);
    assert.equal(result.stopped, mode === 'tree'); if (mode === 'exit') { assert.equal(result.code, 7); assert.equal(result.output.includes('PRIVATE_MOCK_ERROR'), false); }
  }
  writeFileSync(join(h.pkg, 'mode'), 'tree'); const abort = new AbortController();
  const result = boundedProcess({ executable: realpathSync(process.execPath), args: [h.cli] }, [], { cwd: h.c.workspace, input: '{"message":{"content":[]}}', signal: abort.signal, timeoutMs: 5000 });
  await until(() => readFileSync(join(h.pkg, 'executions.jsonl'), 'utf8').trim().split('\n').length === 4); abort.abort(); const stopped = await result; await stopped.settled; assert.equal(stopped.stopped, true);
});
native('Linux durable settlement retries only results; start uncertainty, duplicate claim, fencing and restart never replay execution', async t => {
  const h = fixture(t); let now = Date.now(); const r = await relay(t, h.root, () => now); await r.b.presence('Linux', caps(), true);
  const state = new LinuxWorkerState(h.c.stateRoot); t.after(() => state.close()); const port = new DurableWorkerPort(r.b, state, 'linux');
  assert.throws(() => new LinuxWorkerState(h.c.stateRoot), /WORKER_ALREADY_RUNNING/); state.bind({ ...h.c, fake: true });
  assert.throws(() => state.bind({ ...h.c, fake: true, deviceId: 'different' }), /WORKER_STATE_IDENTITY_CHANGED/);
  const { metadata, images } = await syntheticSubmission(); const task = bind(metadata); await r.a.submit(task.taskId, task, images); await r.a.submit(task.taskId, task, images);
  const claim = await port.claim([FAKE_PROFILE]); assert.equal(await port.claim([FAKE_PROFILE]), null); await port.start(task.taskId, claim.proof, info);
  const result = await new FakeAgent().execute(task, FAKE_PROFILE, images, new AbortController().signal);
  const original = r.b.complete.bind(r.b); let calls = 0; r.b.complete = async (...a) => { calls++; await original(...a); throw Error('LOST_ACK'); };
  await assert.rejects(port.complete(task.taskId, claim.proof, result), /LOST_ACK/); assert.ok(state.get('pending').result);
  r.b.complete = original; await port.recover(); assert.equal(calls, 1); assert.equal((await r.a.get(task.taskId)).attempts.length, 1); assert.equal(await port.claim([FAKE_PROFILE]), null);
  const next = await syntheticSubmission(); const unknown = bind(next.metadata); await r.a.submit(unknown.taskId, unknown, next.images); const lease = await port.claim([FAKE_PROFILE]); await port.start(unknown.taskId, lease.proof, info);
  await port.recover(); assert.equal((await r.a.get(unknown.taskId)).status, 'execution_unknown'); assert.equal(await port.claim([FAKE_PROFILE]), null);
  await assert.rejects(r.b.complete(unknown.taskId, lease.proof, result), /RELAY_409/); now += 31_000; assert.equal(await port.claim([FAKE_PROFILE]), null);
  await assert.rejects(new RemoteClient(r.url, 'invalid'.repeat(6)).session(), /RELAY_401/);
});
native('Linux restart reconciles a surviving owned process group before admitting more work and refuses corrupt journals', async t => {
  const h = fixture(t); const owner = new LinuxProcessOwner(h.c.stateRoot);
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' }); await once(child, 'spawn'); owner.spawned(child.pid);
  await owner.recover(); assert.equal(linuxProcesses().some(p => p.pid === child.pid && p.state !== 'Z'), false); await stopLinuxGroup(child.pid);
  writeFileSync(join(h.c.stateRoot, 'process.json'), '{broken'); await assert.rejects(owner.recover());
  writeFileSync(join(h.c.stateRoot, 'worker.sqlite'), 'corrupt database'); assert.throws(() => new LinuxWorkerState(h.c.stateRoot));
});
native('Linux start-journal storage failure refuses launch, corrupt input refuses CLI and wrong target/role cannot execute', async t => {
  const h = fixture(t); const e = await approval(h); const r = await relay(t, h.root); await r.b.presence('Linux', caps(e), true);
  const state = new LinuxWorkerState(h.c.stateRoot); t.after(() => state.close()); const port = new DurableWorkerPort(r.b, state, 'linux');
  const { metadata, images } = await syntheticSubmission(); const task = bind(metadata, e); await r.a.submit(task.taskId, task, images);
  const put = state.put.bind(state); state.put = () => { throw Error('SYNTHETIC_DISK_FULL'); };
  await assert.rejects(runOnce(port, e.adapter, [e.profile]), /SYNTHETIC_DISK_FULL/); assert.equal(existsSync(join(h.pkg, 'executions.jsonl')), false);
  state.put = put;
  const wrong = new DurableWorkerPort(r.b, state, 'wrong-device');
  // Wrong-target upload cannot enter the queue and a role=worker cannot submit new tasks.
  const next = await syntheticSubmission();
  await assert.rejects(r.a.submit(next.metadata.taskId, bind(next.metadata, e, 'missing'), next.images), /RELAY_409/);
  await assert.rejects(r.b.submit(next.metadata.taskId, bind(next.metadata, e), next.images), /RELAY_403/);
  assert.equal(await wrong.claim([e.profile]), null);
  // Independent unleased fixture verifies the exact pre-launch input-integrity contract.
  const core = openCore(join(h.root, 'integrity'), 'local');
  try {
    const origin = { ownerId: 'x', deviceId: 'origin' }; const m = bind(next.metadata, e); delete m.targetWorkerId;
    await core.submit(origin, m.taskId, m, next.images); const local = core.worker({ ownerId: 'x', deviceId: 'linux' });
    local.file = async () => Buffer.from('partial-image');
    assert.equal(await runOnce(local, e.adapter, [e.profile]), true);
    assert.equal(core.get('x', m.taskId).result.errorCode, 'INPUT_INTEGRITY'); assert.equal(existsSync(join(h.pkg, 'executions.jsonl')), false);
  } finally { core.close(); }
});
native('Desktop origin → real HTTP Relay → Linux daemon → original history, offline restart and Windows Worker compatibility', async t => {
  const h = fixture(t); const r = await relay(t, h.root); const creds = credentialStore();
  const clipboard = { session: 'linux-fixture', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, async writeFiles() { return true; }, async notify() {}, close() {} };
  const a = new DesktopController(join(h.root, 'desktop-a'), clipboard, undefined, 'staging', async () => [], { credentials: creds }); await a.start(); t.after(() => a.close());
  let child; const start = () => {
    child = spawn(process.execPath, ['--experimental-strip-types', resolve('apps/cli/src/linux-worker.ts')], { env: { ...process.env, SHOT2AGENT_RELAY_URL: r.url, SHOT2AGENT_WORKER_OWNER: 'test', SHOT2AGENT_WORKER_DEVICE: 'linux', SHOT2AGENT_WORKER_ROOT: h.c.stateRoot, SHOT2AGENT_WORKER_SCRATCH: h.c.scratchRoot, SHOT2AGENT_WORKER_TOKEN_FILE: h.c.tokenFile, SHOT2AGENT_WORKSPACE: h.c.workspace, SHOT2AGENT_WORKER_FAKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] }); child.stdout.resume(); child.stderr.resume(); return child;
  };
  const stop = async () => { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill('SIGTERM'); await exit; } };
  t.after(stop); start(); await until(async () => (await r.a.workers()).find(w => w.deviceId === 'linux' && w.accepting));
  const rpc = (command, args = {}) => a.dispatch({ v: 1, command, ...args });
  await rpc('remote-configure', { url: r.url, token: 'a'.repeat(40) }); await rpc('remote-test'); await rpc('remote-select', { deviceId: 'linux', id: FAKE_PROFILE.id, version: FAKE_PROFILE.version }); await rpc('remote-configure', { mode: 'remote' });
  await stop(); const { images } = await syntheticSubmission(5); const id = await a.app.submitImages(images); await a.tick(); assert.equal(a.app.get(id).status, 'queued');
  start(); await until(async () => { await a.tick(); return a.app.get(id).status === 'succeeded'; });
  assert.equal(a.app.get(id).result.workerId, 'linux'); assert.equal(a.app.get(id).attempts.length, 1); assert.equal(a.app.core.store.tasks().length, 0);
  await stop(); start(); await until(async () => (await r.a.workers()).find(w => w.deviceId === 'linux' && w.accepting)); assert.equal((await r.a.get(id)).attempts.length, 1);
  await r.windows.presence('Windows B', caps(), true); const next = await syntheticSubmission(); const m = bind(next.metadata, undefined, 'windows'); await r.a.submit(m.taskId, m, next.images);
  assert.equal(await runOnce(r.windows, new FakeAgent(), [FAKE_PROFILE]), true); assert.equal((await r.a.get(m.taskId)).result.workerId, 'windows');
  assert.equal((await r.a.workers()).length, 2);
});
