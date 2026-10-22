import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, realpathSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { FolderSource, validateCaptureFolder } from '../src/folder.ts';
import { DesktopController } from '../src/controller.ts';
import { defaults, saveSettings } from '../src/settings.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
import { sha256 } from '../../core/src/blobs.ts';
const images = await Promise.all(['red', 'green', 'blue', 'white', 'black'].map(background => sharp({ create: { width: 24, height: 16, channels: 3, background } }).png().toBuffer()));
const temp = () => realpathSync(mkdtempSync(join(tmpdir(), 'shot-m8-')));
function clipboard() { return { session: 'm8', seq: '1', image: undefined, files: [], writes: [], notifications: 0,
  async sequence() { return this.seq; }, async readImage() { return this.image ? { bytes: this.image, sequence: this.seq } : undefined; },
  async writeText(text, expected) { if (expected && expected !== this.seq) return false; this.writes.push(text); return true; },
  async writeFiles(files, expected) { if (expected && expected !== this.seq) return false; for (const path of files) assert.match(readFileSync(path, 'utf8'), /Fake result/); this.files.push(files); return true; },
  async notify() { this.notifications++; }, close() {} }; }
function setup(t) { const root = temp(); const cb = clipboard(); const desktop = new DesktopController(root, cb); t.after(async () => { await desktop.close(); rmSync(root, { recursive: true, force: true }); }); return { root, cb, desktop, rpc: (command, args = {}) => desktop.dispatch({ v: 1, command, ...args }) }; }

test('folder settles bytes, skips startup, tolerates partial/replaced/renamed files, rearm and unsafe input', async t => {
  const root = temp(); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'old.png'), images[0]); const source = new FolderSource(); source.arm(root); const seen = [];
  const accept = async bytes => { await sharp(bytes).stats(); seen.push(sha256(bytes)); };
  await source.poll(accept, 10000); assert.equal(seen.length, 0);
  const path = join(root, 'new.png'); writeFileSync(path, images[1].subarray(0, 12));
  await source.poll(accept, 11000); await source.poll(accept, 12200); assert.equal(seen.length, 0);
  writeFileSync(path, images[1]); await source.poll(accept, 12300); await source.poll(accept, 13500); assert.equal(seen.length, 0);
  await source.poll(accept, 14700); assert.deepEqual(seen, [sha256(images[1])]);
  await source.poll(accept, 16000); assert.equal(seen.length, 1);
  writeFileSync(path, images[2]); await source.poll(accept, 17000); await source.poll(accept, 18200); await source.poll(accept, 19400); assert.equal(seen.length, 2);
  writeFileSync(join(root, 'temp.tmp'), images[3]); renameSync(join(root, 'temp.tmp'), join(root, 'renamed.webp'));
  await source.poll(accept, 21000); await source.poll(accept, 22200); await source.poll(accept, 23400); assert.equal(seen.length, 3);
  writeFileSync(join(root, 'pause.png'), images[4]); source.arm(root); await source.poll(accept, 25000); assert.equal(seen.length, 3);
  if (process.platform !== 'win32') { symlinkSync(path, join(root, 'link.png')); await source.poll(accept, 26000); assert.equal(source.error, 'FOLDER_IMAGE_UNSAFE_OR_TOO_LARGE'); }
  assert.throws(() => validateCaptureFolder(root, [join(root, 'out')]), /CAPTURE_OUTPUT_OVERLAP/);
  assert.throws(() => validateCaptureFolder(join(root, '..'), [root]));
});

for (const [enabled, folderEnabled] of [[true, false], [false, true], [true, true], [false, false]]) test(`independent capture sources clipboard=${enabled} folder=${folderEnabled}; migration, consent and pause`, async t => {
  const { desktop, rpc, cb, root } = setup(t); const folder = temp(); t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'old.png'), images[0]); await desktop.start();
  await rpc('configure', { capture: { enabled, folderEnabled, folderDirectory: folder, mode: 'auto' }, autoConsent: true, delivery: { clipboard: 'off' } });
  cb.seq = '2'; cb.image = images[1]; await desktop.tick();
  assert.equal(desktop.app.list().length, enabled ? 1 : 0);
  // Drive the same reconciliation clock deterministically without waiting on filesystem timing.
  writeFileSync(join(folder, 'new.png'), images[2]);
  const ingest = bytes => desktop.app.ingest(bytes, true, { session: cb.session, sequence: cb.seq }, 'folder');
  if (folderEnabled) { await desktop.folder.poll(ingest, 10000); await desktop.folder.poll(ingest, 11200); await desktop.folder.poll(ingest, 12400); }
  assert.equal(desktop.app.list().length, Number(enabled) + Number(folderEnabled));
  await rpc('pause', { paused: true }); cb.seq = '3'; cb.image = images[3]; await desktop.tick();
  const count = desktop.app.list().length; await rpc('pause', { paused: false }); await desktop.tick(); assert.equal(desktop.app.list().length, count);
  assert.equal(JSON.parse(readFileSync(join(root, 'settings.json'))).desktop.folderEnabled, folderEnabled);
  assert.equal((await rpc('snapshot')).settings.enabled, enabled);
});

test('cross-source automatic dedupe, confirmation coalescing and explicit manual repeat', async t => {
  const { desktop, cb, rpc } = setup(t); await desktop.start();
  await desktop.app.ingest(images[0], true, undefined, 'folder'); cb.image = images[0]; cb.seq = '2';
  await desktop.app.observe(true); assert.equal(desktop.app.list().length, 1);
  await rpc('current'); await rpc('current'); assert.equal(desktop.app.list().length, 3);
  await desktop.app.ingest(images[1], false, undefined, 'folder'); cb.image = images[1]; cb.seq = '3'; await desktop.app.observe(false);
  await rpc('submit'); assert.equal(desktop.app.list().length, 4); assert.equal(desktop.app.pending, undefined);
  assert.equal(desktop.app.state.provenance(desktop.app.list().at(-1).submission.taskId).source, 'folder');
});

for (const count of [2, 5]) test(`composer ${count} images: add/reorder/remove, one ordered immutable task, Fake claim and restart`, async t => {
  const { desktop, root, rpc } = setup(t); await desktop.start();
  const paths = images.map((bytes, i) => { const path = join(root, `fixture-${i}.png`); writeFileSync(path, bytes); return path; });
  await rpc('composer-add-files', { paths: paths.slice(0, count) }); assert.equal(desktop.app.list().length, 0);
  await rpc('composer-move', { index: 0, to: count - 1 });
  const expected = [...images.slice(1, count), images[0]].map(sha256);
  const snapshot = await rpc('composer-submit'); assert.equal(snapshot.composer.length, 0); assert.equal(desktop.app.list().length, 1);
  let task = desktop.app.list()[0]; assert.deepEqual(task.submission.images.map(i => i.sha256), expected); const id = task.submission.taskId;
  await desktop.app.work(); task = desktop.app.get(id); assert.equal(task.status, 'succeeded'); assert.equal(task.attempts.length, 1);
  await desktop.close();
  const next = new DesktopController(root, clipboard()); try { assert.deepEqual(next.app.get(id).submission.images.map(i => i.sha256), expected); } finally { await next.close(); }
});

test('composer validation is atomic, edit/discard has no blobs, queued Agent binding immutable', async t => {
  const { desktop, rpc, root, cb } = setup(t); await desktop.start();
  const good = join(root, 'ok.png'), bad = join(root, 'bad.png'); writeFileSync(good, images[0]); writeFileSync(bad, 'broken');
  await assert.rejects(rpc('composer-add-files', { paths: [good, bad] })); assert.deepEqual((await rpc('snapshot')).composer, []);
  await assert.rejects(rpc('composer-submit'), /BATCH_IMAGE_COUNT/);
  await assert.rejects(rpc('composer-add-files', { paths: Array(6).fill(good) }), /BATCH_IMAGE_COUNT/);
  cb.image = images[1]; await rpc('composer-add-files', { paths: [good] }); await rpc('composer-add-clipboard');
  await rpc('composer-remove', { index: 1 }); await assert.rejects(rpc('composer-submit'), /BATCH_IMAGE_COUNT/); await rpc('composer-discard');
  assert.equal(desktop.app.list().length, 0); assert.equal(readdirSync(join(root, 'blobs')).length, 0);
  const alt = { ...FAKE_PROFILE, id: 'fake-second', version: '2' }; desktop.app.setRegistry([{ adapter: new FakeAgent(), profile: FAKE_PROFILE }, { adapter: new FakeAgent(), profile: alt }], FAKE_PROFILE.id, FAKE_PROFILE.version);
  const pending = desktop.app.submitImages([images[0], images[1]]); desktop.app.select(alt.id, alt.version); const id = await pending;
  assert.equal(desktop.app.get(id).submission.profileId, FAKE_PROFILE.id);
  await assert.rejects(desktop.app.submitImages([images[0], Buffer.from('broken')], undefined, true)); assert.equal(desktop.app.list().length, 1);
  await assert.rejects(desktop.app.submitImages([Buffer.alloc(60 * 1024 * 1024), images[0]]), /BATCH_OVER_60_MIB/);
});

test('M7 settings migration retains clipboard consent/theme/hotkeys; never enables folder', async t => {
  const { root } = setup(t); const settings = defaults(); settings.desktop.enabled = true; settings.desktop.alwaysConsent = true;
  settings.hotkeys = { current: 'Ctrl+Alt+S' }; saveSettings(root, settings);
  const next = new DesktopController(root, clipboard()); try { assert.equal(next.settings.desktop.folderEnabled, undefined); assert.equal(next.settings.desktop.enabled, true); assert.equal(next.settings.desktop.alwaysConsent, true); assert.deepEqual(next.settings.hotkeys, settings.hotkeys); } finally { await next.close(); }
});

test('independent file clipboard/save/native notification receipts, stable files and retry never executes Agent', async t => {
  const { desktop, rpc, cb, root } = setup(t); await desktop.start(); const save = join(root, 'export');
  await rpc('configure', { delivery: { clipboard: 'always', clipboardPayload: 'files', notification: true, saveDirectory: save }, alwaysConsent: true });
  cb.notify = async () => { throw Error('NATIVE_NOTIFICATION_UNAVAILABLE'); };
  const id = await desktop.app.submit(images[0]); await desktop.app.work();
  assert.equal(desktop.app.state.get(id, 'save').status, 'succeeded'); assert.equal(desktop.app.state.get(id, 'clipboard').status, 'succeeded'); assert.equal(desktop.app.state.get(id, 'notification').status, 'failed');
  assert.equal(cb.files.length, 1); const path = cb.files[0][0]; assert.match(readFileSync(path, 'utf8'), /Fake result/);
  cb.notify = async () => { cb.notifications++; }; await rpc('retry-delivery', { id });
  assert.equal(cb.notifications, 1); assert.equal(cb.files.length, 1); assert.equal(desktop.app.get(id).attempts.length, 1);
  await rpc('copy', { id }); await rpc('copy-files', { id }); assert.equal(cb.writes.length, 1); assert.equal(cb.files.length, 2);
  desktop.app.deleteHistory([id]); assert.match(readFileSync(path, 'utf8'), /Fake result/); assert.match(readFileSync(join(save, `${id}.md`), 'utf8'), /Fake result/);
});

test('history-only and file Smart conflict/busy/ambiguous failures preserve bounded semantics', async t => {
  const { desktop, rpc, cb } = setup(t); await desktop.start();
  await rpc('configure', { delivery: { clipboard: 'off', notification: false } });
  const silent = await desktop.app.submit(images[0]); await desktop.app.work();
  for (const channel of ['save', 'clipboard', 'notification']) assert.equal(desktop.app.state.get(silent, channel).status, 'disabled'); assert.equal(cb.notifications, 0); assert.equal(cb.files.length, 0);
  await rpc('configure', { delivery: { clipboard: 'smart', clipboardPayload: 'files' } });
  const conflict = await desktop.app.submit(images[1], { session: cb.session, sequence: '0' }); await desktop.app.work(); assert.equal(desktop.app.state.get(conflict, 'clipboard').status, 'blocked_by_clipboard_change');
  for (const code of ['CLIPBOARD_BUSY', 'CLIPBOARD_HELPER_TIMEOUT', 'CLIPBOARD_WRITE_AMBIGUOUS']) {
    let writes = 0; cb.writeFiles = async () => { writes++; throw Error(code); };
    await rpc('configure', { delivery: { clipboard: 'always', clipboardPayload: 'files', notification: true, retry: { maxRetries: 2, backoffMs: 10, budgetMs: 3000 } }, alwaysConsent: true });
    const id = await desktop.app.submit(images[2], undefined, true); await desktop.app.work();
    assert.equal(writes, code === 'CLIPBOARD_BUSY' ? 3 : 1); assert.equal(desktop.app.state.get(id, 'notification').status, 'succeeded'); assert.equal(desktop.app.get(id).attempts.length, 1);
  }
});
