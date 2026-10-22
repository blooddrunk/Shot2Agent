import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { serve, waitForParent } from './protocol.ts';
import { DesktopController, safeError } from './controller.ts';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
import { WindowsClipboard } from '../../local/src/clipboard.ts';
const root = resolve(process.argv[2] ?? join(process.env.LOCALAPPDATA ?? homedir(), 'Shot2Agent'));
// Rust assigns the child to a kill-on-close Windows Job before releasing this gate.
// No helper/Agent can be launched before containment is active.
process.stderr.write('PHASE_PARENT_GATE\n');
await waitForParent(process.stdin);
process.stderr.write('PHASE_COORDINATOR_INIT\n');
let desktop: DesktopController | undefined;
let clipboard: WindowsClipboard | undefined;
try {
  const fake = new FakeAgent();
  const mode = process.argv[3];
  if (!['--codex', '--legacy', '--staging'].includes(mode)) throw new Error('INVALID_LAUNCH_MODE');
  const staging = mode === '--staging';
  clipboard = new WindowsClipboard();
  desktop = new DesktopController(root, clipboard, staging ? {
    profile: { ...FAKE_PROFILE, timeoutMs: 30_000 },
    adapter: { name: 'fake', version: 'm3-staging', async execute(task, profile, images, signal) {
      await delay(8000, undefined, { signal }).catch(() => {});
      if (signal.aborted) return { status: 'execution_unknown', summary: 'Staging execution interrupted', contentMarkdown: '', artifacts: [], errorCode: 'STAGING_STOPPED' };
      return fake.execute(task, profile, images, signal);
    } },
  } : undefined, staging ? 'staging' : mode === '--codex' ? 'codex' : 'legacy');
  process.stderr.write('PHASE_CLIPBOARD_START\n');
  await desktop.start();
  if (staging) await desktop.app.ingest(readFileSync(new URL('../../../scripts/fixtures/glm-vision.png', import.meta.url)), false, undefined, 'synthetic');
  process.stderr.write('PHASE_SERVING\n');
  const finish = serve(desktop, process.stdin, process.stdout);
  process.on('SIGTERM', () => { void finish(); }); process.on('SIGINT', () => { void finish(); });
} catch (error) {
  if (desktop) await desktop.close(); else clipboard?.close();
  process.stderr.write(safeError(error) + '\n'); process.stdin.destroy(); process.exitCode = 1;
}
