import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { RemoteClient } from './dist/services/relay/src/client.js';
import { FakeAgent, FAKE_PROFILE } from './dist/packages/worker/src/fake.js';
import { runOnce } from './dist/packages/worker/src/worker.js';
import { sha256 } from './dist/packages/core/src/blobs.js';
const devices = JSON.parse(readFileSync('/run/shot2agent/devices.json', 'utf8'));
const a = new RemoteClient('http://127.0.0.1:3100', devices[0].token);
const b = new RemoteClient('http://127.0.0.1:3100', devices[1].token);
const action = process.argv[2];
const caps = [{ id: FAKE_PROFILE.id, version: FAKE_PROFILE.version, fingerprint: FAKE_PROFILE.fingerprint, provider: 'fake' }];
if (action === 'submit') {
  await b.presence('Container B', caps, true);
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'green' } }).png().toBuffer();
  const id = randomUUID();
  const meta = { taskId: id, profileId: FAKE_PROFILE.id, profileVersion: FAKE_PROFILE.version, profileFingerprint: FAKE_PROFILE.fingerprint, provider: 'fake', targetWorkerId: devices[1].deviceId,
    images: [{ fileName: 'synthetic.png', contentType: 'image/png', byteSize: bytes.length, sha256: sha256(bytes) }] };
  await a.submit(id, meta, [bytes]); await a.submit(id, meta, [bytes]); assert.equal((await a.list()).tasks.length, 1);
  writeFileSync('/data/probe-task.json', JSON.stringify({ id }), { mode: 0o600 });
} else {
  const { id } = JSON.parse(readFileSync('/data/probe-task.json', 'utf8'));
  if (action === 'work') { await b.presence('Container B', caps, true); assert.equal(await runOnce(b, new FakeAgent(), [FAKE_PROFILE]), true); }
  const task = await a.get(id); assert.equal(task.status, 'succeeded'); assert.equal(task.attempts.length, 1);
  const f = task.result.artifacts[0]; const data = await a.file(id, f.fileId); assert.equal(sha256(data), f.sha256);
  assert.equal((await fetch(`http://127.0.0.1:3100/v1/tasks/${id}`)).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:3100/v1/tasks/${id}/files/${f.fileId}`)).status, 401);
  if (action === 'verify-rotation') await assert.rejects(() => new RemoteClient('http://127.0.0.1:3100', 'a'.repeat(40)).session(), /RELAY_401/);
}
console.log(`PASS container ${action}: authenticated private durable Fake round trip`);
