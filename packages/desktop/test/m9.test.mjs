import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, realpathSync, symlinkSync, truncateSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fileCacheUsage, CACHE_MAX_BYTES } from '../../local/src/file-cache.ts';
import { resultFiles } from '../../local/src/delivery.ts';
import { DesktopController } from '../src/controller.ts';
import { APP_VERSION } from '../src/version.ts';
import { makeCli, credentialStore } from '../../../apps/desktop/tests/fixtures.mjs';
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot-m9-')));
const clip = () => ({ session: 'synthetic-m9', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} });

function restoreFixture(root, fixture) {
  for (const [relative, content] of Object.entries(fixture.files)) {
    const path = join(root, relative); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content.text ? content.text.split('@ROOT@').join(JSON.stringify(root).slice(1, -1)) : Buffer.from(content.base64, 'base64'));
  }
  for (const [relative, database] of Object.entries(fixture.databases)) {
    const db = new DatabaseSync(join(root, relative));
    try {
      db.exec('BEGIN');
      for (const table of database.tables) {
        db.exec(table.sql);
        for (const row of table.rows) db.prepare(`INSERT INTO "${table.name}" VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
      }
      for (const sql of database.indexes) db.exec(sql);
      db.exec(`PRAGMA user_version=${database.userVersion}; COMMIT`);
    } finally { db.close(); }
  }
  makeCli(root, 'claude');
}
for (const version of ['0.7.2', '0.8.0', '0.8.1']) test(`upgrade historical ${version}: restart, shared Token references, immutable queue/unknown/history/export and pending receipt`, async t => {
  const root = temp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = JSON.parse(readFileSync(new URL(`../../../scripts/fixtures/upgrades/${version}.json`, import.meta.url)));
  restoreFixture(root, fixture);
  const original = readFileSync(join(root, 'settings.json'));
  const settings = JSON.parse(original); const refs = settings.agents.profiles.map(p => p.policy.gateway.credentialRef);
  assert.equal(new Set(refs).size, 1); assert.equal(refs.length, 2);
  const credentials = credentialStore({ [refs[0]]: 'synthetic-restored-token' });
  // A rolled-back old settings file and an interrupted settings write must survive untouched.
  writeFileSync(join(root, '.settings-interrupted.tmp'), '{"adapter":');
  let desktop;
  const load = () => new DesktopController(root, clip(), undefined, 'codex', async () => [], { credentials, testGateway: async () => { throw Error('PAID_REQUEST_FORBIDDEN'); } });
  try {
    for (let restart = 0; restart < 2; restart++) {
      desktop = load(); await desktop.start();
      const snapshot = await desktop.dispatch({ v: 1, command: 'snapshot' });
      assert.equal(snapshot.appVersion, APP_VERSION); assert.equal(snapshot.total, fixture.expected.length);
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'settings.json'))), settings);
      for (const expected of fixture.expected) {
        const task = desktop.app.get(expected.submission.taskId);
        assert.equal(task.status, expected.status); assert.deepEqual(task.submission, expected.submission);
        assert.deepEqual(task.attempts, expected.attempts);
        if (task.status === 'succeeded') {
          assert.deepEqual(task.result, expected.result);
          assert.equal(desktop.app.state.get(task.submission.taskId, 'clipboard').status, 'interrupted');
          const exported = join(root, 'exports', `${task.submission.taskId}.md`);
          assert.equal(readFileSync(exported, 'utf8'), task.result.contentMarkdown);
        }
      }
      assert.equal(await credentials.read(refs[0]), 'synthetic-restored-token');
      assert.deepEqual(credentials.deleted, []);
      assert.deepEqual(readFileSync(join(root, 'settings.json')), original);
      await desktop.close(); desktop = undefined;
    }
    // Retry after corrupt config refuses without replacing the recoverable original/backup.
    writeFileSync(join(root, 'settings.json'), '{');
    assert.throws(load); assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), '{');
    writeFileSync(join(root, 'settings.json'), original);
    desktop = load(); assert.equal(desktop.app.list().length, fixture.expected.length);
    assert.equal(readFileSync(join(root, '.settings-interrupted.tmp'), 'utf8'), '{"adapter":');
  } finally { await desktop?.close(); }
});

test('file cache quota accounts bytes/count, idempotent publication, unsafe links, no exports/history cleanup', async t => {
  const root = temp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  const task = { status: 'succeeded', result: { contentMarkdown: '# Synthetic result' }, submission: { taskId: randomUUID() } };
  const state = { root };
  assert.equal(fileCacheUsage(root).files, 0);
  const [path] = resultFiles(task, state); resultFiles(task, state);
  assert.equal(fileCacheUsage(root).files, 1); assert.equal(fileCacheUsage(root).bytes, Buffer.byteLength(task.result.contentMarkdown));
  const large = join(root, 'file-clipboard', `${randomUUID()}.md`); writeFileSync(large, ''); truncateSync(large, CACHE_MAX_BYTES);
  assert.throws(() => resultFiles({ ...task, submission: { taskId: randomUUID() } }, state), /FILE_CLIPBOARD_CACHE_FULL/);
  assert.deepEqual(resultFiles(task, state), [path]); rmSync(large);
  for (let i = 1; i < 1000; i++) writeFileSync(join(root, 'file-clipboard', `${randomUUID()}.md`), '');
  assert.equal(fileCacheUsage(root).files, 1000);
  assert.throws(() => resultFiles({ ...task, submission: { taskId: randomUUID() } }, state), /FILE_CLIPBOARD_CACHE_FULL/);
  if (process.platform !== 'win32') {
    const external = join(root, 'export.md'); writeFileSync(external, 'user export');
    const link = join(root, 'file-clipboard', `${randomUUID()}.md`); symlinkSync(external, link);
    assert.throws(() => fileCacheUsage(root), /UNSAFE_FILE_CACHE/); assert.equal(readFileSync(external, 'utf8'), 'user export');
  }
});

test('cache IPC requires explicit confirmation, fixes directory at worker root, refuses when native inspection unavailable', async t => {
  const root = temp(); const clipboard = clip(); let called = 0;
  const desktop = new DesktopController(root, clipboard);
  t.after(async () => { await desktop.close(); rmSync(root, { recursive: true, force: true }); });
  const rpc = args => desktop.dispatch({ v: 1, command: 'clean-file-cache', ...args });
  await assert.rejects(rpc({}), /CACHE_CLEANUP_CONFIRMATION_REQUIRED/);
  await assert.rejects(rpc({ confirm: true }), /FILE_CACHE_CLEANUP_UNAVAILABLE/);
  const directory = join(root, 'file-clipboard'); mkdirSync(directory);
  const path = join(directory, `${randomUUID()}.md`); writeFileSync(path, '# fake');
  clipboard.cleanFileCache = async dir => { called++; assert.equal(dir, directory); return { deleted: 0, retained: 1 }; };
  await assert.rejects(rpc({ confirm: true, directory: root }), /COMMAND_REFUSED/);
  assert.deepEqual(await rpc({ confirm: true }), { deleted: 0, retained: 1 });
  assert.equal(called, 1); assert.equal(existsSync(path), true);
  assert.deepEqual((await desktop.dispatch({ v: 1, command: 'snapshot' })).fileCache, fileCacheUsage(root));
  assert.equal(readdirSync(directory).length, 1);
});
