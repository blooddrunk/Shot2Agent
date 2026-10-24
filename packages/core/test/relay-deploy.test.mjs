import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
test('R10 private registry provisioning/rotation/revoke is repeatable, bounded and never prints Tokens', t => {
  const root = mkdtempSync(join(tmpdir(), 'shot-devices-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const command = (...args) => spawnSync(process.execPath, ['scripts/relay-devices.mjs', root, ...args], { encoding: 'utf8', windowsHide: true });
  const first = command('init', 'pc-a', 'pc-b'); assert.equal(first.status, 0);
  const before = JSON.parse(readFileSync(join(root, 'devices.json'))); assert.equal(before.length, 2); assert.notEqual(before[0].token, before[1].token);
  for (const d of before) { assert.match(d.token, /^[0-9a-f]{64}$/); assert.equal(first.stdout.includes(d.token), false); }
  assert.notEqual(command('init', 'pc-a').status, 0);
  assert.equal(command('rotate', 'pc-a').status, 0); const after = JSON.parse(readFileSync(join(root, 'devices.json')));
  assert.notEqual(before[0].token, after[0].token); assert.equal(before[1].token, after[1].token);
  assert.notEqual(command('rotate', 'pc-a', 'missing').status, 0); assert.deepEqual(JSON.parse(readFileSync(join(root, 'devices.json'))), after);
  assert.equal(command('revoke', 'pc-a').status, 0); assert.equal(JSON.parse(readFileSync(join(root, 'devices.json'))).length, 1);
  assert.notEqual(command('revoke', 'pc-b').status, 0); assert.notEqual(command('add', '../bad').status, 0);
  assert.equal(command('add-worker', 'linux').status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'devices.json'))).find(d => d.deviceId === 'linux').role, 'worker');
  assert.equal(command('rotate', 'linux').status, 0);
  assert.equal(JSON.parse(readFileSync(join(root, 'devices.json'))).find(d => d.deviceId === 'linux').role, 'worker');
  if (process.platform !== 'win32') assert.equal(statSync(join(root, 'devices.json')).mode & 0o777, 0o600);
});
