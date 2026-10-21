import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalApp } from '../src/app.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';

const root = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot2agent-history-')));
const image = () => sharp({ create: { width: 24, height: 20, channels: 3, background: '#518faa' } }).png().toBuffer();
const clipboard = { session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { return true; }, close() {} };

async function completed(app, bytes, sequence = '1') {
  const id = await app.submit(bytes, { session: 'synthetic', sequence }, true);
  await app.work();
  return id;
}

test('single and batch deletion remove task, attempts, private blobs and Local metadata but keep external Markdown', async () => {
  const dir = root(); let app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE,
    { clipboard: 'manual', saveDirectory: join(dir, 'external') }, clipboard);
  try {
    const png = await image(); const first = await completed(app, png); const second = await completed(app, await image(), '2');
    const third = await completed(app, await image(), '3');
    const firstTask = app.get(first); const firstFiles = [...firstTask.inputs, ...firstTask.result.artifacts].map(f => f.fileId);
    assert.equal(firstTask.attempts.length, 1);
    assert.equal(app.state.provenance(first).transformation, 'none');
    assert.equal(app.state.get(first, 'save').status, 'succeeded');
    assert.equal(app.state.get(first, 'clipboard').status, 'manual');
    const external = join(dir, 'external', `${first}.md`);
    assert.equal(existsSync(external), true);

    assert.deepEqual(app.deleteHistory([first]), [first]);
    assert.equal(app.list().some(task => task.submission.taskId === first), false);
    assert.equal(app.state.get(first, 'save'), undefined);
    assert.equal(app.state.get(first, 'clipboard'), undefined);
    assert.equal(app.state.provenance(first), undefined);
    assert.equal(app.state.baseline(first), undefined);
    assert.ok(firstFiles.every(fileId => !existsSync(join(dir, 'blobs', fileId))));
    assert.equal(existsSync(external), true);

    assert.deepEqual(app.deleteHistory([second, third]), [second, third]);
    assert.equal(app.list().length, 0);
    app.close();
    app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE, { clipboard: 'manual' }, clipboard);
    assert.deepEqual(app.list(), []);
    assert.equal(readdirSync(join(dir, 'blobs')).length, 0);
    assert.equal(readFileSync(external, 'utf8').length > 0, true);
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('batch deletion is all-or-nothing when any selected task is queued or execution outcome is unknown', async () => {
  const dir = root(); const app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  try {
    const png = await image(); const finished = await completed(app, png);
    const queued = await app.submit(await image(), undefined, true);
    assert.throws(() => app.deleteHistory([finished, queued]), /TASK_NOT_TERMINAL/);
    assert.equal(app.get(finished).status, 'succeeded'); assert.equal(app.get(queued).status, 'queued');
    assert.equal(app.list().length, 2);
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }

  const unknownRoot = root(); const unknown = new LocalApp(unknownRoot, new FakeAgent('crash'), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  try {
    const id = await unknown.submit(await image(), undefined, true); await unknown.work();
    assert.equal(unknown.get(id).status, 'execution_unknown');
    assert.throws(() => unknown.deleteHistory([id]), /TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW/);
    assert.equal(unknown.get(id).attempts.length, 1);
  } finally { unknown.close(); rmSync(unknownRoot, { recursive: true, force: true }); }
});

test('interrupted blob cleanup is idempotently recovered on the next LocalApp open', async () => {
  const dir = root(); let app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  try {
    const id = await completed(app, await image());
    const files = [...app.get(id).inputs, ...app.get(id).result.artifacts].map(f => f.fileId);
    const finish = app.core.store.finishBlobCleanup.bind(app.core.store);
    app.core.store.finishBlobCleanup = () => { throw new Error('simulated interruption after unlink'); };
    assert.throws(() => app.deleteHistory([id]), /simulated interruption/);
    app.core.store.finishBlobCleanup = finish;
    app.close();

    app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
    assert.deepEqual(app.list(), []);
    assert.equal(app.state.pendingTaskDeletions().length, 0);
    assert.equal(app.core.store.pendingBlobCleanup().length, 0);
    assert.ok(files.every(fileId => !existsSync(join(dir, 'blobs', fileId))));
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }
});
