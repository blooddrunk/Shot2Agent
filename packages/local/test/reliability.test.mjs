import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync, readFileSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { atomicSave, deliver, validateRetry } from '../src/delivery.ts';
import { LocalState } from '../src/state.ts';
import { WindowsClipboard } from '../src/clipboard.ts';
const root = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot2agent-m4-')));
const config = { clipboard: 'smart', retry: { maxRetries: 2, backoffMs: 10, budgetMs: 500 } };
function task() { return { status: 'succeeded', submission: { taskId: randomUUID() }, result: { contentMarkdown: 'synthetic result' } }; }
async function scenario(run) {
  const dir = root(); let state = new LocalState(dir); const t = task(); const id = t.submission.taskId;
  const clip = { session: 'original', seq: '1', calls: 0, written: 0, close() {}, async writeText(text, expected) {
    this.calls++; assert.equal(expected, '1'); if (this.seq !== expected) return false; this.written++; return true;
  } };
  state.capture(id, 'synthetic', { session: clip.session, sequence: clip.seq });
  try { await run({ dir, state, t, id, clip, restart() { state.close(); state = new LocalState(dir); return state; } }); }
  finally { state.close(); rmSync(dir, { recursive: true, force: true }); }
}
test('busy then recovery retries with original baseline; independent file result and restart receipts', () => scenario(async ({ dir, state, t, id, clip, restart }) => {
  const write = clip.writeText.bind(clip); let busy = true;
  clip.writeText = async (...args) => { if (busy) { busy = false; throw Error('CLIPBOARD_BUSY'); } return write(...args); };
  await deliver(t, { ...config, saveDirectory: join(dir, 'out') }, state, clip);
  assert.equal(state.get(id, 'clipboard').attempts, 2); assert.equal(state.get(id, 'clipboard').status, 'succeeded');
  assert.equal(state.get(id, 'save').attempts, 1); assert.equal(readFileSync(join(dir, 'out', `${id}.md`), 'utf8'), 'synthetic result');
  const next = restart(); assert.equal(next.get(id, 'clipboard').history[0].code, 'CLIPBOARD_BUSY');
  await deliver(t, config, next, clip); assert.equal(clip.written, 1);
}));
for (const maxRetries of [0, 2]) test(`retry exhaustion bounded: ${maxRetries}`, () => scenario(async ({ state, t, id, clip }) => {
  clip.writeText = async () => { clip.calls++; throw Error('CLIPBOARD_BUSY'); };
  await deliver(t, { ...config, retry: { ...config.retry, maxRetries } }, state, clip);
  const r = state.get(id, 'clipboard'); assert.equal(r.status, 'failed'); assert.equal(r.attempts, maxRetries + 1);
  assert.equal(clip.calls, maxRetries + 1); assert.equal(r.code, 'CLIPBOARD_BUSY'); assert.equal(r.stopReason, 'retry_limit');
}));
for (const changed of ['sequence', 'session']) test(`backoff ${changed} change stops Smart without refreshing baseline`, () => scenario(async ({ state, t, id, clip }) => {
  const write = clip.writeText.bind(clip); let first = true;
  clip.writeText = async (...args) => {
    if (first) { first = false; globalThis.queueMicrotask(() => { if (changed === 'sequence') clip.seq = '2'; else clip.session = 'new'; }); throw Error('CLIPBOARD_BUSY'); }
    return write(...args);
  };
  await deliver(t, config, state, clip);
  assert.equal(state.get(id, 'clipboard').status, 'blocked_by_clipboard_change'); assert.equal(clip.written, 0);
  assert.deepEqual(state.baseline(id), { session: 'original', sequence: '1' });
}));
for (const code of ['CLIPBOARD_WRITE_AMBIGUOUS', 'CLIPBOARD_HELPER_TIMEOUT', 'CLIPBOARD_HELPER_STOPPED', 'CLIPBOARD_TEXT_LIMIT']) test(`${code} is never automatically retried`, () => scenario(async ({ state, t, id, clip }) => {
  clip.writeText = async () => { clip.calls++; throw Error(code); };
  await deliver(t, config, state, clip); assert.equal(clip.calls, 1); assert.equal(state.get(id, 'clipboard').attempts, 1);
  assert.equal(state.get(id, 'clipboard').classification, code === 'CLIPBOARD_TEXT_LIMIT' ? 'permanent' : 'ambiguous');
}));
test('budget prevents scheduling retry; no unbounded wait or extra calls', () => scenario(async ({ state, t, id, clip }) => {
  clip.writeText = async () => { clip.calls++; throw Error('CLIPBOARD_BUSY'); };
  await deliver(t, { ...config, retry: { maxRetries: 10, backoffMs: 100, budgetMs: 100 } }, state, clip);
  assert.equal(clip.calls, 1); assert.equal(state.get(id, 'clipboard').stopReason, 'time_budget');
}));
test('parallel explicit delivery cannot steal pending reservation; restart marks interruption without replay', () => scenario(async ({ state, t, id, clip, restart }) => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  clip.writeText = async () => { await gate; clip.written++; return true; };
  const first = deliver(t, config, state, clip);
  await deliver(t, config, state, clip, true); release(); await first; assert.equal(clip.written, 1);
  state.put(id, 'clipboard', { status: 'pending', attempts: 7 });
  const next = restart(); next.acquireWorker();
  assert.equal(next.get(id, 'clipboard').status, 'interrupted');
  await deliver(t, config, next, clip); assert.equal(clip.written, 1);
}));
test('save conflict fails independently while clipboard succeeds', () => scenario(async ({ dir, state, t, id, clip }) => {
  const out = join(dir, 'out'); atomicSave(out, id, 'operator file');
  await deliver(t, { ...config, saveDirectory: out }, state, clip);
  assert.equal(state.get(id, 'save').code, 'SAVE_CONFLICT'); assert.equal(state.get(id, 'save').attempts, 1);
  assert.equal(state.get(id, 'clipboard').status, 'succeeded'); assert.equal(readFileSync(join(out, `${id}.md`), 'utf8'), 'operator file');
}));
test('concurrent independent publishers preserve one complete winner, identical writes idempotent', async () => {
  const dir = root(); const id = randomUUID(); const gate = new SharedArrayBuffer(4);
  const moduleURL = new URL('../src/delivery.ts', import.meta.url).href;
  const workers = Array.from({ length: 8 }, (_, i) => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => { const { atomicSave } = await import(workerData.url); parentPort.postMessage('ready');
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      try { atomicSave(workerData.dir, workerData.id, workerData.text); parentPort.postMessage('ok'); }
      catch(e) { parentPort.postMessage(e.message); }
    })();`, { eval: true, workerData: { dir, id, gate, url: moduleURL, text: i % 2 ? 'A'.repeat(10000) : 'B'.repeat(10000) } }));
  const outcomes = workers.map(w => new Promise((resolve, reject) => { w.on('error', reject); w.on('message', message => { if (message !== 'ready') resolve(message); }); }));
  try {
    await Promise.all(workers.map(w => new Promise(resolve => w.once('message', resolve))));
    Atomics.store(new Int32Array(gate), 0, 1); Atomics.notify(new Int32Array(gate), 0);
    const results = await Promise.all(outcomes); assert.ok(results.includes('ok')); assert.ok(results.includes('SAVE_CONFLICT'));
    const winner = readFileSync(join(dir, `${id}.md`), 'utf8'); assert.ok([ 'A'.repeat(10000), 'B'.repeat(10000) ].includes(winner));
    atomicSave(dir, id, winner); assert.throws(() => atomicSave(dir, id, 'different'), /SAVE_CONFLICT/);
    assert.equal(readdirSync(dir).length, 1);
  } finally { await Promise.all(workers.map(w => w.terminate())); rmSync(dir, { recursive: true, force: true }); }
});
test('path traversal and symlink/junction roots refuse without modifying destination', () => {
  const dir = root(); const id = randomUUID();
  try {
    assert.throws(() => atomicSave(dir, '../bad', 'x'), /UNSAFE_SAVE_PATH/);
    const out = join(dir, 'out'); atomicSave(out, id, 'safe'); const link = join(dir, 'link'); symlinkSync(out, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => atomicSave(link, randomUUID(), 'x'));
    if (process.platform === 'win32') return; // File symlinks need developer privilege; junction root above does not.
    const other = randomUUID(); symlinkSync(join(out, `${id}.md`), join(out, `${other}.md`));
    assert.throws(() => atomicSave(out, other, 'safe'), /SAVE_CONFLICT/);
    assert.equal(readFileSync(join(out, `${id}.md`), 'utf8'), 'safe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('invalid retry policies refused before any side effect', () => {
  for (const value of [null, {}, { maxRetries: 11, backoffMs: 10, budgetMs: 100 }, { ...config.retry, budgetMs: Infinity }, { ...config.retry, maxRetries: 1.5 }]) assert.throws(() => validateRetry(value), /INVALID_DELIVERY_RETRY/);
});
test('save transient retry is independent, bounded and does not repeat successful clipboard', context => scenario(async ({ state, t, id, clip, dir }) => {
  // This case tests retry count/independence. Slow hosted SQLite writes must not
  // turn it into the separate elapsed-budget refusal test above.
  context.mock.method(globalThis.performance, 'now', () => 0);
  let saves = 0;
  await deliver(t, { ...config, saveDirectory: join(dir, 'out') }, state, clip, false, () => {
    if (++saves < 3) throw Object.assign(Error('busy'), { code: 'EBUSY' });
  });
  assert.equal(saves, 3); assert.equal(state.get(id, 'save').status, 'succeeded');
  assert.equal(state.get(id, 'save').history.length, 2); assert.equal(clip.written, 1);
}));
test('save permanent refusal leaves clipboard successful, no repeated write', () => scenario(async ({ state, t, id, clip, dir }) => {
  await deliver(t, { ...config, saveDirectory: join(dir, 'out') }, state, clip, false, () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); });
  assert.equal(state.get(id, 'save').code, 'SAVE_EACCES'); assert.equal(state.get(id, 'save').attempts, 1); assert.equal(clip.written, 1);
}));

test('Smart protection remains sticky when settings change to Always before explicit delivery retry', () => scenario(async ({ state, t, id, clip }) => {
  clip.writeText = async () => { throw Error('CLIPBOARD_BUSY'); };
  await deliver(t, { clipboard: 'smart' }, state, clip);
  assert.equal(state.get(id, 'clipboard').smartGuard, true);
  clip.seq = 'newer';
  clip.writeText = async (_text, expected) => { assert.equal(expected, '1'); if (expected !== clip.seq) return false; clip.written++; return true; };
  await deliver(t, { clipboard: 'always' }, state, clip, true);
  assert.equal(clip.written, 0); assert.equal(state.get(id, 'clipboard').status, 'blocked_by_clipboard_change');
  assert.equal(state.get(id, 'clipboard').smartGuard, true);
}));
test('legacy failed clipboard receipts with a baseline retain conservative Smart protection', () => scenario(async ({ state, t, id, clip }) => {
  state.put(id, 'clipboard', { status: 'failed', attempts: 1 }); clip.seq = 'newer';
  clip.writeText = async (_text, expected) => { assert.equal(expected, '1'); return false; };
  await deliver(t, { clipboard: 'always' }, state, clip, true);
  assert.equal(state.get(id, 'clipboard').status, 'blocked_by_clipboard_change');
  assert.equal(clip.written, 0);
}));

// Fault-inject the inherited pipe/queue without starting PowerShell or changing a
// real clipboard. Public writeText/request/timeout/close methods remain production.
function stalledClipboard(queue = Promise.resolve()) {
  const clipboard = Object.create(WindowsClipboard.prototype); let writes = 0; let kills = 0;
  Object.assign(clipboard, { queue, dead: false, child: { stdin: { write() { writes++; } }, kill() { kills++; } } });
  return { clipboard, writes: () => writes, kills: () => kills };
}
test('clipboard budget expires while queued and forbids a late pipe write after queue release', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; }); const port = stalledClipboard(gate);
  await assert.rejects(port.clipboard.writeText('synthetic', undefined, 20), /CLIPBOARD_DEADLINE_BEFORE_WRITE/);
  assert.equal(port.writes(), 0); assert.equal(port.kills(), 0);
  release(); await port.clipboard.queue; assert.equal(port.writes(), 0); port.clipboard.close();
});
test('clipboard budget expiry during an active write kills its helper and never replays', async () => {
  const port = stalledClipboard();
  await assert.rejects(port.clipboard.writeText('synthetic', undefined, 1000), /CLIPBOARD_HELPER_TIMEOUT/);
  assert.equal(port.writes(), 1); assert.equal(port.kills(), 1);
  await assert.rejects(port.clipboard.writeText('synthetic', undefined, 20), /CLIPBOARD_HELPER_STOPPED/);
  assert.equal(port.writes(), 1);
});
