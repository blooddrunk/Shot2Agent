import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readdirSync, realpathSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { LocalApp, LOCAL_IDENTITY } from '../src/app.ts';
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
    assert.throws(() => app.deleteHistory([finished, queued], { reviewedUnknown: true }), /TASK_NOT_TERMINAL/);
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

test('reviewed unknown history deletion persists intent and recovers after interruption before core deletion', async () => {
  const dir = root(); let calls = 0;
  const agent = new FakeAgent('crash'); const execute = agent.execute.bind(agent);
  agent.execute = (...args) => { calls++; return execute(...args); };
  let app = new LocalApp(dir, agent, FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  try {
    const id = await completed(app, await image()); const task = app.get(id);
    const files = task.inputs.map(file => file.fileId);
    assert.equal(task.status, 'execution_unknown'); assert.equal(app.canReviewUnknownHistory, true);
    assert.throws(() => app.core.deleteTasks(LOCAL_IDENTITY.ownerId, [id]), /TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW/);
    assert.throws(() => app.deleteHistory([id], { reviewedUnknown: 'true' }), /TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW/);
    assert.deepEqual(app.state.pendingTaskDeletions(), []);
    app.core.deleteTasks = () => { throw Error('interrupted before core deletion'); };
    assert.throws(() => app.deleteHistory([id], { reviewedUnknown: true }), /interrupted before core deletion/);
    assert.deepEqual(app.state.pendingTaskDeletions(), [id]);
    app.close();
    app = new LocalApp(dir, agent, FAKE_PROFILE, { clipboard: 'off' }, clipboard);
    assert.deepEqual(app.list(), []); assert.deepEqual(app.state.pendingTaskDeletions(), []);
    assert.equal(app.state.provenance(id), undefined); assert.equal(app.state.baseline(id), undefined);
    assert.equal(app.core.store.attempts(id).length, 0);
    assert.ok(files.every(fileId => !existsSync(join(dir, 'blobs', fileId))));
    assert.equal(calls, 1);
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unknown history cannot be reviewed while an Agent is running; refusal does not cancel or replay it', async () => {
  const dir = root(); const app = new LocalApp(dir, new FakeAgent('crash'), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  let finish; let entered; let work; let activeSignal; let calls = 0;
  const started = new Promise(resolve => { entered = resolve; }); const done = new Promise(resolve => { finish = resolve; });
  try {
    const old = await completed(app, await image());
    const agent = { name: 'fake', version: 'blocking-fixture', async execute(_task, _profile, _images, signal) {
      calls++; activeSignal = signal; entered(); await done;
      return { status: 'failed', summary: 'Synthetic completion', contentMarkdown: '', artifacts: [], errorCode: 'FAKE_FAILURE' };
    } };
    app.setRegistry([{ adapter: agent, profile: FAKE_PROFILE }], FAKE_PROFILE.id, FAKE_PROFILE.version);
    const active = await app.submit(await image(), undefined, true); work = app.work(); await started;
    assert.equal(app.canReviewUnknownHistory, false);
    assert.throws(() => app.deleteHistory([old], { reviewedUnknown: true }), /HISTORY_AGENT_STOP_PENDING/);
    assert.equal(app.get(active).status, 'running'); assert.equal(activeSignal.aborted, false);
    assert.deepEqual(app.state.pendingTaskDeletions(), []);
    finish(); await work;
    assert.deepEqual(app.deleteHistory([old, active], { reviewedUnknown: true }), [old, active]);
    assert.equal(calls, 1); assert.deepEqual(app.list(), []);
  } finally { finish(); await work; app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unconfirmed Agent stop blocks reviewed deletion until restart and explicit review', async () => {
  const dir = root(); const agent = new FakeAgent('crash'); agent.settle = async () => false;
  let app = new LocalApp(dir, agent, FAKE_PROFILE, { clipboard: 'off' }, clipboard);
  try {
    const id = await app.submit(await image(), undefined, true);
    await assert.rejects(app.work(), /AGENT_STOP_UNCONFIRMED/);
    assert.equal(app.canReviewUnknownHistory, false);
    assert.throws(() => app.deleteHistory([id], { reviewedUnknown: true }), /HISTORY_AGENT_STOP_PENDING/);
    assert.equal(app.get(id).attempts.length, 1); assert.deepEqual(app.state.pendingTaskDeletions(), []);
    app.close(); app = new LocalApp(dir, new FakeAgent(), FAKE_PROFILE, { clipboard: 'off' }, clipboard);
    assert.throws(() => app.deleteHistory([id]), /TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW/);
    assert.deepEqual(app.deleteHistory([id], { reviewedUnknown: true }), [id]);
  } finally { app.close(); rmSync(dir, { recursive: true, force: true }); }
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
