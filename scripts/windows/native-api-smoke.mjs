// Never runs on the operator desktop. No model, history or personal clipboard read.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { WindowsClipboard } from '../../dist/packages/local/src/clipboard.js';
if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true') throw Error('HOSTED_WINDOWS_DESKTOP_REQUIRED');
const clipboard = new WindowsClipboard();
try {
  assert.equal(await clipboard.writeText('M11 synthetic clipboard sentinel 中文 🧪'), true);
  // All three fresh-process rounds must pass; this is a teardown stress gate,
  // never a retry that hides a failed native run.
  for (let round = 1; round <= 3; round++) {
    process.stdout.write(`Native lifetime stress round ${round}/3\n`);
    const result = spawnSync('cargo', ['test', '--release', '--features', 'tauri/custom-protocol', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', 'native_api_tests::hosted_window_capture_and_unicode', '--', '--ignored', '--exact', '--nocapture'], { stdio: 'inherit', windowsHide: true, timeout: 180000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, 'real WGC PNG, Unicode target readback and clipboard preservation must pass');
  }
} finally { clipboard.close(); }
