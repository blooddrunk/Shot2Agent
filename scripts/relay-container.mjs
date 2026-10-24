// Linux CI only: disposable Compose project, no public API listener, no model request.
import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const image = process.argv[2] ?? 'shot2agent-relay:m10-test';
const root = mkdtempSync(join(tmpdir(), 'shot-compose-')); const secrets = join(root, 'secrets'); mkdirSync(secrets);
const project = `shot-${randomUUID().slice(0, 8)}`; const volume = `${project}-data`; const restored = `${project}-restored`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const file = join(root, 'override.yaml');
const compose = (...args) => docker('compose', '-p', project, '-f', resolve('deploy/relay/compose.yaml'), '-f', file, ...args);
const registry = [ { ownerId: 'isolated', deviceId: 'a', role: 'desktop', token: 'a'.repeat(40) }, { ownerId: 'isolated', deviceId: 'b', role: 'desktop', token: 'b'.repeat(40) } ];
process.env.RELAY_DOMAIN = 'relay.invalid';
function override(name) { writeFileSync(file, `services:\n  relay:\n    image: ${image}\n    volumes:\n      - ${secrets}:/run/shot2agent:ro\n      - ${resolve('scripts/relay-container-probe.mjs')}:/app/probe.mjs:ro\nvolumes:\n  relay-data:\n    name: ${name}\n`); }
function registryWrite() {
  writeFileSync(join(secrets, 'devices.next'), JSON.stringify(registry), { mode: 0o600 });
  renameSync(join(secrets, 'devices.next'), join(secrets, 'devices.json'));
  docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${secrets}:/secrets`, image, 'chown', '1000:1000', '/secrets/devices.json');
}
async function healthy() {
  const id = compose('ps', '-q', 'relay');
  for (let i = 0; i < 80; i++) {
    try { docker('exec', id, 'node', '-e', "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"); return id; } catch { await delay(250); }
  }
  throw Error('CONTAINER_HEALTH_TIMEOUT');
}
try {
  override(volume); registryWrite(); const config = JSON.parse(compose('config', '--format', 'json'));
  assert.equal(config.services.relay.ports, undefined); assert.equal(config.networks.backend.internal, true);
  compose('up', '-d', '--no-build', 'relay'); let id = await healthy();
  console.log(docker('exec', id, 'node', '/app/probe.mjs', 'submit'));
  compose('restart', 'relay'); id = await healthy(); console.log(docker('exec', id, 'node', '/app/probe.mjs', 'work'));
  registry[0].token = 'z'.repeat(40); registryWrite(); console.log(docker('exec', id, 'node', '/app/probe.mjs', 'verify-rotation'));
  compose('stop', 'relay');
  docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${volume}:/source:ro`, '-v', `${root}:/backup`, image, 'tar', '-C', '/source', '-cf', '/backup/relay.tar', '.');
  docker('volume', 'create', restored);
  docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${restored}:/restore`, '-v', `${root}:/backup:ro`, image, 'tar', '-C', '/restore', '-xf', '/backup/relay.tar');
  override(restored); compose('up', '-d', '--no-build', '--force-recreate', 'relay'); id = await healthy(); console.log(docker('exec', id, 'node', '/app/probe.mjs', 'verify'));
  console.log('PASS R10 Compose: fresh volume, upload dedupe, restart, Worker, private files, hot token rotation, consistent stopped-volume backup/restore; no API published port');
} finally {
  try { compose('down', '--volumes', '--remove-orphans'); } catch { /* retain original test failure */ }
  for (const name of [volume, restored]) try { docker('volume', 'rm', name); } catch { /* already removed */ }
  // root is exactly the disposable mkdtemp path created above.
  rmSync(root, { recursive: true, force: true });
}
