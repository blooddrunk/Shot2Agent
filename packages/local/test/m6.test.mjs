import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { LocalApp } from '../src/app.ts';
import { mkdtempSync, realpathSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { ClaudeAgent, claudeProfile, assertClaudeMachinePolicy, assertClaudePolicyResult } from '../../worker/src/claude.ts';
import { validateGateway, assertGatewayVision, credentialCommand } from '../../worker/src/gateway.ts';
import { programDigest } from '../../worker/src/discovery.ts';
import { executionRegistry } from '../../worker/src/registry.ts';
import { sha256 } from '../../core/src/blobs.ts';
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot-m6-gateway-')));
const gateway = () => ({ kind: 'claude-compatible-endpoint', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash', models: { opus: 'glm-5.3-flash', sonnet: 'glm-5.3-flash', haiku: 'glm-5.3-flash' }, credentialRef: `Shot2Agent-Gateway-${randomUUID()}`, vision: 'not-verified' });
const program = { executable: process.execPath, args: [fileURLToPath(new URL('./mock-gateway-cli.mjs', import.meta.url))] };
const policyFor = workspace => ({ id: 'claude-gateway-readonly', version: 'v1', workspace, program, cliVersion: '2.1.305 (Claude Code)', digest: programDigest(program), timeoutMs: 15000, prompt: 'Synthetic only', imageProtocol: 'windows-jsonl-v1', gateway: gateway() });
test('Claude policy check distinguishes actual managed policy from blocked or failed helper startup', () => {
  assert.doesNotThrow(() => assertClaudePolicyResult({ code: 0, output: 'absent\r\n', stopped: false }));
  assert.throws(() => assertClaudePolicyResult({ code: 1, output: 'present\r\n', stopped: false }), /CLAUDE_MANAGED_POLICY_REFUSED/);
  for (const [code, output] of [[1, ''], [1, 'absent'], [2, ''], [0, 'present'], [0, ''], [null, '']]) {
    assert.throws(() => assertClaudePolicyResult({ code, output, stopped: false }), /CLAUDE_POLICY_CHECK_UNAVAILABLE/);
  }
  assert.throws(() => assertClaudePolicyResult({ code: 0, output: 'absent', stopped: true }), /CLAUDE_POLICY_CHECK_TIMEOUT/);
});
test('gateway endpoints, mapping, credential reference and vision refuse unsafe configurations', () => {
  const base = gateway(); validateGateway(base);
  for (const baseUrl of ['http://open.bigmodel.cn/api/anthropic', 'https://token@open.bigmodel.cn/api/anthropic', 'https://open.bigmodel.cn/api/anthropic?token=private', 'https://evil.invalid', 'https://open.bigmodel.cn:443/api/anthropic', 'https://127.0.0.1/api/anthropic']) assert.throws(() => validateGateway({ ...base, baseUrl }));
  for (const override of [{ credentialRef: 'plaintext-token' }, { model: '../bad' }, { models: { sonnet: 'glm-5.3-flash' } }, { token: 'synthetic' }]) assert.throws(() => validateGateway({ ...base, ...override }));
  assert.throws(() => assertGatewayVision(base), /GATEWAY_VISION_NOT_VERIFIED/);
  assert.throws(() => assertGatewayVision({ ...base, model: 'glm-4.6', vision: 'operator-attested' }), /VISION_UNSUPPORTED/);
  if (process.platform !== 'win32') assert.throws(() => credentialCommand('read', base.credentialRef), /WINDOWS_SECURE_STORE_REQUIRED/);
});
test('GLM 5.3 Flash is image-capable but still requires separate vision qualification', () => {
  const base = { ...gateway(), model: 'glm-5.3-flash', models: { opus: 'glm-5.3-flash', sonnet: 'glm-5.3-flash', haiku: 'glm-5.3-flash' } };
  assert.throws(() => assertGatewayVision(base), /GATEWAY_VISION_NOT_VERIFIED/);
  assert.doesNotThrow(() => assertGatewayVision({ ...base, vision: 'operator-attested' }));
  assert.doesNotThrow(() => assertGatewayVision({ ...base, vision: 'synthetic-test-passed' }));
  for (const alias of ['opus', 'sonnet', 'haiku']) {
    assert.throws(() => assertGatewayVision({ ...base, vision: 'operator-attested', models: { ...base.models, [alias]: 'glm-5' } }), /GATEWAY_MODEL_VISION_UNSUPPORTED/);
  }
  assert.throws(() => assertGatewayVision({ ...base, vision: 'operator-attested', model: 'glm-5.3-flash-unknown' }), /GATEWAY_MODEL_VISION_UNSUPPORTED/);
});
test('gateway setup never invokes CLI/model until vision is qualified; provenance remains gateway', async () => {
  const root = temp(); const policy = policyFor(root); const registry = executionRegistry([{ provider: 'claude-compatible-endpoint', policy }]);
  assert.equal(registry[0].adapter.name, 'claude-compatible-endpoint');
  assert.throws(() => executionRegistry([{ provider: 'claude', policy }]), /AUTH_PROFILE_MISMATCH/);
  let secrets = 0;
  const agent = new ClaudeAgent([policy], { machinePolicy: async () => { throw Error('unexpected'); }, token: async () => { secrets++; return 'synthetic'; } });
  const result = await agent.execute({ profileId: policy.id, profileVersion: policy.version, images: [] }, claudeProfile(policy), [], new AbortController().signal);
  assert.equal(result.errorCode, 'GATEWAY_VISION_NOT_VERIFIED'); assert.equal(result.status, 'failed'); assert.equal(secrets, 0);
  const app = new LocalApp(root, agent, claudeProfile(policy), { clipboard: 'off' });
  try {
    const image = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#abc123' } }).png().toBuffer();
    const id = await app.submit(image); await app.work(); const stored = app.get(id);
    assert.equal(stored.submission.provider, 'claude-compatible-endpoint');
    assert.equal(stored.result.adapterName, 'claude-compatible-endpoint');
    assert.equal(stored.result.errorCode, 'GATEWAY_VISION_NOT_VERIFIED');
    assert.equal(stored.attempts.length, 1); assert.equal(await app.work(), false);
  } finally { app.close(); }
  assert.equal(existsSync(join(root, 'mock-gateway.json')), false); rmSync(root, { recursive: true, force: true });
});
for (const mode of ['success', 'auth', 'echo-secret', 'malformed', 'credential-missing', 'policy-refused']) test(`isolated Gateway CLI + local Mock API: ${mode}`, async () => {
  const root = temp(); const policy = policyFor(root); policy.gateway.vision = 'operator-attested';
  const secret = 'synthetic-fixture-only-credential'; let calls = 0; let request;
  const server = createServer(async (req, res) => {
    calls++; let body = ''; for await (const part of req) body += part;
    request = { url: req.url, authorization: req.headers.authorization, ...JSON.parse(body) };
    if (mode === 'auth') res.statusCode = 401;
    res.end(JSON.stringify(mode === 'auth' ? { type: 'result', subtype: 'error', is_error: true, result: 'HTTP 401 synthetic' } : mode === 'malformed' ? { type: 'result', subtype: 'error', is_error: true, result: 'synthetic' } :
      { type: 'result', subtype: 'success', is_error: false, result: mode === 'echo-secret' ? secret : mode === 'auth' ? 'HTTP 401 synthetic' : 'SHOT2AGENT 42 fixture response, not OCR' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  writeFileSync(join(root, 'mock-gateway.json'), JSON.stringify({ port: server.address().port, operatorHome: process.env.HOME }));
  const image = await sharp({ create: { width: 25, height: 12, channels: 3, background: '#abcdef' } }).png().toBuffer();
  const metadata = { taskId: randomUUID(), profileId: policy.id, profileVersion: policy.version,
    images: [{ fileName: 'synthetic.png', contentType: 'image/png', byteSize: image.length, sha256: sha256(image) }] };
  const dependencies = { machinePolicy: async () => { if (mode === 'policy-refused') throw Error('CLAUDE_MANAGED_POLICY_REFUSED'); }, token: async () => { if (mode === 'credential-missing') throw Error('GATEWAY_CREDENTIAL_UNAVAILABLE'); return secret; } };
  const agent = new ClaudeAgent([policy], dependencies); const profile = claudeProfile(policy);
  try {
    const result = await agent.execute(metadata, profile, [image], new AbortController().signal); assert.equal(await agent.settle(), true);
    assert.equal(JSON.stringify(result).includes(secret), false);
    if (mode === 'success') {
      assert.equal(result.status, 'succeeded', result.errorCode);
      assert.equal(calls, 1); assert.equal(request.url, '/api/anthropic/v1/messages');
      assert.equal(request.authorization, `Bearer ${secret}`); assert.equal(request.model, policy.gateway.model);
      assert.equal(request.evidence.endpoint, policy.gateway.baseUrl);
      assert.equal(request.evidence.homeIsolated, true); assert.equal(request.evidence.apiKeyAbsent, true); assert.equal(request.evidence.oauthAbsent, true); assert.equal(request.evidence.proxyAbsent, true);
      assert.deepEqual(request.evidence.models, ['glm-5.3-flash', 'glm-5.3-flash', 'glm-5.3-flash']);
      assert.ok(request.evidence.args.includes('--restricted')); assert.ok(request.evidence.args.includes('--safe-mode'));
      assert.equal(request.evidence.args[request.evidence.args.indexOf('--tools') + 1], '');
      assert.ok(request.evidence.args.includes('--strict-mcp-config')); assert.equal(request.evidence.args.includes('--bare'), false);
      const blocks = request.messages[0].content; assert.equal(blocks[0].type, 'text'); assert.equal(blocks[1].type, 'image');
      assert.equal(blocks[1].source.data, image.toString('base64'));
    } else { assert.notEqual(result.status, 'succeeded'); if (mode === 'auth') assert.equal(result.errorCode, 'GATEWAY_AUTH_FAILED'); if (['credential-missing', 'policy-refused'].includes(mode)) assert.equal(calls, 0); }
    assert.equal(readFileSync(join(root, 'mock-gateway.json'), 'utf8').includes(secret), false);
    assert.notEqual(profile.fingerprint, claudeProfile({ ...policy, gateway: { ...policy.gateway, model: 'glm-4.6v-flash' } }).fingerprint);
    assert.notEqual(profile.fingerprint, claudeProfile({ ...policy, gateway: { ...policy.gateway, credentialRef: gateway().credentialRef } }).fingerprint);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(root, { recursive: true, force: true }); }
});
test('production gateway retains Windows policy requirement', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(assertClaudeMachinePolicy(), /CLAUDE_WINDOWS_ONLY/);
});
