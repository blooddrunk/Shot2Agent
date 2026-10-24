// Isolated Linux Docker/Compose acceptance, no real account or paid model.
import assert from 'node:assert/strict';
import console from 'node:console';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const image = process.argv[2] ?? 'shot2agent-worker:m12-test'; const relayImage = process.argv[3] ?? 'shot2agent-relay:m10-test';
const root = mkdtempSync(join(tmpdir(), 'shot-linux-compose-')); const project = `shot-linux-${randomUUID().slice(0, 8)}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 }).trim();
const file = join(root, 'override.yaml'); const base = ['compose', '-p', project, '-f', resolve('deploy/relay/compose.yaml'), '-f', resolve('deploy/relay/compose.worker.yaml'), '-f', file];
const compose = (...args) => docker(...base, ...args);
const secrets = join(root, 'relay-secrets'); const workerSecrets = join(root, 'worker-secrets'); const workspace = join(root, 'workspace');
for (const dir of [secrets, workerSecrets, workspace]) mkdirSync(dir);
const devices = [{ ownerId: 'isolated', deviceId: 'a', token: 'a'.repeat(40), role: 'desktop' }, { ownerId: 'isolated', deviceId: 'linux', token: 'w'.repeat(40), role: 'worker' }];
writeFileSync(join(secrets, 'devices.json'), JSON.stringify(devices), { mode: 0o600 });
writeFileSync(join(workerSecrets, 'worker.token'), devices[1].token, { mode: 0o600 }); writeFileSync(join(workerSecrets, 'agent-secret'), 'synthetic-token-only', { mode: 0o600 });
docker('run', '--rm', '--user', '0', '--network', 'none', '-v', `${root}:/provision`, image, 'node', '-e', "const fs=require('fs');for(const d of ['relay-secrets','worker-secrets']){const p='/provision/'+d;fs.chownSync(p,1000,1000);fs.chmodSync(p,448);for(const f of fs.readdirSync(p))fs.chownSync(p+'/'+f,1000,1000)}");
process.env.RELAY_DOMAIN = 'isolated.invalid'; process.env.WORKER_IMAGE = image; process.env.WORKER_OWNER = 'isolated'; process.env.WORKER_DEVICE = 'linux';
function override(fake) {
  writeFileSync(file, `services:\n  relay:\n    image: ${relayImage}\n    volumes:\n      - ${secrets}:/run/shot2agent:ro\n      - ${resolve('scripts/linux-worker-container-probe.mjs')}:/app/probe.mjs:ro\n  worker:\n    image: ${image}\n    environment:\n      SHOT2AGENT_WORKER_FAKE: '${fake ? 1 : 0}'\n    volumes:\n      - ${workerSecrets}:/run/worker-secrets:ro\n      - ${workspace}:/workspace:ro\n      - ${resolve('scripts/linux-worker-container-probe.mjs')}:/app/probe.mjs:ro\n      - ${resolve('scripts/fixtures/linux-mock-cli.mjs')}:/app/linux-mock-cli.mjs:ro\n`);
}
async function healthy() { for (let i = 0; i < 120; i++) { const id = compose('ps', '-q', 'relay'); try { if (docker('inspect', '--format', '{{.State.Health.Status}}', id) === 'healthy') return id; } catch { /* startup */ } await delay(250); } throw Error('RELAY_HEALTH_TIMEOUT'); }
try {
  override(true); const config = JSON.parse(compose('config', '--format', 'json')); assert.equal(config.services.worker.ports, undefined); assert.equal(config.services.worker.user, '1000:1000'); assert.equal(config.services.worker.read_only, true); assert.equal(config.services.worker.pids_limit, 128); assert.equal(config.networks.backend.internal, true);
  compose('up', '-d', '--no-build', 'relay', 'worker'); const relay = await healthy();
  const probe = action => { const output = docker('exec', relay, 'node', '/app/probe.mjs', action); console.log(output); return output; };
  probe('submit'); compose('restart', 'worker'); probe('verify');
  compose('stop', 'worker');
  // A different dedicated volume prevents Fake state/identity from being promoted into real approval.
  compose('rm', '-f', 'worker'); const workerVolume = `${project}_worker-data`; docker('volume', 'rm', workerVolume);
  override(false); console.log(compose('run', '--rm', '--no-deps', 'worker', 'node', '/app/probe.mjs', 'setup-mock'));
  compose('up', '-d', '--no-build', 'worker'); probe('submit'); probe('verify');
  let worker = compose('ps', '-q', 'worker'); docker('exec', worker, 'node', '/app/probe.mjs', 'hang'); probe('submit-crash');
  docker('exec', worker, 'node', '/app/probe.mjs', 'await-execution');
  docker('kill', '--signal=KILL', worker); compose('up', '-d', '--no-build', 'worker'); probe('verify-crash');
  worker = compose('ps', '-q', 'worker'); console.log(docker('exec', worker, 'node', '/app/probe.mjs', 'verify-single-execution'));
  const inspection = JSON.parse(docker('inspect', worker))[0]; assert.equal(inspection.HostConfig.Privileged, false); assert.equal(inspection.HostConfig.ReadonlyRootfs, true); assert.equal(inspection.HostConfig.Memory, 1024 ** 3); assert.equal(inspection.HostConfig.PidsLimit, 128); assert.deepEqual(inspection.HostConfig.PortBindings, {});
  // No model credentials can be present in image metadata or environment.
  assert.equal(JSON.stringify(inspection.Config.Env).includes('synthetic-token-only'), false);
  console.log('PASS M12 Compose: separate non-root outbound Worker, Fake restart, mock GLM images, crash/no replay, durable state, secret/resource/network isolation');
} catch (error) {
  console.error(compose('logs', '--tail', '30', 'worker', 'relay')); throw error;
} finally {
  try { compose('down', '--volumes', '--remove-orphans'); } catch { /* preserve original failure */ }
  // root is exactly the temporary directory created above; no production path is enumerated.
  rmSync(root, { recursive: true, force: true });
}
