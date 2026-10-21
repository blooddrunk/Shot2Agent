import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
for (const mode of ['check', 'busy', 'success', 'decline', 'failure']) test(`local GLM credential repair orchestration: ${mode}`, { skip: process.platform !== 'win32' }, () => {
 const root = mkdtempSync(join(tmpdir(), 'shot-glm-repair-'));
 try {
  const pkg = join(root, 'package'), data = join(root, 'Shot2Agent-Codex');
  mkdirSync(data); mkdirSync(join(pkg, 'runtime/dist/packages/worker/src'), { recursive: true });
  mkdirSync(join(pkg, 'runtime/dist/packages/local/src'), { recursive: true }); mkdirSync(join(pkg, 'runtime/dist/packages/desktop/src'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{"type":"module"}');
  writeFileSync(join(pkg, 'repair.mjs'), readFileSync(new URL('../../../scripts/repair-glm-credential.mjs', import.meta.url)));
  const write = (path, text) => writeFileSync(join(pkg, 'runtime/dist/packages', path), text);
  write('worker/src/gateway.js', `import { fileURLToPath } from 'node:url'; export function validateGateway() {} export async function readGatewayToken() { return 'SYNTHETIC_MUST_NOT_LEAK'; } export function credentialCommand(){return {executable:process.execPath,args:[fileURLToPath(new URL('./credential.mjs',import.meta.url))],env:process.env};}`);
  write('worker/src/credential.mjs', `import {writeFileSync} from 'node:fs';writeFileSync(process.env.SHOT_REPAIR_FIXTURE_FILE,'created');`);
  write('worker/src/claude.js', 'export function claudeProfile() {}');
  write('worker/src/discovery.js', `export function programDigest(){return '${'a'.repeat(64)}';}`);
  write('worker/src/registry.js', 'export function executionRegistry() {}');
  write('local/src/state.js', `export class LocalState { acquireWorker(){if(process.env.SHOT_REPAIR_FIXTURE_MODE==='busy')throw Error('LOCAL_WORKER_ALREADY_RUNNING');} close(){} }`);
  write('desktop/src/settings.js', `import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';export function loadSettings(root){return JSON.parse(readFileSync(join(root,'settings.json'),'utf8'));}export function saveSettings(root,s){writeFileSync(join(root,'settings.json'),JSON.stringify(s));}`);
  writeFileSync(join(pkg, 'Verify GLM vision once.mjs'), `import {writeFileSync} from 'node:fs'; const pass=process.env.SHOT_REPAIR_FIXTURE_MODE!=='failure';writeFileSync(new URL('GLM-ONCE-RECEIPT.json',import.meta.url),JSON.stringify({status:pass?'PASS_DIRECT_ENDPOINT_IMAGE_RECOGNITION':'FAIL',requestsSent:1,model:'glm-5.3-flash',markerRecognized:pass}));process.exitCode=pass?0:1;`);
  const policy = { id: 'claude-gateway-readonly', version: 'original', workspace: root, program: { executable: process.execPath, args: [] }, digest: 'a'.repeat(64), gateway: { baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash', models: { opus: 'glm-5.3-flash', sonnet: 'glm-5.3-flash', haiku: 'glm-5.3-flash' }, credentialRef: 'original-ref', vision: 'not-verified' } };
  const original = { agents: { selected: { id: policy.id, version: policy.version }, profiles: [{ provider: 'claude-compatible-endpoint', policy }] } };
  const settings = join(data, 'settings.json');writeFileSync(settings, JSON.stringify(original));
  const result = spawnSync(process.execPath, [join(pkg, 'repair.mjs'), mode === 'check' ? '--check-only' : '--repair-and-test'], { env: { ...process.env, LOCALAPPDATA: root, SHOT_REPAIR_FIXTURE_MODE: mode, SHOT_REPAIR_FIXTURE_FILE: join(root, 'credential-created') }, input: mode === 'success' ? 'YES\n' : '\n', encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, ['busy', 'failure'].includes(mode) ? 1 : 0, result.stdout + result.stderr);
  const next = JSON.parse(readFileSync(settings, 'utf8'));
  assert.deepEqual(next.agents.profiles[0], original.agents.profiles[0]);
  assert.equal((result.stdout + result.stderr + JSON.stringify(next)).includes('SYNTHETIC_MUST_NOT_LEAK'), false);
  if (['check','busy'].includes(mode)) assert.deepEqual(next, original);
  else {
   assert.equal(next.agents.profiles.length, mode === 'success' ? 3 : 2);
   const selected = next.agents.profiles.find(p => p.policy.version === next.agents.selected.version);
   assert.equal(selected.policy.gateway.vision, mode === 'success' ? 'operator-attested' : 'not-verified');
   assert.match(selected.policy.gateway.credentialRef, /^Shot2Agent-Gateway-/);
   assert.equal(selected.policy.gateway.model, 'glm-5.3-flash');
   assert.equal(next.agents.archived.length, mode === 'success' ? 2 : 1);
  }
 } finally { rmSync(root, { recursive: true, force: true }); }
});
