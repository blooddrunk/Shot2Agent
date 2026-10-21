// Explicit opt-in native Windows verification. No clipboard reads/writes or operator task replay.
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
if (process.platform !== 'win32' || process.argv[2] !== '--allow-model-cost' || !process.argv[3]) {
  throw new Error('Usage: Windows node desktop-codex-verify.mjs --allow-model-cost <portable-directory>');
}
const runtime = join(resolve(process.argv[3]), 'runtime');
const { DesktopController } = await import(pathToFileURL(join(runtime, 'dist/packages/desktop/src/controller.js')).href);
const sharp = createRequire(join(runtime, 'package.json'))('sharp');
const root = mkdtempSync(join(tmpdir(), 'shot2agent-real-codex-verify-'));
let desktop;
try {
  const approved = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, 'Shot2Agent-Codex/settings.json'), 'utf8'));
  if (approved.adapter !== 'codex' || !approved.codex) throw new Error('CODEX_PROFILE_REQUIRED');
  const settings = { ...approved, delivery: { clipboard: 'off' }, desktop: { version: 1, enabled: false,
    mode: 'confirm', paused: false, autoConsent: false, alwaysConsent: false } };
  writeFileSync(join(root, 'settings.json'), JSON.stringify(settings), { flag: 'wx' });
  // The real adapter/Profile is production code; only capture/delivery is isolated from the user's desktop.
  const clipboard = { session: 'synthetic-native-verification', async sequence() { return '1'; },
    async readImage() { throw new Error('CLIPBOARD_ACCESS_REFUSED'); },
    async writeText() { throw new Error('CLIPBOARD_ACCESS_REFUSED'); }, close() {} };
  desktop = new DesktopController(root, clipboard, undefined, 'codex');
  await desktop.start();
  const image = await sharp(Buffer.from('<svg width="600" height="140"><rect width="600" height="140" fill="white"/><text x="20" y="80" font-size="40" fill="black">SHOT2AGENT 42</text></svg>')).png().toBuffer();
  const id = await desktop.app.submit(image);
  if (!id) throw new Error('SYNTHETIC_SUBMISSION_FAILED');
  await desktop.app.work();
  const task = desktop.app.get(id);
  const markerObserved = /SHOT2AGENT/i.test(task.result?.contentMarkdown ?? '') && /42/.test(task.result?.contentMarkdown ?? '');
  const receipt = { adapter: desktop.app.adapter.name, sandbox: desktop.app.profile.sandbox,
    cliVersion: approved.codex.cliVersion, status: task.status, error: task.result?.errorCode,
    attempts: task.attempts.length, syntheticMarkerObserved: markerObserved,
    operatorHistoryTouched: false, operatorClipboardTouched: false };
  process.stdout.write(JSON.stringify(receipt) + '\n');
  if (task.status !== 'succeeded' || !markerObserved || task.attempts.length !== 1) process.exitCode = 1;
} finally {
  await desktop?.close(); rmSync(root, { recursive: true, force: true });
}
