import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discover, programDigest, resolveProgram } from '../../worker/src/discovery.ts';

const windows = { skip: process.platform !== 'win32' };
function installation(t, executable = join(process.env.SystemRoot, 'System32', 'where.exe')) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-codex-install-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const release = join(root, 'releases', 'synthetic-1', 'bin');
  mkdirSync(release, { recursive: true });
  // A real native executable with an intentionally incompatible version response.
  // Discovery may run --version; this fixture cannot make any model request.
  copyFileSync(executable, join(release, 'codex.exe'));
  const visible = join(root, 'local', 'Programs', 'OpenAI', 'Codex', 'bin');
  mkdirSync(join(visible, '..'), { recursive: true });
  symlinkSync(release, visible, 'junction');
  return { root, release, visible, path: join(visible, 'codex.exe') };
}

test('Windows native Codex junction selection pins the real file; manual and automatic scans agree', windows, async t => {
  const fixture = installation(t);
  const canonical = realpathSync(fixture.path);
  assert.notEqual(canonical, fixture.path);
  const program = resolveProgram('codex', fixture.path);
  assert.deepEqual(program, { executable: canonical, args: [] });
  const automatic = await discover('codex', fixture.root, { directories: [fixture.visible, fixture.release] });
  const manual = await discover('codex', fixture.root, { manual: fixture.path });
  assert.equal(automatic.length, 1); // Junction and release are one installation.
  assert.equal(manual.length, 1);
  for (const candidate of [automatic[0], manual[0]]) {
    assert.deepEqual(candidate.program, program);
    assert.equal(candidate.digest, programDigest(program));
    assert.equal(candidate.status, 'unsupported'); // Never bypass CLI compatibility.
  }
});

test('Windows native Codex default directory is discovered without inherited PATH', windows, async t => {
  const fixture = installation(t);
  const overrides = { PATH: '', Path: '', LOCALAPPDATA: join(fixture.root, 'local'), APPDATA: join(fixture.root, 'roaming'), USERPROFILE: join(fixture.root, 'user') };
  const before = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, overrides);
    const candidates = await discover('codex', fixture.root);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].path, fixture.path);
    assert.equal(candidates[0].program.executable, realpathSync(fixture.path));
    assert.equal(candidates[0].status, 'unsupported');
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('Windows native Codex junction retargeting never repins an approved program', windows, async t => {
  const fixture = installation(t, process.execPath);
  const selected = resolveProgram('codex', fixture.path);
  const script = join(fixture.root, 'preflight.mjs');
  writeFileSync(script, `if (process.argv.includes('--version')) console.log('codex-cli synthetic-1');
else if (process.argv.includes('--help')) console.log('--image --output-last-message --sandbox --ignore-user-config --ignore-rules --ephemeral');
else throw new Error('PREFLIGHT_ONLY');\n`);
  const program = { ...selected, args: [script] };
  const approved = { program, version: 'codex-cli synthetic-1', digest: programDigest(program) };
  const nextRelease = join(fixture.root, 'releases', 'synthetic-2', 'bin');
  mkdirSync(nextRelease, { recursive: true });
  copyFileSync(process.execPath, join(nextRelease, 'codex.exe'));
  rmSync(fixture.visible);
  symlinkSync(nextRelease, fixture.visible, 'junction');
  assert.notEqual(resolveProgram('codex', fixture.path).executable, program.executable);
  const [pinned] = await discover('codex', fixture.root, { approved });
  assert.deepEqual(pinned.program, program);
  assert.equal(pinned.digest, approved.digest);
  assert.equal(pinned.status, 'unverified_auth');
  writeFileSync(script, readFileSync(script, 'utf8') + '\n// Changed file, same compatible version.\n');
  assert.equal((await discover('codex', fixture.root, { approved }))[0].status, 'version_changed');
  rmSync(program.executable);
  assert.equal((await discover('codex', fixture.root, { approved }))[0].status, 'invalid');
});

test('Windows stored alias paths remain invalid and Claude junction handling is unchanged', windows, async t => {
  const fixture = installation(t);
  assert.throws(() => programDigest({ executable: fixture.path, args: [] }), /UNSAFE_CLI_PATH/);
  assert.throws(() => resolveProgram('claude', fixture.path), /UNSAFE_CLI_PATH/);
  const [candidate] = await discover('codex', fixture.root, {
    approved: { program: { executable: fixture.path, args: [] }, version: 'codex-cli synthetic-1' },
  });
  assert.equal(candidate.status, 'invalid');
});

test('Codex still refuses relative, network and unverified script selections', () => {
  assert.throws(() => resolveProgram('codex', 'relative.exe'), /LOCAL_ABSOLUTE_PATH_REQUIRED/);
  assert.throws(() => resolveProgram('codex', '//server/share/codex.exe'), /LOCAL_ABSOLUTE_PATH_REQUIRED/);
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-codex-refusal-')));
  try {
    const script = join(root, 'codex.ps1');
    writeFileSync(script, 'throw "NEVER EXECUTE"');
    assert.throws(() => resolveProgram('codex', script));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
