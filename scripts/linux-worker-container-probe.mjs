import assert from 'node:assert/strict';
import console from 'node:console';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { RemoteClient } from './dist/services/relay/src/client.js';
import { FAKE_PROFILE } from './dist/packages/worker/src/fake.js';
import { sha256 } from './dist/packages/core/src/blobs.js';
import { approveLinux, loadLinuxProfiles, linuxCapabilities, linuxEntries } from './dist/packages/worker/src/linux-worker.js';
import sharp from 'sharp';
const action = process.argv[2];
const devices = JSON.parse(readFileSync('/run/shot2agent/devices.json'));
const a = new RemoteClient('http://127.0.0.1:3100/', devices[0].token);
const config = { url: 'http://relay:3100/', trustedInternalOrigin: 'http://relay:3100/', ownerId: 'isolated', deviceId: 'linux', label: 'Linux VPS', stateRoot: '/data', scratchRoot: '/scratch', workspace: '/workspace', tokenFile: '/run/worker-secrets/worker.token', fake: false };
async function waitFor(fn) { for (let i = 0; i < 240; i++) { const value = await fn(); if (value) return value; await delay(250); } throw Error('CONTAINER_WORKER_TIMEOUT'); }
if (action === 'setup-mock') {
  mkdirSync('/data/mock-claude'); copyFileSync('/app/linux-mock-cli.mjs', '/data/mock-claude/cli.js'); chmodSync('/data/mock-claude/cli.js', 0o700);
  writeFileSync('/data/mock-claude/package.json', JSON.stringify({ name: '@anthropic-ai/claude-code', type: 'module', bin: { claude: 'cli.js' } }));
  await approveLinux(config, 'claude-compatible-endpoint', '/data/mock-claude/cli.js', 'linux-mock', '/run/worker-secrets/agent-secret', 'https://open.bigmodel.cn/api/anthropic', 'glm-5.3-flash');
  assert.equal(loadLinuxProfiles(config).length, 1); assert.equal(linuxCapabilities(linuxEntries(config))[0].provider, 'claude-compatible-endpoint');
} else if (action === 'hang' || action === 'success') {
  writeFileSync('/data/mock-claude/mode', action);
} else if (action === 'submit' || action === 'submit-crash') {
  const worker = await waitFor(async () => (await a.workers()).find(w => w.deviceId === 'linux' && w.accepting));
  const p = worker.profiles[0]; assert.ok(p);
  const bytes = await sharp({ create: { width: 80, height: 80, channels: 3, background: 'green' } }).png().toBuffer();
  const id = randomUUID();
  const metadata = { taskId: id, profileId: p.id, profileVersion: p.version, profileFingerprint: p.fingerprint, provider: p.provider, targetWorkerId: 'linux',
    images: Array.from({ length: 5 }, (_, i) => ({ fileName: `${i}.png`, contentType: 'image/png', byteSize: bytes.length, sha256: sha256(bytes) })) };
  await a.submit(id, metadata, Array(5).fill(bytes)); await a.submit(id, metadata, Array(5).fill(bytes));
  writeFileSync(`/data/${action}.json`, JSON.stringify({ id }));
  if (action === 'submit-crash') await waitFor(async () => (await a.get(id)).status === 'running');
} else if (action === 'verify' || action === 'verify-crash') {
  const { id } = JSON.parse(readFileSync(`/data/${action === 'verify' ? 'submit' : 'submit-crash'}.json`));
  const task = await waitFor(async () => { const task = await a.get(id); return ['succeeded', 'execution_unknown'].includes(task.status) && task; });
  assert.equal(task.status, action === 'verify' ? 'succeeded' : 'execution_unknown'); assert.equal(task.attempts.length, 1); assert.equal(task.result.workerId, 'linux');
  if (action === 'verify') { assert.match(task.result.contentMarkdown, /5 image/); for (const file of task.result.artifacts) assert.equal(sha256(await a.file(id, file.fileId)), file.sha256); }
  assert.equal((await fetch(`http://127.0.0.1:3100/v1/tasks/${id}`)).status, 401);
} else if (action === 'verify-single-execution') {
  const records = readFileSync('/data/mock-claude/executions.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records.length, 2); assert.equal(records.every(r => r.inheritedSecret === false), true);
} else if (action === 'await-execution') {
  await waitFor(() => { try { return readFileSync('/data/mock-claude/executions.jsonl', 'utf8').trim().split('\n').length === 2; } catch { return false; } });
} else if (action === 'fake-check') {
  assert.equal((await a.workers()).find(w => w.deviceId === 'linux').profiles[0].fingerprint, FAKE_PROFILE.fingerprint);
} else throw Error('INVALID_PROBE_ACTION');
console.log(`PASS Linux container ${action}`);
