import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { DesktopController } from '../src/controller.ts';
import { nativeDefaults, publishCapture, validateNative } from '../src/native.ts';
import { defaults, loadSettings, saveSettings } from '../src/settings.ts';
import { validateHotkeys } from '../src/actions.ts';
import { FolderSource } from '../src/folder.ts';
import { actionFeedback } from '../src/tray.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
const png = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#45a879' } }).png().toBuffer();
function fixture(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'shot-native-'))), root = join(base, 'private'), out = join(base, 'images'); mkdirSync(out);
  const calls = { read: 0, sequence: 0, write: 0, image: 0 }; let sequence = 1;
  const clipboard = { session: 'synthetic-only', async sequence() { calls.sequence++; return String(sequence); }, async readImage() { calls.read++; }, async writeText() { calls.write++; return true; }, async writeImage() { calls.image++; return String(++sequence); }, close() {} };
  const host = new DesktopController(root, clipboard, { adapter: new FakeAgent(), profile: FAKE_PROFILE });
  const path = join(base, 'synthetic.png'); writeFileSync(path, png);
  t.after(async () => { await host.close(); rmSync(base, { recursive: true, force: true }); });
  const rpc = (command, args = {}) => host.dispatch({ v: 1, command, ...args });
  const configure = options => rpc('configure-native', { options: { ...nativeDefaults(), directory: out, ...options } });
  const capture = async () => rpc('capture-ingest', { path, options: Object.fromEntries(Object.entries(await rpc('capture-plan')).sort(([a], [b]) => a.localeCompare(b))) });
  return { base, root, out, host, rpc, configure, capture, calls, path };
}
test('M11 file-only PNG never calls clipboard; owned watched output never becomes a task', async t => {
  const f = fixture(t); await f.host.start();
  await f.rpc('configure', { capture: { folderEnabled: true, folderDirectory: f.out, mode: 'auto' }, autoConsent: true, delivery: { clipboard: 'manual' } });
  await f.configure(); const before = { ...f.calls };
  await f.capture(); await f.capture();
  assert.deepEqual(f.calls, before);
  const names = readdirSync(f.out); assert.equal(names.length, 2); assert.notEqual(names[0], names[1]);
  for (const name of names) { assert.deepEqual(readFileSync(join(f.out, name)), png); assert.equal((await sharp(join(f.out, name)).metadata()).format, 'png'); }
  await f.host.tick(); await new Promise(r => setTimeout(r, 1300)); await f.host.tick();
  assert.equal(f.host.app.list().length, 0); assert.equal(f.host.app.pending, undefined); assert.equal(f.calls.read, 0); assert.equal(f.calls.write, 0);
});
test('M11 save plus direct submit is one task through watched-folder reconciliation', async t => {
  const f = fixture(t); await f.host.start();
  await f.rpc('configure', { capture: { folderEnabled: true, folderDirectory: f.out, mode: 'auto' }, autoConsent: true, delivery: { clipboard: 'manual' } });
  await f.configure({ submit: true }); await f.capture(); await f.capture();
  await f.host.tick(); await new Promise(r => setTimeout(r, 1300)); await f.host.tick();
  assert.equal(f.host.app.list().length, 1); assert.equal(f.host.app.list()[0].attempts.length, 1); assert.equal(f.calls.write, 0);
});
test('M11 confirmation stages native bytes without submission; pause and settings changes refuse ingestion', async t => {
  const f = fixture(t); await f.host.start(); await f.configure({ submit: true });
  await f.capture(); assert.equal(f.host.app.list().length, 0); assert.deepEqual(f.host.app.pending.bytes, png);
  const old = await f.rpc('capture-plan');
  await f.rpc('pause', { paused: true }); await assert.rejects(f.capture, /CAPTURE_PAUSED/);
  await f.rpc('pause', { paused: false }); await f.configure({ submit: false });
  await assert.rejects(f.rpc('capture-ingest', { path: f.path, options: old }), /CAPTURE_SETTINGS_CHANGED/);
  await f.configure({ submit: true }); await f.capture(); await f.rpc('submit'); assert.equal(f.host.app.list().length, 1);
});
test('M11 clipboard output and task submission are independent; own image does not enter listener', async t => {
  const f = fixture(t); await f.host.start();
  await f.rpc('configure', { capture: { enabled: true, mode: 'auto' }, autoConsent: true, delivery: { clipboard: 'manual' } });
  await f.configure({ save: false, clipboard: true }); await f.capture(); await f.host.tick();
  assert.equal(f.calls.image, 1); assert.equal(f.calls.read, 0); assert.equal(f.host.app.list().length, 0);
});
test('M11 failed optional clipboard output retains saved screenshot and successful Agent task', async t => {
  const f = fixture(t); await f.host.start();
  f.host.app.clipboard.writeImage = async () => { throw Error('CLIPBOARD_BUSY'); };
  await f.rpc('configure', { capture: { mode: 'auto' }, autoConsent: true, delivery: { clipboard: 'manual' } });
  await f.configure({ submit: true, clipboard: true }); await f.capture(); await f.host.app.work();
  const s = await f.rpc('snapshot'); assert.equal(s.nativeCapture.clipboard, 'CLIPBOARD_BUSY'); assert.equal(s.tasks[0].status, 'succeeded'); assert.equal(readdirSync(f.out).length, 1);
});
test('M11 atomic output failure, corrupt image, partial-write and no-output refusal', async t => {
  const f = fixture(t); const bad = join(f.base, 'not-directory'); writeFileSync(bad, 'synthetic');
  assert.throws(() => publishCapture(bad, png, () => {}), /CAPTURE_STORAGE_FAILED/); assert.equal(readFileSync(bad, 'utf8'), 'synthetic');
  await f.configure({ directory: bad }); await assert.rejects(f.capture, /CAPTURE_STORAGE_FAILED/); assert.equal(f.host.app.list().length, 0);
  await f.configure({ directory: f.out }); writeFileSync(f.path, png.subarray(0, 14)); await assert.rejects(f.capture); assert.deepEqual(readdirSync(f.out), []);
  await f.configure({ save: false }); await assert.rejects(f.rpc('capture-plan'), /CAPTURE_OUTPUT_REQUIRED/);
});
test('M11 historical/latest typing sources bypass clipboard and delivery settings; no execution/history changes', async t => {
  const f = fixture(t); await f.host.start();
  await f.rpc('configure', { delivery: { clipboard: 'manual' } }); await f.configure();
  await assert.rejects(f.rpc('typing-source', { source: 'latest' }), /NO_COMPLETED_RESULT/);
  const id = await f.host.app.submit(png); await f.host.app.work();
  const tasks = globalThis.structuredClone(f.host.app.list()); const before = { ...f.calls };
  const latest = await f.rpc('typing-source', { source: 'latest' }); const history = await f.rpc('typing-source', { source: 'history', id });
  assert.match(latest.text, /Fake result/); assert.deepEqual(history, latest); assert.deepEqual(f.calls, before); assert.deepEqual(f.host.app.list(), tasks);
  await assert.rejects(f.rpc('typing-source', { source: 'clipboard' }), /INVALID_TYPING_SOURCE/);
});
test('M11 native settings migrate without altering old profile, delivery or hotkeys and persist across restart', async t => {
  const f = fixture(t); const original = defaults(); saveSettings(f.root, original); assert.equal(loadSettings(f.root).native, undefined);
  const options = { ...nativeDefaults(), directory: f.out, monitor: '\\\\.\\DISPLAY2', delayMs: 500, charsPerSecond: 200 };
  await f.configure(options); const stored = loadSettings(f.root); assert.deepEqual(stored.native, options); assert.deepEqual(stored.desktop, original.desktop); assert.deepEqual(stored.delivery, original.delivery);
  for (const bad of [{ ...options, charsPerSecond: 201 }, { ...options, delayMs: 499 }, { ...options, unknown: true }, { ...options, save: 1 }]) assert.throws(() => validateNative(bad));
  for (const native of [null, false, 0, 'corrupt']) {
    writeFileSync(join(f.root, 'settings.json'), JSON.stringify({ ...stored, native }));
    assert.throws(() => loadSettings(f.root), /INVALID_NATIVE_SETTINGS/);
  }
  saveSettings(f.root, stored);
  validateHotkeys({ 'capture-monitor': 'Ctrl+Alt+S', 'type-latest': 'Ctrl+Alt+T', 'stop-typing': 'Ctrl+Alt+X' });
  assert.throws(() => validateHotkeys({ 'capture-monitor': 'Ctrl+Alt+S', 'type-latest': 'Ctrl+Alt+S' }), /DUPLICATE_HOTKEY/);
  assert.match(actionFeedback('TYPING_EMPTY'), /没有可输入/);
  assert.match(actionFeedback('TYPING_INVALID_TARGET'), /文字输入位置/);
});
test('M11 watcher ignores partial files; a different external PNG still arrives', async t => {
  const f = fixture(t); const watcher = new FolderSource(); watcher.arm(f.out);
  writeFileSync(join(f.out, 'ours.partial'), png.subarray(0, 14)); writeFileSync(join(f.out, 'external.png'), png);
  const accepted = []; for (const now of [0, 1300, 2600]) await watcher.poll(async bytes => accepted.push(bytes), now);
  assert.equal(accepted.length, 1); assert.deepEqual(accepted[0], png);
});
