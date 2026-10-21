import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { DesktopController } from '../src/controller.ts';
import { defaults, saveSettings } from '../src/settings.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';

const root = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot2agent-m7-')));
const image = () => sharp({ create: { width: 28, height: 22, channels: 3, background: '#9182aa' } }).png().toBuffer();
const clip = () => ({ session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} });

function makeCli(base, provider) {
  const pkgName = provider === 'codex' ? '@openai/codex' : '@anthropic-ai/claude-code';
  const entryRelative = provider === 'codex' ? 'bin/codex.js' : 'cli.js';
  const shimName = provider === 'codex' ? 'codex.cmd' : 'claude.cmd';
  const shim = join(base, 'npm', shimName);
  const packageRoot = join(base, 'npm', 'node_modules', ...pkgName.split('/'));
  const entry = join(packageRoot, entryRelative);
  mkdirSync(join(packageRoot, entryRelative, '..'), { recursive: true });
  writeFileSync(shim, 'synthetic npm shim; never executed\n');
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: pkgName, bin: { [provider]: entryRelative } }));
  const flags = provider === 'codex'
    ? ['--image', '--output-last-message', '--sandbox', '--ignore-user-config', '--ignore-rules', '--ephemeral']
    : ['--input-format', '--output-format', '--tools', '--disallowedTools', '--restricted', '--safe-mode', '--no-session-persistence', '--strict-mcp-config', '--mcp-config', '--settings', '--setting-sources'];
  const version = provider === 'codex' ? 'codex-cli m7-test' : '2.1.305 (Claude Code)';
  const code = `const a=process.argv.slice(2); if(a[0]==='--version') console.log(${JSON.stringify(version)}); else if((a[0]==='exec'&&a.includes('--help'))||a[0]==='--help') console.log(${JSON.stringify(flags.join(' '))}); else process.exit(0);\n`;
  writeFileSync(entry, code);
  return shim;
}

function credentialStore(seed = {}) {
  const values = new Map(Object.entries(seed)); const deleted = [];
  return { values, deleted,
    async save(reference, token) { values.set(reference, token); },
    async read(reference) { if (!values.has(reference)) throw new Error('GATEWAY_CREDENTIAL_UNAVAILABLE'); return values.get(reference); },
    async delete(reference) { deleted.push(reference); values.delete(reference); },
  };
}

function testGateway(requests) {
  return async (gateway, token) => {
    requests.push({ endpoint: gateway.baseUrl, model: gateway.model, token });
    if (token !== 'valid-token-123') throw new Error('GATEWAY_AUTH_FAILED');
    return { status: 'synthetic_image_passed', requestsSent: 1, model: gateway.model };
  };
}

function makeDesktop(dir, options = {}) {
  return new DesktopController(dir, clip(), options.injected, 'codex', async () => [], {
    credentials: options.credentials ?? credentialStore(), testGateway: options.testGateway ?? (async () => ({ status: 'synthetic_image_passed', requestsSent: 1, model: 'glm-5.3-flash' })),
  });
}

test('fresh Local first run opens without Profiles; GUI-created Codex Profile enables capture and survives restart', async () => {
  const dir = root(); let desktop = makeDesktop(dir);
  try {
    await desktop.start();
    let snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(snapshot.setupRequired, true); assert.equal(snapshot.total, 0);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'configure', capture: { enabled: true } }), /AGENT_SETUP_REQUIRED/);
    const workspace = join(dir, 'workspace'); mkdirSync(workspace);
    const executable = makeCli(dir, 'codex');
    await desktop.dispatch({ v: 1, command: 'create-profile', provider: 'codex', id: 'local-codex', path: executable,
      workspace: realpathSync(workspace), prompt: 'Explain the screenshot in concise Markdown.' });
    snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(snapshot.setupRequired, false); assert.equal(snapshot.profile.id, 'local-codex');
    assert.equal(snapshot.agents.filter(agent => !agent.archived && !agent.historical).length, 1);
    await desktop.dispatch({ v: 1, command: 'configure', capture: { enabled: true, mode: 'confirm' }, delivery: { clipboard: 'manual' } });
    assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).settings.enabled, true);
    await desktop.close();

    desktop = makeDesktop(dir); await desktop.start();
    snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(snapshot.setupRequired, false); assert.equal(snapshot.profile.id, 'local-codex');
    assert.equal(snapshot.settings.enabled, true);
  } finally { await desktop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('Gateway GUI setup keeps wrong Token out of disk, supports correction, and cleans the replaced credential', async () => {
  const dir = root(); const workspace = join(dir, 'workspace'); mkdirSync(workspace); const executable = makeCli(dir, 'claude');
  const credentials = credentialStore(); const requests = []; let desktop = makeDesktop(dir, { credentials, testGateway: testGateway(requests) });
  try {
    await desktop.start();
    const fields = { provider: 'claude-compatible-endpoint', id: 'glm-personal', path: executable, workspace: realpathSync(workspace),
      prompt: 'Explain the screenshot.', endpoint: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash', enableAfterTest: true };
    await assert.rejects(desktop.dispatch({ v: 1, command: 'create-profile', ...fields, token: 'wrong-token-123' }), /GATEWAY_AUTH_FAILED/);
    assert.equal(credentials.values.size, 0); assert.equal(desktop.settings.agents, undefined);
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8').includes('wrong-token-123'), false);

    await desktop.dispatch({ v: 1, command: 'create-profile', ...fields, token: 'valid-token-123' });
    let snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
    const first = snapshot.agents[0]; const firstRef = desktop.settings.agents.profiles[0].policy.gateway.credentialRef;
    assert.equal(snapshot.setupRequired, false); assert.equal(first.gateway.credentialStatus, 'available');
    assert.equal(first.gateway.connectionStatus, 'synthetic_test_passed'); assert.equal(first.gateway.vision, 'synthetic-test-passed');
    assert.equal(credentials.values.get(firstRef), 'valid-token-123');
    assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8').includes('valid-token-123'), false);
    assert.equal(requests.at(-1).token, 'valid-token-123');

    await desktop.dispatch({ v: 1, command: 'create-profile', ...fields, token: 'valid-token-123',
      editId: first.id, editVersion: first.version, reuseExisting: true });
    snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
    const second = snapshot.agents.find(agent => agent.version !== first.version);
    const secondRef = desktop.settings.agents.profiles.find(profile => profile.policy.version === second.version).policy.gateway.credentialRef;
    assert.notEqual(secondRef, firstRef);
    assert.equal(second.id, first.id);
    await desktop.dispatch({ v: 1, command: 'cleanup-unused-agents' });
    assert.equal(credentials.values.has(firstRef), false);
    assert.deepEqual(credentials.deleted, [firstRef]);
    assert.equal(credentials.values.get(secondRef), 'valid-token-123');
    assert.equal(requests.length, 3); // Fake transport only; no model request was made by this test.
  } finally { await desktop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('historical Profiles stay hidden, task references prevent deletion, and shared credentials survive cleanup', async () => {
  const dir = root(); const workspace = join(dir, 'workspace'); mkdirSync(workspace); const executable = makeCli(dir, 'claude');
  const program = { executable: process.execPath, args: [join(dir, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')] };
  const reference = `Shot2Agent-Gateway-${randomUUID()}`;
  const gateway = { kind: 'claude-compatible-endpoint', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-5.3-flash',
    models: { sonnet: 'glm-5.3-flash', opus: 'glm-5.3-flash', haiku: 'glm-5.3-flash' }, credentialRef: reference, vision: 'synthetic-test-passed' };
  const policy = (version) => ({ id: 'glm-profile', version, workspace: realpathSync(workspace), program, cliVersion: '2.1.305 (Claude Code)',
    timeoutMs: 180000, prompt: 'Explain image.', digest: 'a'.repeat(64), imageProtocol: 'windows-jsonl-v1', gateway: { ...gateway, models: { ...gateway.models } } });
  const v1 = policy('v1'); const v2 = policy('v2'); const v3 = policy('v3');
  const settings = defaults(); settings.adapter = 'codex'; settings.agents = { version: 1, selected: { id: v2.id, version: v2.version },
    profiles: [{ provider: 'claude-compatible-endpoint', policy: v1 }, { provider: 'claude-compatible-endpoint', policy: v2 }, { provider: 'claude-compatible-endpoint', policy: v3 }], archived: [{ id: v3.id, version: v3.version }] };
  saveSettings(dir, settings);
  const credentials = credentialStore({ [reference]: 'valid-token-123' }); let desktop = makeDesktop(dir, { credentials });
  try {
    await desktop.start();
    const initial = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(initial.agents.find(agent => agent.version === 'v1').historical, true);
    assert.equal(initial.agents.find(agent => agent.version === 'v3').archived, true);
    desktop.app.select('glm-profile', 'v1');
    const id = await desktop.app.submit(await image(), { session: 'synthetic', sequence: '44' }, true);
    desktop.app.select('glm-profile', 'v2');
    await desktop.dispatch({ v: 1, command: 'cleanup-unused-agents' });
    assert.equal(desktop.settings.agents.profiles.some(profile => profile.policy.version === 'v3'), false);
    assert.equal(credentials.values.has(reference), true); assert.deepEqual(credentials.deleted, []);

    await assert.rejects(desktop.dispatch({ v: 1, command: 'select-agent', id: 'glm-profile', version: 'v1' }), /UNAPPROVED_PROFILE/);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'delete-agent', id: 'glm-profile', version: 'v1', confirm: true }), /PROFILE_REFERENCED_BY_TASK/);
    const after = await desktop.dispatch({ v: 1, command: 'snapshot' });
    assert.equal(after.tasks.find(task => task.id === id).status, 'queued');
    assert.equal(after.agents.find(agent => agent.version === 'v1').referenced, true);
    assert.equal(credentials.values.has(reference), true);
    assert.equal(executable.endsWith('claude.cmd'), true);
  } finally { await desktop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('clear-all-safe removes terminal failures while preserving queued and execution-unknown tasks', async () => {
  const dir = root(); const desktop = new DesktopController(dir, clip(), { adapter: new FakeAgent(), profile: FAKE_PROFILE }, 'legacy', async () => []);
  const fail = { ...FAKE_PROFILE, id: 'fake-fail', version: 'v1' }; const crash = { ...FAKE_PROFILE, id: 'fake-crash', version: 'v1' };
  desktop.app.setRegistry([{ adapter: new FakeAgent('fail'), profile: fail }, { adapter: new FakeAgent('crash'), profile: crash }], fail.id, fail.version);
  try {
    await desktop.start();
    const failed = await desktop.app.submit(await image(), undefined, true); await desktop.app.work();
    desktop.app.select(crash.id, crash.version);
    const unknown = await desktop.app.submit(await image(), undefined, true); await desktop.app.work();
    desktop.app.select(fail.id, fail.version);
    const queued = await desktop.app.submit(await image(), undefined, true);
    assert.deepEqual(desktop.app.list().map(task => task.status), ['failed', 'execution_unknown', 'queued']);

    const result = await desktop.dispatch({ v: 1, command: 'clear-history', mode: 'all-safe' });
    assert.equal(result.lastHistoryCleanup.deleted, 1);
    assert.equal(result.lastHistoryCleanup.preservedActive, 1);
    assert.equal(result.lastHistoryCleanup.preservedUnknown, 1);
    assert.deepEqual(desktop.app.list().map(task => task.submission.taskId), [unknown, queued]);
    assert.equal(desktop.app.list().some(task => task.submission.taskId === failed), false);
  } finally { await desktop.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('history controls delete one task, clear success history, persist after restart, and empty latest hotkeys refuse cleanly', async () => {
  const dir = root(); let desktop = new DesktopController(dir, clip(), { adapter: new FakeAgent(), profile: FAKE_PROFILE }, 'legacy', async () => []);
  try {
    await desktop.start();
    await assert.rejects(desktop.dispatch({ v: 1, command: 'action', action: 'copy-latest' }), /NO_COMPLETED_RESULT/);
    const first = await desktop.app.submit(await image(), { session: 'synthetic', sequence: '1' }, true); await desktop.app.work();
    const second = await desktop.app.submit(await image(), { session: 'synthetic', sequence: '2' }, true); await desktop.app.work();
    const third = await desktop.app.submit(await image(), { session: 'synthetic', sequence: '3' }, true); await desktop.app.work();
    await desktop.dispatch({ v: 1, command: 'delete-history', ids: [first] });
    assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).total, 2);
    const cleared = await desktop.dispatch({ v: 1, command: 'clear-history', mode: 'completed' });
    assert.equal(cleared.lastHistoryCleanup.deleted, 2); assert.equal(cleared.total, 0);
    assert.deepEqual(desktop.app.list(), []);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'action', action: 'copy-latest' }), /NO_COMPLETED_RESULT/);
    await desktop.close();

    desktop = new DesktopController(dir, clip(), { adapter: new FakeAgent(), profile: FAKE_PROFILE }, 'legacy', async () => []);
    await desktop.start();
    assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).total, 0);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'action', action: 'retry-latest-delivery' }), /NO_ELIGIBLE_FAILED_DELIVERY/);
    await assert.rejects(desktop.dispatch({ v: 1, command: 'action', action: 'copy-latest' }), /NO_COMPLETED_RESULT/);
    assert.notEqual(second, third);
  } finally { await desktop.close(); rmSync(dir, { recursive: true, force: true }); }
});
