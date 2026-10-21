import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
for (const status of [200, 302, 401]) test(`one-request GLM diagnostic: status ${status}, durable no-repeat and no credential leakage`, { skip: process.platform !== 'win32' }, () => {
 const root = mkdtempSync(join(tmpdir(), 'shot-glm-once-'));
 try {
  mkdirSync(join(root, 'runtime/dist/packages/worker/src'), { recursive: true });
  mkdirSync(join(root, 'Shot2Agent-Codex'));
  writeFileSync(join(root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(root, 'probe.mjs'), readFileSync(new URL('../../../scripts/glm-vision-once.mjs', import.meta.url)));
  writeFileSync(join(root, 'Synthetic GLM screenshot.png'), readFileSync(new URL('../../../scripts/fixtures/glm-vision.png', import.meta.url)));
  writeFileSync(join(root, 'runtime/dist/packages/worker/src/gateway.js'), 'export async function readGatewayToken() { if (process.env.SHOT_FIXTURE_MISSING) throw Error("GATEWAY_CREDENTIAL_UNAVAILABLE"); return "SYNTHETIC_TOKEN_MUST_NOT_LEAK"; }');
  writeFileSync(join(root, 'Shot2Agent-Codex/settings.json'), JSON.stringify({ agents: { selected: { id: 'test', version: 'v1' }, profiles: [{ provider: 'claude-compatible-endpoint', policy: { id: 'test', version: 'v1', gateway: { model: 'glm-5.3-flash', baseUrl: 'https://open.bigmodel.cn/api/anthropic', credentialRef: 'synthetic-only' } } }] } }));
  writeFileSync(join(root, 'mock.mjs'), `import https from 'node:https'; import { EventEmitter } from 'node:events'; import { appendFileSync } from 'node:fs';
https.request=(url,options,respond)=>{ const req=new EventEmitter(); req.destroy=()=>req.emit('error'); req.end=body=>{const b=JSON.parse(body);appendFileSync(new URL('calls.txt',import.meta.url),JSON.stringify({url,model:b.model,image:b.messages[0].content[1].type})+'\\n');queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=${status};respond(res);res.emit('data',JSON.stringify({model:'glm-5.3-flash',content:[{type:'text',text:'SHOT2AGENT 42'}],usage:{input_tokens:1,output_tokens:2}}));res.emit('end');req.emit('close');});}; return req; };`);
  const run = (authorized, missing = false) => spawnSync(process.execPath, ['--import', pathToFileURL(join(root, 'mock.mjs')).href, join(root, 'probe.mjs'), ...(authorized ? ['--authorized-once'] : [])], { env: { ...process.env, LOCALAPPDATA: root, SHOT_FIXTURE_MISSING: missing ? '1' : '' }, encoding: 'utf8', timeout: 10000 });
  const denied = run(false); assert.notEqual(denied.status, 0); assert.equal(existsSync(join(root, 'calls.txt')), false);
  const unavailable = run(true, true); assert.equal(unavailable.status, 1); assert.equal(existsSync(join(root, 'calls.txt')), false);
  assert.equal(JSON.parse(readFileSync(join(root, 'GLM-ONCE-RECEIPT.json'), 'utf8')).requestsSent, 0);
  const first = run(true); assert.equal(first.status, status === 200 ? 0 : 1, first.stderr);
  const receipt = JSON.parse(readFileSync(join(root, 'GLM-ONCE-RECEIPT.json'), 'utf8'));
  assert.equal(receipt.requestsSent, 1); assert.equal(receipt.retries, 0); assert.equal(receipt.redirectsFollowed, 0);
  assert.equal(receipt.markerRecognized, status === 200 ? true : undefined);
  assert.equal(receipt.errorCode, status === 302 ? 'REDIRECT_REFUSED' : status === 401 ? 'ENDPOINT_REQUEST_FAILED' : undefined);
  assert.equal((first.stdout + first.stderr + JSON.stringify(receipt)).includes('SYNTHETIC_TOKEN_MUST_NOT_LEAK'), false);
  const again = run(true); assert.notEqual(again.status, 0); assert.equal(readFileSync(join(root, 'calls.txt'), 'utf8').trim().split('\n').length, 1);
  const call = JSON.parse(readFileSync(join(root, 'calls.txt'), 'utf8')); assert.equal(call.model, 'glm-5.3-flash'); assert.equal(call.image, 'image');
 } finally { rmSync(root, { recursive: true, force: true }); }
});
