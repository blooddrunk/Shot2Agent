import { setInterval, clearInterval } from 'node:timers';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { LocalApp } from '../src/app.ts';
import { sha256 } from '../../core/src/blobs.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
import { ClaudeAgent, claudeProfile, CLAUDE_ARGS, parseClaudeOutput } from '../../worker/src/claude.ts';
import { discover, resolveProgram, inspectCandidate, programDigest } from '../../worker/src/discovery.ts';
import { DesktopController } from '../../desktop/src/controller.ts';
import { defaults, saveSettings, loadSettings } from '../../desktop/src/settings.ts';
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot-m5-')));
const image = await sharp({ create: { width: 20, height: 12, channels: 3, background: '#aaccee' } }).png().toBuffer();
const mock = fileURLToPath(new URL('./mock-claude.mjs', import.meta.url));
const program = { executable: process.execPath, args: [mock] };
const profileFor = name => ({ ...FAKE_PROFILE, id: `${name}-readonly`, fingerprint: sha256(name) });
const fake = name => ({ name, version: 'mock-v1', execute: (...args) => new FakeAgent().execute(...args) });
const registry = () => ['codex', 'claude'].map(name => ({ adapter: fake(name), profile: profileFor(name) }));
const cb = () => ({ session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} });
for (const first of ['codex', 'claude']) test(`immutable ${first} submission survives switch and restart`, async () => {
  const root = temp(), entries = registry(), firstEntry = entries.find(e => e.adapter.name === first), second = entries.find(e => e.adapter.name !== first);
  let app = new LocalApp(root, firstEntry.adapter, firstEntry.profile, { clipboard: 'off' }, undefined, entries);
  const pending = app.submit(image, undefined, true); app.select(second.profile.id, second.profile.version);
  const id = await pending; const secondId = await app.submit(image, undefined, true);
  assert.equal(app.get(id).submission.provider, first); app.close();
  app = new LocalApp(root, second.adapter, second.profile, { clipboard: 'off' }, undefined, entries);
  await app.work(); await app.work(); assert.equal(await app.work(), false);
  for (const [taskId, entry] of [[id, firstEntry], [secondId, second]]) {
    const t = app.get(taskId); assert.equal(t.status, 'succeeded'); assert.equal(t.attempts.length, 1);
    assert.equal(t.submission.profileFingerprint, entry.profile.fingerprint); assert.equal(t.attempts[0].adapterName, entry.adapter.name); assert.equal(t.result.adapterName, entry.adapter.name);
  }
  app.close();
});
test('unknown execution never invokes alternate provider, including after restart', async () => {
  const root = temp(), entries = registry(); let calls = 0;
  entries[0].adapter.execute = async () => { throw Error('PRIVATE_SECRET_DO_NOT_LOG'); };
  entries[1].adapter.execute = async () => { calls++; throw Error('unexpected alternate'); };
  let app = new LocalApp(root, entries[0].adapter, entries[0].profile, { clipboard: 'off' }, undefined, entries);
  const id = await app.submit(image); app.select(entries[1].profile.id, 'v1'); await app.work();
  assert.equal(app.get(id).status, 'execution_unknown'); assert.equal(calls, 0); app.close();
  app = new LocalApp(root, entries[1].adapter, entries[1].profile, { clipboard: 'off' }, undefined, entries);
  assert.equal(await app.work(), false); assert.equal(app.get(id).attempts.length, 1); assert.equal(calls, 0); app.close();
});
test('binding drift refuses before adapter call and becomes a visible terminal failure', async () => {
  const root = temp(), entries = registry(); let calls = 0;
  let app = new LocalApp(root, entries[0].adapter, entries[0].profile, { clipboard: 'off' }, undefined, entries);
  const id = await app.submit(image); app.close();
  entries[0].profile.fingerprint = sha256('changed'); entries[0].adapter.execute = async () => { calls++; throw Error(); };
  app = new LocalApp(root, entries[0].adapter, entries[0].profile, { clipboard: 'off' }, undefined, entries);
  await app.work(); assert.equal(app.get(id).result.errorCode, 'PROFILE_BINDING_CHANGED'); assert.equal(calls, 0); app.close();
});
test('approved discovery remains pinned; version/digest drift never repins', async () => {
  const cwd = temp(); const digest = programDigest(program);
  assert.equal((await inspectCandidate('claude', mock, cwd, { version: '2.1.306 (Claude Code)', digest }, program)).status, 'unverified_auth');
  assert.equal((await inspectCandidate('claude', mock, cwd, { version: 'old' }, program)).status, 'version_changed');
  assert.equal((await inspectCandidate('claude', mock, cwd, { version: '2.1.306 (Claude Code)', digest: '0'.repeat(64) }, program)).status, 'version_changed');
  const result = await discover('claude', cwd, { approved: { program, version: 'old' }, directories: [] });
  assert.equal(result.length, 1); assert.equal(result[0].status, 'version_changed');
});
test('manual invalid path takes precedence over installed candidates; no shell wrappers execute', async () => {
  const cwd = temp(); const wrapper = join(cwd, 'claude.cmd'); writeFileSync(wrapper, 'DO NOT EXECUTE');
  assert.throws(() => resolveProgram('claude', wrapper));
  assert.equal((await discover('claude', cwd, { manual: join(cwd, 'missing'), directories: [cwd] }))[0].status, 'invalid');
  assert.equal((await discover('claude', cwd, { directories: [] }))[0].status, 'not_found');
  assert.throws(() => resolveProgram('claude', 'relative.exe'), /LOCAL_ABSOLUTE/);
});
test('verified npm package maps only the declared contained official entry', () => {
  const cwd = temp(), root = join(cwd, 'node_modules', '@anthropic-ai', 'claude-code'); mkdirSync(root, { recursive: true });
  const shim = join(cwd, 'claude.cmd'); writeFileSync(shim, 'must never execute'); writeFileSync(join(root, 'cli.js'), '');
  const metadata = join(root, 'package.json'); writeFileSync(metadata, JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.js' } }));
  assert.deepEqual(resolveProgram('claude', shim), { executable: realpathSync(process.execPath), args: [realpathSync(join(root, 'cli.js'))] });
  writeFileSync(metadata, JSON.stringify({ name: 'wrong-package', bin: { claude: 'cli.js' } })); assert.throws(() => resolveProgram('claude', shim), /UNVERIFIED_NPM/);
  writeFileSync(metadata, JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: '../escape.js' } })); assert.throws(() => resolveProgram('claude', shim), /UNVERIFIED_NPM/);
});
test('symlink executable is refused', { skip: process.platform === 'win32' }, () => {
  const root = temp(), link = join(root, 'claude'); symlinkSync(process.execPath, link); assert.throws(() => resolveProgram('claude', link), /UNSAFE_CLI/);
});
test('Claude protocol qualification required before launch; malformed policy rejected', async () => {
  const workspace = temp(); const policy = { id: 'claude-readonly', version: 'v1', workspace, program, cliVersion: '2.1.306 (Claude Code)', digest: programDigest(program), timeoutMs: 5000, prompt: 'Synthetic only' };
  const profile = claudeProfile(policy), agent = new ClaudeAgent([policy]);
  const result = await agent.execute({ taskId: randomUUID(), profileId: profile.id, profileVersion: profile.version, images: [] }, profile, [], new AbortController().signal);
  assert.equal(result.errorCode, 'CLAUDE_IMAGE_PROTOCOL_NOT_VERIFIED'); assert.equal(existsSync(join(workspace, 'invocation.json')), false);
  assert.throws(() => claudeProfile({ ...policy, imageProtocol: 'text-only' }), /INVALID_IMAGE_PROTOCOL/);
  assert.equal(CLAUDE_ARGS.includes('--bare'), false); assert.equal(CLAUDE_ARGS.includes('--dangerously-skip-permissions'), false);
  assert.equal(CLAUDE_ARGS[CLAUDE_ARGS.indexOf('--tools') + 1], '');
});
for (const mode of ['success', 'error', 'invalid', 'missing', 'huge', 'double']) test(`Claude structured final parser: ${mode}`, async () => {
  const root = temp(); writeFileSync(join(root, 'mode'), mode);
  const { boundedProcess } = await import('../../worker/src/process.ts');
  const result = await boundedProcess(program, [], { cwd: root, timeoutMs: 3000, maxBytes: 200000, input: JSON.stringify({ message: { content: [] } }) + '\n' }); await result.settled;
  if (mode === 'success') assert.match(parseClaudeOutput(result.output), /SHOT2AGENT 42/);
  else assert.throws(() => parseClaudeOutput(result.output));
});
test('desktop selects only registered profiles; original Codex config is retained verbatim', async () => {
  const root = temp(), workspace = temp(); const settings = defaults(); settings.adapter = 'codex';
  settings.codex = { id: 'codex-readonly', version: 'v1', workspace, program: { executable: process.execPath, args: [fileURLToPath(new URL('./mock-codex.mjs', import.meta.url))] }, cliVersion: 'codex-cli mock-1', timeoutMs: 5000, prompt: 'Synthetic' };
  const original = JSON.stringify(settings.codex);
  settings.agents = { version: 1, selected: { id: 'codex-readonly', version: 'v1' }, profiles: [{ provider: 'codex', policy: settings.codex }, { provider: 'claude', policy: { id: 'claude-readonly', version: 'v1', workspace, program, cliVersion: '2.1.306 (Claude Code)', digest: programDigest(program), timeoutMs: 5000, prompt: 'Synthetic' } }] };
  saveSettings(root, settings); const desktop = new DesktopController(root, cb(), undefined, 'codex');
  const queued = await desktop.app.submit(image);
  const s = await desktop.dispatch({ v: 1, command: 'action', action: 'cycle-agent' }); assert.equal(s.profile.adapter, 'claude');
  assert.equal(desktop.app.get(queued).submission.provider, 'codex');
  assert.equal(desktop.app.get(queued).submission.profileId, 'codex-readonly');
  for (const raw of [{ id: 'evil', version: 'v1' }, { id: 'claude-readonly', version: 'v1', path: 'evil.exe' }]) await assert.rejects(desktop.dispatch({ v: 1, command: 'select-agent', ...raw }));
  assert.equal(JSON.stringify(loadSettings(root).codex), original); await desktop.close();
  const next = new DesktopController(root, cb(), undefined, 'codex'); assert.equal((await next.dispatch({ v: 1, command: 'snapshot' })).profile.adapter, 'claude'); await next.close();
  assert.equal(readFileSync(join(root, 'settings.json'), 'utf8').includes('PRIVATE_SECRET'), false);
});
for (const mode of ['success', 'error', 'exit', 'invalid', 'missing', 'huge', 'double', 'logs', 'hang', 'tree', 'cancel', 'auth']) test(`native Windows Claude adapter with mock process: ${mode}`, { skip: process.platform !== 'win32' }, async t => {
  const oldKey = process.env.ANTHROPIC_API_KEY, oldToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  delete process.env.ANTHROPIC_API_KEY; delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  t.after(() => { if (oldKey !== undefined) process.env.ANTHROPIC_API_KEY = oldKey; if (oldToken !== undefined) process.env.CLAUDE_CODE_OAUTH_TOKEN = oldToken; });
  const workspace = temp(); writeFileSync(join(workspace, 'mode'), mode === 'cancel' ? 'hang' : mode);
  const policy = { id: 'claude-readonly', version: 'v1', workspace, program, cliVersion: '2.1.306 (Claude Code)', digest: programDigest(program), timeoutMs: 5000, prompt: 'Synthetic only', imageProtocol: 'windows-jsonl-v1' };
  const profile = claudeProfile(policy), agent = new ClaudeAgent([policy]); const controller = new AbortController();
  let timer;
  if (mode === 'cancel') timer = setInterval(() => { if (existsSync(join(workspace, 'invocation.json'))) controller.abort(); }, 20);
  let result;
  try { result = await agent.execute({ taskId: randomUUID(), profileId: profile.id, profileVersion: profile.version, images: [{ fileName: 'synthetic.png', contentType: 'image/png', byteSize: image.length, sha256: sha256(image) }] }, profile, [image], controller.signal); }
  finally { clearInterval(timer); }
  assert.equal(await agent.settle(), true);
  assert.equal(result.status, mode === 'success' ? 'succeeded' : mode === 'auth' ? 'failed' : 'execution_unknown', result.errorCode);
  if (mode === 'auth') assert.equal(result.errorCode, 'CLAUDE_AUTH_ISOLATION_UNVERIFIED');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SECRET'), false);
  if (mode !== 'auth') {
    const invocation = JSON.parse(readFileSync(join(workspace, 'invocation.json'), 'utf8'));
    if (invocation.descendant) assert.throws(() => process.kill(invocation.descendant, 0));
    assert.equal(invocation.lines, 1); assert.equal(invocation.images[0].media_type, 'image/png'); assert.equal(sha256(Buffer.from(invocation.images[0].data, 'base64')), sha256(image));
  } else assert.equal(existsSync(join(workspace, 'invocation.json')), false);
});
test('submission rejects forged provider and malformed fingerprint', async () => {
  const { validateSubmissionMetadata } = await import('../../contracts/src/index.ts');
  const submission = { taskId: randomUUID(), profileId: 'codex-readonly', profileVersion: 'v1', images: [{ fileName: 'test.png', contentType: 'image/png', byteSize: image.length, sha256: sha256(image) }] };
  for (const extension of [{ provider: { malicious: true } }, { provider: 'shell' }, { profileFingerprint: 42 }, { profileFingerprint: 'wrong' }]) assert.equal(validateSubmissionMetadata({ ...submission, ...extension }).ok, false);
});
test('multiple native/npm installations remain candidates; incompatible flags are refused', async () => {
  const root = temp(); const dirs = [join(root, 'one'), join(root, 'two')];
  for (const dir of dirs) {
    mkdirSync(dir); const source = readFileSync(mock, 'utf8');
    if (process.platform === 'win32') {
      const pkg = join(dir, 'node_modules', '@anthropic-ai', 'claude-code'); mkdirSync(pkg, { recursive: true });
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.js' } }));
      writeFileSync(join(pkg, 'cli.js'), source); writeFileSync(join(dir, 'claude.cmd'), 'NEVER EXECUTE THIS SHIM');
    } else writeFileSync(join(dir, 'claude'), '#!/usr/bin/env node\n' + source, { mode: 0o700 });
  }
  const candidates = await discover('claude', root, { directories: dirs });
  assert.equal(candidates.filter(c => c.status === 'unverified_auth').length, 2);
  const manual = await discover('claude', root, { directories: dirs, manual: candidates[1].path }); assert.equal(manual.length, 1); assert.equal(manual[0].path, candidates[1].path);
  const incompatible = join(root, 'incompatible.mjs'); writeFileSync(incompatible, readFileSync(mock, 'utf8').replace('--restricted --safe-mode', ''));
  assert.equal((await inspectCandidate('claude', incompatible, root, undefined, { executable: process.execPath, args: [incompatible] })).status, 'unsupported');
});
test('CLI approval backs up configuration, preserves original profile, refuses live Worker and permits rollback', async () => {
  const { spawnSync } = await import('node:child_process'); const { readdirSync } = await import('node:fs');
  const root = temp(), workspace = temp(); const settings = defaults(); settings.adapter = 'codex';
  settings.codex = { id: 'codex-readonly', version: 'v1', workspace, program: { executable: process.execPath, args: [fileURLToPath(new URL('./mock-codex.mjs', import.meta.url))] }, cliVersion: 'codex-cli mock-1', timeoutMs: 5000, prompt: 'Synthetic' };
  saveSettings(root, settings); const before = readFileSync(join(root, 'settings.json'), 'utf8');
  const npm = join(temp(), 'npm'); const pkg = join(npm, 'node_modules', '@anthropic-ai', 'claude-code'); mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-code', bin: { claude: 'cli.js' } })); writeFileSync(join(pkg, 'cli.js'), readFileSync(mock));
  const shim = join(npm, 'claude.cmd'); writeFileSync(shim, 'NEVER EXECUTE');
  const cli = fileURLToPath(new URL('../../../apps/cli/src/mvp.ts', import.meta.url));
  const approve = () => spawnSync(process.execPath, ['--experimental-strip-types', cli, 'approve-agent', '--root', root, '--provider', 'claude', '--path', shim], { encoding: 'utf8', shell: false, timeout: 15000 });
  let desktop = new DesktopController(root, cb()); desktop.app.state.acquireWorker();
  const refused = approve(); assert.equal(refused.status, 1); assert.match(refused.stderr, /LOCAL_WORKER_ALREADY_RUNNING/); assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), before); await desktop.close();
  const approved = approve(); assert.equal(approved.status, 0, approved.stderr); const migrated = loadSettings(root);
  assert.equal(migrated.agents.profiles.length, 2); assert.deepEqual(migrated.codex, settings.codex);
  const backups = readdirSync(root).filter(n => n.startsWith('settings.m5-backup-')); assert.equal(backups.length, 1); assert.equal(readFileSync(join(root, backups[0]), 'utf8'), before);
  writeFileSync(join(root, 'settings.json'), before); desktop = new DesktopController(root, cb()); assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).profile.adapter, 'codex'); await desktop.close();
});
test('missing registered CLI preserves desktop history and fails before any model launch', async () => {
  const root = temp(), workspace = temp(), settings = defaults(); settings.adapter = 'codex';
  settings.codex = { id: 'codex-readonly', version: 'v1', workspace, program: { executable: join(workspace, 'missing.exe'), args: [] }, cliVersion: 'codex-cli missing', timeoutMs: 5000, prompt: 'Synthetic' };
  saveSettings(root, settings); const desktop = new DesktopController(root, cb());
  const id = await desktop.app.submit(image); await desktop.app.work();
  assert.equal(desktop.app.get(id).status, 'failed'); assert.equal(desktop.app.get(id).result.errorCode, 'CODEX_PREFLIGHT');
  assert.equal((await desktop.dispatch({ v: 1, command: 'snapshot' })).total, 1); await desktop.close();
});
test('normal Windows environment cannot be requested for a provider or arbitrary command', async () => {
  const { boundedProcess } = await import('../../worker/src/process.ts');
  await assert.rejects(boundedProcess(program, ['--version'], { cwd: temp(), timeoutMs: 1000, nativePolicy: true }), /SYSTEM_POLICY_PROGRAM_REQUIRED/);
});
