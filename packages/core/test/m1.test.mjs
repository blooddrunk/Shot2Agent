import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { openCore } from '../src/core.ts';
import { sha256 } from '../src/blobs.ts';
import { syntheticSubmission } from '../../../apps/cli/src/fixture.ts';
import { createRelay } from '../../../services/relay/src/server.ts';
import { RemoteClient } from '../../../services/relay/src/client.ts';
import { runOnce } from '../../worker/src/worker.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
const capture = { ownerId: 'owner', deviceId: 'capture' };
const worker = { ownerId: 'owner', deviceId: 'worker' };
const devices = [
  { ...capture, role: 'capture', token: 'c'.repeat(40) },
  { ...worker, role: 'worker', token: 'w'.repeat(40) },
  { ownerId: 'owner', deviceId: 'worker2', role: 'worker', token: 'x'.repeat(40) },
  { ownerId: 'other', deviceId: 'capture2', role: 'capture', token: 'o'.repeat(40) },
  { ownerId: 'owner', deviceId: 'viewer', role: 'viewer', token: 'v'.repeat(40) },
];
const capabilities = [{ id: FAKE_PROFILE.id, version: FAKE_PROFILE.version }];
const info = { profileFingerprint: FAKE_PROFILE.fingerprint, adapterName: 'fake', adapterVersion: '1', timeoutMs: 5000 };
const success = { status: 'succeeded', summary: 'ok', contentMarkdown: '# Result', artifacts: [] };
async function harness(t, mode) {
  const root = mkdtempSync(join(tmpdir(), 'shot2agent-'));
  let now = 1_000_000;
  let core = openCore(root, mode, () => now, 1000);
  let server; let client; let port; let url;
  async function connect() {
    if (mode === 'local') {
      client = { submit: (key, meta, bytes) => core.submit(capture, key, meta, bytes),
        get: async id => core.get(capture.ownerId, id), list: async () => core.list(capture.ownerId),
        file: async (id, file) => core.file(capture.ownerId, id, file) };
      port = core.worker(worker);
    } else {
      server = await createRelay(core, devices);
      url = await server.listen({ host: '127.0.0.1', port: 0 });
      client = new RemoteClient(url, devices[0].token); port = new RemoteClient(url, devices[1].token);
    }
  }
  await connect();
  t.after(async () => { if (server) await server.close(); core.close(); rmSync(root, { recursive: true, force: true }); });
  return {
    root, get core() { return core; }, get client() { return client; }, get port() { return port; }, get url() { return url; },
    advance(ms) { now += ms; },
    async restart() { if (server) await server.close(); core.close(); core = openCore(root, mode, () => now, 1000); await connect(); },
    async submit(count = 1) { const fixture = await syntheticSubmission(count); await client.submit(fixture.metadata.taskId, fixture.metadata, fixture.images); return fixture; },
  };
}
for (const mode of ['local', 'remote']) {
  for (const count of [1, 5]) test(`${mode}: ${count} ordered images -> Fake -> persisted result and artifacts`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit(count);
    assert.equal((await h.client.get(metadata.taskId)).status, 'queued');
    assert.equal(await runOnce(h.port, new FakeAgent(), [FAKE_PROFILE]), true);
    const task = await h.client.get(metadata.taskId);
    assert.equal(task.mode, mode); assert.equal(task.status, 'succeeded'); assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].profileFingerprint, FAKE_PROFILE.fingerprint);
    assert.equal(task.attempts[0].token, undefined);
    assert.equal(task.result.profileId, metadata.profileId); assert.equal(task.result.workerId, worker.deviceId);
    assert.deepEqual(task.submission.images, metadata.images);
    assert.equal(task.result.contentMarkdown, (await new FakeAgent().execute(metadata, FAKE_PROFILE, Array(count).fill(new Uint8Array()), new AbortController().signal)).contentMarkdown);
    assert.equal((await h.client.file(metadata.taskId, task.result.artifacts[0].fileId)).toString(), task.result.contentMarkdown);
    await h.restart();
    assert.deepEqual(await h.client.get(metadata.taskId), task);
    assert.equal(await runOnce(h.port, new FakeAgent(), [FAKE_PROFILE]), false);
  });
  test(`${mode}: queue survives restart and upload replays do not duplicate or overwrite`, async t => {
    const h = await harness(t, mode); const { metadata, images } = await h.submit();
    await h.restart();
    await h.client.submit(metadata.taskId, metadata, images);
    assert.equal((await h.client.list()).tasks.length, 1);
    await assert.rejects(async () => h.client.submit(metadata.taskId, { ...metadata, taskInstructions: 'changed' }, images), /CONFLICT|409/);
    await assert.rejects(async () => h.client.submit(metadata.taskId, { ...metadata, taskId: randomUUID() }, images), /CONFLICT|409/);
    await assert.rejects(async () => h.client.submit('different', metadata, images), /CONFLICT|409/);
    assert.equal(await runOnce(h.port, new FakeAgent(), [FAKE_PROFILE]), true);
  });
  test(`${mode}: concurrent claims, worker identity, heartbeat, expiration and fencing`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit();
    await h.submit();
    const [a, b] = await Promise.all([h.port.claim(capabilities), h.port.claim(capabilities)]);
    assert.equal([a, b].filter(Boolean).length, 1); const first = a ?? b;
    const other = mode === 'local' ? h.core.worker({ ...worker, deviceId: 'worker2' }) : new RemoteClient(h.url, devices[2].token);
    await assert.rejects(() => other.start(metadata.taskId, first.proof, info), /STALE_LEASE|409/);
    h.advance(700); await h.port.heartbeat(metadata.taskId, first.proof);
    h.advance(500); assert.equal(await h.port.claim(capabilities), null);
    h.advance(600); await h.restart();
    const retry = await h.port.claim(capabilities); assert.ok(retry); assert.notEqual(retry.proof.attemptId, first.proof.attemptId);
    assert.equal(retry.task.attempts.length, 2);
    for (const action of [() => h.port.start(metadata.taskId, first.proof, info), () => h.port.heartbeat(metadata.taskId, first.proof),
      () => h.port.complete(metadata.taskId, first.proof, success)]) await assert.rejects(action, /STALE_LEASE|409/);
    await h.port.start(metadata.taskId, retry.proof, info);
    await h.port.start(metadata.taskId, retry.proof, info); // lost start acknowledgement is safe
    await assert.rejects(() => h.port.start(metadata.taskId, retry.proof, { ...info, adapterVersion: '2' }), /CONFLICT|409/);
    const completed = await h.port.complete(metadata.taskId, retry.proof, success);
    assert.deepEqual(await h.port.complete(metadata.taskId, retry.proof, success), completed);
    await assert.rejects(() => h.port.complete(metadata.taskId, retry.proof, { ...success, summary: 'changed' }), /CONFLICT|409/);
    assert.equal((await h.client.get(metadata.taskId)).status, 'succeeded');
  });
  test(`${mode}: after-start crash remains unknown after restart and is never automatically retried`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit();
    const claim = await h.port.claim(capabilities); await h.port.start(metadata.taskId, claim.proof, info);
    h.advance(1001); await h.restart();
    const task = await h.client.get(metadata.taskId);
    assert.equal(task.status, 'execution_unknown'); assert.equal(task.result.errorCode, 'LEASE_EXPIRED_AFTER_START');
    assert.equal(await h.port.claim(capabilities), null);
    await assert.rejects(() => h.port.complete(metadata.taskId, claim.proof, success), /STALE_LEASE|409/);
  });
  test(`${mode}: heartbeat cannot extend execution deadline or revive expired leases`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit();
    const claim = await h.port.claim(capabilities); await h.port.start(metadata.taskId, claim.proof, { ...info, timeoutMs: 1500 });
    h.advance(900); await h.port.heartbeat(metadata.taskId, claim.proof);
    h.advance(601);
    assert.equal((await h.client.get(metadata.taskId)).status, 'execution_unknown');
    assert.equal((await h.client.get(metadata.taskId)).result.errorCode, 'EXECUTION_DEADLINE');
    await assert.rejects(() => h.port.heartbeat(metadata.taskId, claim.proof), /STALE_LEASE|409/);
  });
  for (const behavior of ['fail', 'crash']) test(`${mode}: deterministic Fake ${behavior} is terminal without replay`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit();
    await runOnce(h.port, new FakeAgent(behavior), [FAKE_PROFILE]);
    assert.equal((await h.client.get(metadata.taskId)).status, behavior === 'fail' ? 'failed' : 'execution_unknown');
    assert.equal(await runOnce(h.port, new FakeAgent(), [FAKE_PROFILE]), false);
  });
  test(`${mode}: input content/hash/type and malformed metadata refusal leaves no partial task/files`, async t => {
    const h = await harness(t, mode); const { metadata, images } = await syntheticSubmission();
    for (const [meta, bytes] of [
      [metadata, [Buffer.from('not an image')]],
      [{ ...metadata, images: [{ ...metadata.images[0], sha256: '00'.repeat(32) }] }, images],
      [{ ...metadata, images: [{ ...metadata.images[0], fileName: '../escape.png' }] }, images],
      [{ ...metadata, images: [{ ...metadata.images[0], contentType: 'image/jpeg' }] }, images],
      [metadata, []],
    ]) await assert.rejects(async () => h.client.submit(metadata.taskId, meta, bytes));
    const broken = images[0].subarray(0, 40);
    await assert.rejects(async () => h.client.submit(metadata.taskId, { ...metadata, images: [{ ...metadata.images[0], sha256: sha256(broken), byteSize: broken.length }] }, [broken]));
    assert.equal((await h.client.list()).tasks.length, 0); assert.equal(readdirSync(join(h.root, 'blobs')).length, 0);
  });
  test(`${mode}: result bounds, artifact integrity and immutable completion`, async t => {
    const h = await harness(t, mode); const { metadata } = await h.submit(); const claim = await h.port.claim(capabilities);
    await assert.rejects(() => h.port.complete(metadata.taskId, claim.proof, success), /STALE_LEASE|409/);
    await h.port.start(metadata.taskId, claim.proof, info);
    for (const result of [null, { ...success, summary: 'x'.repeat(1025) }, { ...success, status: 'queued' },
      { ...success, artifacts: [{ fileName: '../x', contentType: 'text/plain', dataBase64: '', sha256: sha256('') }] },
      { ...success, artifacts: [{ fileName: 'x', contentType: 'text/plain', dataBase64: 'eA==', sha256: sha256('different') }] }]) {
      await assert.rejects(() => h.port.complete(metadata.taskId, claim.proof, result));
    }
    assert.equal((await h.client.get(metadata.taskId)).status, 'running');
    assert.equal(readdirSync(join(h.root, 'blobs')).length, 1);
    await h.port.complete(metadata.taskId, claim.proof, { ...success, status: 'timed_out', errorCode: 'ACKNOWLEDGED_STOP' });
    assert.equal((await h.client.get(metadata.taskId)).status, 'timed_out');
  });
}

test('Local CLI: separate processes persist queue/history with all network attempts blocked', t => {
  const root = mkdtempSync(join(tmpdir(), 's2a-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const guard = join(root, 'deny-network.mjs');
  writeFileSync(guard, `import net from 'node:net'; import http from 'node:http'; import https from 'node:https';\nconst denied = () => { throw new Error('NETWORK_FORBIDDEN'); };\nglobalThis.fetch = denied; net.Socket.prototype.connect = denied; net.Server.prototype.listen = denied; http.request = denied; https.request = denied;\n`);
  function cli(command, arg) {
    const env = { ...process.env, NODE_OPTIONS: '', SHOT2AGENT_RELAY_URL: 'https://must-not-contact.invalid', SHOT2AGENT_TOKEN: '' };
    const run = spawnSync(process.execPath, ['--import', pathToFileURL(guard).href, '--experimental-strip-types', 'apps/cli/src/local.ts', command, root, ...(arg ? [arg] : [])], { cwd: resolve('.'), env, encoding: 'utf8', timeout: 15000 });
    assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout);
  }
  const queued = cli('submit', '5'); assert.equal(queued.status, 'queued');
  assert.equal(cli('list').tasks.length, 1); assert.equal(cli('work').worked, true);
  const finished = cli('get', queued.submission.taskId); assert.equal(finished.status, 'succeeded');
  assert.equal(cli('work').worked, false); assert.deepEqual(cli('get', queued.submission.taskId), finished);
});

test('Local/Remote mode selection binds separate stores and never migrates existing work', async t => {
  const local = await harness(t, 'local'); const remote = await harness(t, 'remote'); const { metadata } = await local.submit();
  assert.throws(() => openCore(local.root, 'remote'), /MODE_STORAGE_MISMATCH/);
  assert.throws(() => openCore(remote.root, 'local'), /MODE_STORAGE_MISMATCH/);
  assert.equal((await remote.client.list()).tasks.length, 0);
  assert.equal((await local.client.get(metadata.taskId)).status, 'queued');
  assert.throws(() => new RemoteClient('http://example.com', 'token'), /HTTPS_REQUIRED/);
});

test('Remote: every route authenticates, roles and owner/device associations cannot be forged', async t => {
  const h = await harness(t, 'remote'); const { metadata, images } = await h.submit();
  const task = await h.client.get(metadata.taskId); const file = task.inputs[0].fileId;
  for (const [method, path] of [ ['GET', '/v1/tasks'], ['GET', `/v1/tasks/${metadata.taskId}`], ['GET', `/v1/tasks/${metadata.taskId}/files/${file}`],
    ['POST', '/v1/tasks'], ['POST', '/v1/worker/claim'], ...['start', 'heartbeat', 'complete', 'fail'].map(a => ['POST', `/v1/worker/tasks/${metadata.taskId}/${a}`]) ]) {
    assert.equal((await fetch(h.url + path, { method })).status, 401);
  }
  const other = new RemoteClient(h.url, devices[3].token);
  await assert.rejects(() => other.get(metadata.taskId), /404/);
  await assert.rejects(() => other.file(metadata.taskId, file), /404/);
  assert.equal((await other.list()).tasks.length, 0);
  await assert.rejects(() => other.submit(metadata.taskId, metadata, images), /409/);
  await assert.rejects(() => h.client.claim(capabilities), /403/);
  await assert.rejects(() => h.port.get(metadata.taskId), /403/);
  await assert.rejects(() => h.port.file(metadata.taskId, file), /403/);
  const viewer = new RemoteClient(h.url, devices[4].token);
  assert.equal((await viewer.get(metadata.taskId)).status, 'queued');
  await assert.rejects(() => viewer.submit('viewer', { ...metadata, taskId: randomUUID() }, images), /403/);
  const forged = { ...metadata, ownerId: 'other', originDeviceId: 'forged', command: 'delete', cwd: '/', sandbox: 'danger-full-access' };
  const newId = randomUUID(); const accepted = await h.client.submit(newId, { ...forged, taskId: newId }, images);
  assert.equal(accepted.ownerId, 'owner'); assert.equal(accepted.originDeviceId, 'capture');
  assert.equal(accepted.submission.command, undefined);
});

test('Remote: interrupted/duplicate/misordered multipart uploads publish nothing', async t => {
  const h = await harness(t, 'remote'); const { metadata, images } = await syntheticSubmission();
  async function send(body, key = metadata.taskId, headers = {}) {
    return fetch(h.url + '/v1/tasks', { method: 'POST', headers: { Authorization: `Bearer ${devices[0].token}`, 'Idempotency-Key': key, ...headers }, body });
  }
  let form = new FormData(); form.append('metadata', JSON.stringify(metadata));
  assert.equal((await send(form)).status, 400);
  form = new FormData(); form.append('image-0', new Blob([images[0]], { type: 'image/png' }), 'x.png'); form.append('metadata', JSON.stringify(metadata));
  assert.equal((await send(form)).status, 400);
  const body = `--broken\r\nContent-Disposition: form-data; name="metadata"\r\n\r\n${JSON.stringify(metadata)}\r\n--broken\r\nContent-Disposition: form-data; name="image-0"; filename="x.png"\r\nContent-Type: image/png\r\n\r\npartial`;
  assert.equal((await send(body, metadata.taskId, { 'Content-Type': 'multipart/form-data; boundary=broken' })).status, 400);
  assert.equal((await h.client.list()).tasks.length, 0); assert.equal(readdirSync(join(h.root, 'blobs')).length, 0);
  await h.client.submit(metadata.taskId, metadata, images);
});

test('Remote: simultaneous duplicate uploads are idempotent and pagination is private', async t => {
  const h = await harness(t, 'remote'); const { metadata, images } = await syntheticSubmission();
  const results = await Promise.all(Array.from({ length: 4 }, () => h.client.submit(metadata.taskId, metadata, images)));
  assert.equal(new Set(results.map(r => r.submission.taskId)).size, 1);
  assert.equal(readdirSync(join(h.root, 'blobs')).length, 1); await h.submit();
  const headers = { Authorization: `Bearer ${devices[0].token}` };
  const page = await (await fetch(`${h.url}/v1/tasks?limit=1`, { headers })).json(); assert.equal(page.tasks.length, 1); assert.ok(page.nextCursor);
  const next = await (await fetch(`${h.url}/v1/tasks?limit=1&cursor=${page.nextCursor}`, { headers })).json();
  assert.equal(next.tasks.length, 1); assert.notEqual(next.tasks[0].submission.taskId, metadata.taskId);
  assert.equal((await fetch(`${h.url}/v1/tasks?limit=101`, { headers })).status, 400);
});

test('SQLite: two independent connections serialize claims and preserve attempt history', async t => {
  const h = await harness(t, 'local'); const otherCore = openCore(h.root, 'local', () => 1_000_000, 1000);
  try {
    await h.submit(); await h.submit();
    const claims = await Promise.all([h.port.claim(capabilities), otherCore.worker(worker).claim(capabilities)]);
    assert.equal(claims.filter(Boolean).length, 1);
  } finally { otherCore.close(); }
});

test('Blob storage: decoded PNG/JPEG/WEBP, corruption, private permissions and symlink refusal', async t => {
  const h = await harness(t, 'local');
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).toFormat(format).toBuffer();
    const { metadata } = await syntheticSubmission(); metadata.images = [{ fileName: `fixture.${format}`, contentType: `image/${format}`, byteSize: bytes.length, sha256: sha256(bytes) }];
    const task = await h.client.submit(metadata.taskId, metadata, [bytes]);
    const path = join(h.root, 'blobs', task.inputs[0].fileId);
    if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
    writeFileSync(path, 'tampered'); await assert.rejects(() => h.client.file(metadata.taskId, task.inputs[0].fileId), /BLOB_INTEGRITY/);
    assert.equal(await runOnce(h.port, new FakeAgent(), [FAKE_PROFILE]), true);
    assert.equal((await h.client.get(metadata.taskId)).result.errorCode, 'INPUT_INTEGRITY');
    if (process.platform !== 'win32') {
      rmSync(path); symlinkSync(join(h.root, 'tasks.sqlite'), path);
      await assert.rejects(() => h.client.file(metadata.taskId, task.inputs[0].fileId), /UNSAFE_FILE/);
    }
  }
});

test('Storage failure: partial input/result writes roll back SQLite and remove newly staged blobs', async t => {
  const h = await harness(t, 'local'); const original = h.core.blobs.put.bind(h.core.blobs); let calls = 0;
  h.core.blobs.put = (...args) => { if (++calls === 2) throw new Error('INJECTED_DISK_FAILURE'); return original(...args); };
  const { metadata, images } = await syntheticSubmission(5);
  await assert.rejects(() => h.client.submit(metadata.taskId, metadata, images), /INJECTED/);
  assert.equal(h.core.list('owner').tasks.length, 0); assert.equal(readdirSync(join(h.root, 'blobs')).length, 0);
  h.core.blobs.put = original; const task = await h.submit(); const claim = await h.port.claim(capabilities); await h.port.start(task.metadata.taskId, claim.proof, info);
  const result = await new FakeAgent().execute(task.metadata, FAKE_PROFILE, task.images, new AbortController().signal);
  calls = 0; h.core.blobs.put = (...args) => { if (++calls === 2) throw new Error('INJECTED_DISK_FAILURE'); return original(...args); };
  await assert.rejects(() => h.port.complete(task.metadata.taskId, claim.proof, { ...result, artifacts: [...result.artifacts, ...result.artifacts] }), /INJECTED/);
  assert.equal((await h.client.get(task.metadata.taskId)).status, 'running'); assert.equal(readdirSync(join(h.root, 'blobs')).length, 1);
  h.core.blobs.put = original; await h.port.complete(task.metadata.taskId, claim.proof, result);
});

test('Worker: lost completion response retries only result, never executes Agent again', async t => {
  const h = await harness(t, 'local'); const { metadata } = await h.submit(); let executions = 0; let submitted;
  const port = h.port; const adapter = new FakeAgent(); const execute = adapter.execute.bind(adapter);
  adapter.execute = (...args) => { executions++; return execute(...args); };
  const unreliable = { ...port, complete: async (...args) => { submitted = args; await port.complete(...args); throw new Error('LOST_ACK'); } };
  await assert.rejects(() => runOnce(unreliable, adapter, [FAKE_PROFILE]), /LOST_ACK/);
  assert.equal((await h.client.get(metadata.taskId)).status, 'succeeded');
  await port.complete(...submitted); assert.equal(await runOnce(port, adapter, [FAKE_PROFILE]), false); assert.equal(executions, 1);
});

test('Worker: acknowledged Fake timeout vs adapter with unconfirmed stop', async t => {
  // This tests Worker stop acknowledgement, not SQLite latency against the coordinator deadline.
  // Deadline/fencing tests above advance an injected clock independently.
  const root = mkdtempSync(join(tmpdir(), 's2a-timeout-')); const core = openCore(root, 'local', () => 1_000_000);
  t.after(() => { core.close(); rmSync(root, { recursive: true, force: true }); });
  const profile = { ...FAKE_PROFILE, timeoutMs: 500 }; const port = core.worker(worker);
  for (const acknowledged of [true, false]) {
    const { metadata, images } = await syntheticSubmission(); await core.submit(capture, metadata.taskId, metadata, images);
    const adapter = acknowledged ? new FakeAgent('timeout') : { name: 'fake', version: '1', execute: () => new Promise(() => {}) };
    await runOnce(port, adapter, [profile]);
    assert.equal(core.get('owner', metadata.taskId).status, acknowledged ? 'timed_out' : 'execution_unknown');
  }
});

test('SQLite durability: abrupt subprocess exit preserves accepted task and verified blobs', async t => {
  const root = mkdtempSync(join(tmpdir(), 's2a-kill-')); let recoveredCore;
  t.after(() => { recoveredCore?.close(); rmSync(root, { recursive: true, force: true }); });
  const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { openCore } from './packages/core/src/core.ts';
    import { syntheticSubmission } from './apps/cli/src/fixture.ts';
    const core = openCore(process.argv[1]); const { metadata, images } = await syntheticSubmission();
    await core.submit({ ownerId: 'owner', deviceId: 'capture' }, metadata.taskId, metadata, images);
    process.stdout.write('ACCEPTED\\n'); setInterval(() => {}, 1000);
  `, root], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Child accept timeout')); }, 10000);
    child.once('error', reject); child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
  });
  const exit = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exit;
  const core = recoveredCore = openCore(root); const tasks = core.list('owner').tasks;
  assert.equal(tasks.length, 1); assert.equal(tasks[0].status, 'queued');
  assert.equal(sha256(core.file('owner', tasks[0].submission.taskId, tasks[0].inputs[0].fileId)), tasks[0].inputs[0].sha256);
});

test('SQLite: competing processes claim one task at most once', async t => {
  const h = await harness(t, 'local'); await h.submit();
  const code = `
    import { openCore } from './packages/core/src/core.ts';
    const core = openCore(process.argv[1], 'local', () => 1000000, 1000);
    try { process.stdout.write(JSON.stringify(core.claim({ownerId:'owner',deviceId:process.argv[2]}, [{id:'fake-readonly',version:'v1'}]))); }
    finally { core.close(); }
  `;
  const results = await Promise.all([1, 2, 3].map(index => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code, h.root, `worker${index}`]);
    let output = ''; let error = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', reject); child.on('exit', status => { if (status !== 0) reject(new Error(error)); else resolve(JSON.parse(output)); });
  })));
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(h.core.get('owner', results.find(Boolean).task.submission.taskId).attempts.length, 1);
});

test('Remote client refuses malformed Relay responses before Agent dispatch', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ task: { status: 'leased' } })));
  const client = new RemoteClient('http://127.0.0.1', 'test');
  await assert.rejects(() => client.claim(capabilities), /INVALID_RELAY_RESPONSE/);
  await assert.rejects(() => client.get(randomUUID()), /INVALID_RELAY_RESPONSE/);
  await assert.rejects(() => client.list(), /INVALID_RELAY_RESPONSE/);
});

for (const mode of ['local', 'remote']) test(`${mode}: failed result delivery leaves started task uncertain without Agent replay`, async t => {
  const h = await harness(t, mode); const { metadata } = await h.submit();
  const original = h.port; let executions = 0; const agent = new FakeAgent(); const execute = agent.execute.bind(agent);
  agent.execute = (...args) => { executions++; return execute(...args); };
  const disconnected = {
    claim: (...args) => original.claim(...args), start: (...args) => original.start(...args),
    heartbeat: (...args) => original.heartbeat(...args), file: (...args) => original.file(...args),
    complete: async () => { throw new Error('RESULT_TRANSPORT_DOWN'); },
  };
  await assert.rejects(() => runOnce(disconnected, agent, [FAKE_PROFILE]), /RESULT_TRANSPORT_DOWN/);
  h.advance(1001); await h.restart(); assert.equal((await h.client.get(metadata.taskId)).status, 'execution_unknown');
  assert.equal(await runOnce(h.port, agent, [FAKE_PROFILE]), false); assert.equal(executions, 1);
});

test('Remote CLI: separate capture and Worker processes complete authenticated round trip', async t => {
  const h = await harness(t, 'remote');
  function cli(command, token) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', 'apps/cli/src/remote.ts', command, '5'], {
        env: { ...process.env, SHOT2AGENT_RELAY_URL: h.url, SHOT2AGENT_TOKEN: token }, timeout: 15000,
      });
      let output = ''; let error = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
      child.on('error', reject); child.on('exit', code => { if (code !== 0) reject(new Error(error)); else resolve(JSON.parse(output)); });
    });
  }
  const task = await cli('submit', devices[0].token); assert.equal(task.status, 'queued');
  assert.equal((await cli('work', devices[1].token)).worked, true);
  await h.restart(); const page = await cli('list', devices[0].token);
  assert.equal(page.tasks[0].status, 'succeeded'); assert.equal(page.tasks[0].submission.images.length, 5);
});
