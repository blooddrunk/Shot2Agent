import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopController } from '../src/controller.ts';

const clipboard = () => ({ session: 'synthetic', async sequence() { return '1'; }, async readImage() {}, async writeText() { throw new Error('NO_WRITES'); }, close() {} });
const unavailable = async provider => [{ provider, path: '', status: 'invalid' }];

test('fresh setup with invalid CLI discovery can save hotkeys independently and retain them after restart', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-hotkeys-first-run-')));
  let desktop = new DesktopController(root, clipboard(), undefined, 'codex', unavailable);
  t.after(async () => { await desktop.close(); rmSync(root, { recursive: true, force: true }); });
  await desktop.dispatch({ v: 1, command: 'discover-agents' });
  const hotkeys = { 'toggle-pause': 'Ctrl+Alt+P' };
  const saved = await desktop.dispatch({ v: 1, command: 'configure-hotkeys', hotkeys });
  assert.equal(saved.setupRequired, true);
  assert.deepEqual(saved.hotkeys, hotkeys);
  assert.equal(saved.discovery.every(c => c.status === 'invalid'), true);
  assert.equal(saved.total, 0);
  await desktop.close();
  desktop = new DesktopController(root, clipboard(), undefined, 'codex', unavailable);
  const restored = await desktop.dispatch({ v: 1, command: 'snapshot' });
  assert.deepEqual(restored.hotkeys, hotkeys);
  assert.equal(restored.setupRequired, true);
  assert.equal(restored.total, 0);
});

test('hotkey validation and settings write failures retain the prior saved bindings', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'shot-hotkeys-write-')));
  let desktop = new DesktopController(root, clipboard(), undefined, 'codex', unavailable);
  t.after(async () => { await desktop.close(); rmSync(root, { recursive: true, force: true }); });
  const old = { current: 'Ctrl+Alt+P' };
  await desktop.dispatch({ v: 1, command: 'configure-hotkeys', hotkeys: old });
  await assert.rejects(desktop.dispatch({ v: 1, command: 'configure-hotkeys', hotkeys: { current: 'Win+L' } }), /INVALID_HOTKEY/);
  await assert.rejects(desktop.dispatch({ v: 1, command: 'configure-hotkeys', hotkeys: { current: 'Ctrl+Alt+P', 'copy-latest': 'Ctrl+Alt+P' } }), /DUPLICATE_HOTKEY/);
  const path = join(root, 'settings.json');
  const previous = readFileSync(path);
  rmSync(path); mkdirSync(path); // Synthetic unwritable target, independent of OS user privileges.
  await assert.rejects(desktop.dispatch({ v: 1, command: 'configure-hotkeys', hotkeys: { current: 'Ctrl+Alt+Q' } }), /HOTKEY_SETTINGS_SAVE_FAILED/);
  assert.deepEqual(desktop.settings.hotkeys, old);
  rmSync(path, { recursive: true }); writeFileSync(path, previous);
  await desktop.close();
  desktop = new DesktopController(root, clipboard(), undefined, 'codex', unavailable);
  assert.deepEqual(desktop.settings.hotkeys, old);
});
