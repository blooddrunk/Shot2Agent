import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskView } from '../../core/src/model.ts';
import { requireValue } from '../../core/src/model.ts';
import { privateDirectory } from '../../core/src/store.ts';
import type { ClipboardPort } from './clipboard.ts';
import type { LocalState } from './state.ts';
export interface DeliveryConfig { clipboard: 'off' | 'manual' | 'smart' | 'always'; saveDirectory?: string }
export function atomicSave(directory: string, id: string, text: string): void {
  requireValue(isAbsolute(directory) && /^[0-9a-f-]{36}$/.test(id), 'UNSAFE_SAVE_PATH');
  privateDirectory(directory);
  requireValue(realpathSync(directory) === directory, 'UNSAFE_SAVE_PATH');
  const target = join(directory, `${id}.md`); const expected = Buffer.from(text);
  try {
    const stat = lstatSync(target);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.length && readFileSync(target).equals(expected), 'SAVE_CONFLICT');
    return;
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  const temp = join(directory, `.${id}-${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, expected); fsyncSync(fd); } finally { closeSync(fd); }
    // The output root is operator-owned; concurrent retries write identical immutable bytes.
    renameSync(temp, target);
    if (process.platform !== 'win32') { const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
  } finally { rmSync(temp, { force: true }); }
}
export async function deliver(task: TaskView, config: DeliveryConfig, state: LocalState, clipboard?: ClipboardPort, retry = false): Promise<void> {
  if (task.status !== 'succeeded' || !task.result) return;
  const id = task.submission.taskId; const text = task.result.contentMarkdown;
  await Promise.all(['save', 'clipboard'].map(async channel => {
    const reservation = state.reserve(id, channel, retry); if (!reservation) return;
    try {
      if (channel === 'save') {
        if (!config.saveDirectory) { state.put(id, channel, { ...reservation, status: 'disabled' }); return; }
        atomicSave(config.saveDirectory, id, text);
      } else {
        if (config.clipboard === 'off' || config.clipboard === 'manual') {
          state.put(id, channel, { ...reservation, status: config.clipboard === 'off' ? 'disabled' : 'manual' }); return;
        }
        const baseline = state.baseline(id);
        if (config.clipboard === 'smart' && (!baseline || baseline.session !== clipboard?.session)) {
          state.put(id, channel, { ...reservation, status: 'blocked_by_clipboard_change' }); return;
        }
        requireValue(clipboard, 'CLIPBOARD_UNAVAILABLE');
        const success = await clipboard.writeText(text, config.clipboard === 'smart' ? baseline?.sequence : undefined);
        if (!success) { state.put(id, channel, { ...reservation, status: 'blocked_by_clipboard_change' }); return; }
      }
      state.put(id, channel, { ...reservation, status: 'succeeded' });
    } catch { state.put(id, channel, { ...reservation, status: 'failed', code: channel === 'save' ? 'SAVE_FAILED' : 'CLIPBOARD_FAILED' }); }
  }));
}
