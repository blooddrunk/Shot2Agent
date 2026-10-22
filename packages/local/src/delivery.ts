import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, linkSync, rmSync, writeFileSync, realpathSync, readdirSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TaskView } from '../../core/src/model.ts';
import { requireValue } from '../../core/src/model.ts';
import { privateDirectory } from '../../core/src/store.ts';
import type { ClipboardPort } from './clipboard.ts';
import type { LocalState } from './state.ts';
export interface RetryPolicy { maxRetries: number; backoffMs: number; budgetMs: number }
export interface DeliveryConfig { clipboard: 'off' | 'manual' | 'smart' | 'always'; saveDirectory?: string; retry?: RetryPolicy; clipboardPayload?: 'text' | 'files'; notification?: boolean }
/** Shared entry-point policy. Legacy M2 CLI configs have no desktop consent boundary. */
export function effectiveDelivery(settings: { delivery: DeliveryConfig; desktop?: { alwaysConsent?: boolean } }): DeliveryConfig {
  const config = structuredClone(settings.delivery);
  if (Object.hasOwn(settings, 'desktop') && config.clipboard === 'always' && settings.desktop?.alwaysConsent !== true) config.clipboard = 'manual';
  return config;
}
export function validateRetry(policy?: RetryPolicy): void {
  if (policy === undefined) return;
  requireValue(policy && Object.keys(policy).every(k => ['maxRetries', 'backoffMs', 'budgetMs'].includes(k)) &&
    Number.isInteger(policy.maxRetries) && policy.maxRetries >= 0 && policy.maxRetries <= 10 &&
    Number.isInteger(policy.backoffMs) && policy.backoffMs >= 10 && policy.backoffMs <= 1000 &&
    Number.isInteger(policy.budgetMs) && policy.budgetMs >= 100 && policy.budgetMs <= 10000, 'INVALID_DELIVERY_RETRY');
}
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
    // Hard-link publication is atomic and cannot replace an existing destination.
    // Unsupported filesystems fail closed; never fall back to replacing rename.
    try { linkSync(temp, target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const stat = lstatSync(target);
      requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size === expected.length && readFileSync(target).equals(expected), 'SAVE_CONFLICT');
    }
    if (process.platform !== 'win32') { const dir = openSync(directory, 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
  } finally { rmSync(temp, { force: true }); }
}
/** Stable private result cache. Never auto-delete advertised files; fail at a bounded quota. */
export function resultFiles(task: TaskView, state: LocalState): string[] {
  requireValue(task.status === 'succeeded' && task.result, 'RESULT_UNAVAILABLE');
  const directory = join(state.root, 'file-clipboard'); privateDirectory(directory);
  requireValue(realpathSync(directory) === directory, 'UNSAFE_SAVE_PATH');
  const id = task.submission.taskId; const entries = readdirSync(directory);
  if (!entries.includes(`${id}.md`)) {
    requireValue(entries.length < 1000 && entries.reduce((n, name) => n + lstatSync(join(directory, name)).size, 0) + Buffer.byteLength(task.result.contentMarkdown) <= 256 * 1024 * 1024, 'FILE_CLIPBOARD_CACHE_FULL');
  }
  atomicSave(directory, id, task.result.contentMarkdown);
  return [join(directory, `${id}.md`)];
}
export type FailureClass = 'transient' | 'permanent' | 'conflict' | 'ambiguous';
export function deliveryFailure(error: unknown, channel: string): { code: string; classification: FailureClass } {
  const e = error as NodeJS.ErrnoException;
  const code = e?.code ?? (error instanceof Error ? error.message : '');
  if (['SAVE_CONFLICT', 'UNSAFE_SAVE_PATH'].includes(code)) return { code, classification: 'conflict' };
  if (channel === 'notification') return { code: 'NATIVE_NOTIFICATION_UNAVAILABLE', classification: 'permanent' };
  if (channel === 'clipboard') {
    if (code === 'CLIPBOARD_REPLACED_AFTER_WRITE') return { code, classification: 'conflict' };
    if (code === 'CLIPBOARD_BUSY') return { code, classification: 'transient' };
    if (['CLIPBOARD_WRITE_AMBIGUOUS', 'CLIPBOARD_HELPER_TIMEOUT', 'CLIPBOARD_HELPER_STOPPED', 'CLIPBOARD_PROTOCOL'].includes(code))
      return { code, classification: 'ambiguous' };
    return { code: ['CLIPBOARD_TEXT_LIMIT', 'CLIPBOARD_UNAVAILABLE', 'CLIPBOARD_ALLOC', 'CLIPBOARD_DEADLINE_BEFORE_WRITE', 'FILE_CLIPBOARD_CACHE_FULL', 'FILE_CLIPBOARD_UNAVAILABLE'].includes(code) ? code : 'CLIPBOARD_FAILED', classification: 'permanent' };
  }
  if (['EBUSY', 'EAGAIN', 'EMFILE', 'ENFILE'].includes(code)) return { code: `SAVE_${code}`, classification: 'transient' };
  return { code: ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'ENOTSUP'].includes(code) ? `SAVE_${code}` : 'SAVE_FAILED', classification: 'permanent' };
}
export async function deliver(task: TaskView, config: DeliveryConfig, state: LocalState, clipboard?: ClipboardPort, retry = false, save: typeof atomicSave = atomicSave, channels: readonly string[] = ['save', 'clipboard', 'notification']): Promise<void> {
  if (task.status !== 'succeeded' || !task.result) return;
  validateRetry(config.retry);
  // Snapshot settings and ORIGINAL capture baseline for the whole bounded operation.
  const settings = structuredClone(config);
  const policy = settings.retry ?? { maxRetries: 0, backoffMs: 100, budgetMs: 3000 };
  const id = task.submission.taskId; const text = task.result.contentMarkdown;
  const baseline = state.baseline(id);
  await Promise.all(['save', 'clipboard', 'notification'].filter(channel => channels.includes(channel)).map(async channel => {
    const reservation = state.reserve(id, channel, retry); if (!reservation) return;
    const smart = settings.clipboard === 'smart' || reservation.smartGuard === true;
    if (channel === 'clipboard') { reservation.smartGuard = smart; reservation.payload = settings.clipboardPayload ?? 'text'; }
    const started = performance.now();
    for (let attempt = 0; ; attempt++) {
      if (attempt > 0) reservation.attempts++;
      state.put(id, channel, { ...reservation, status: 'pending' });
      try {
        if (channel === 'save') {
          if (!settings.saveDirectory) { state.put(id, channel, { ...reservation, status: 'disabled' }); return; }
          save(settings.saveDirectory, id, text);
        } else if (channel === 'notification') {
          if (!settings.notification) { state.put(id, channel, { ...reservation, status: 'disabled' }); return; }
          requireValue(clipboard?.notify, 'NATIVE_NOTIFICATION_UNAVAILABLE');
          await clipboard.notify();
        } else {
          if (settings.clipboard === 'off' || settings.clipboard === 'manual') {
            state.put(id, channel, { ...reservation, status: settings.clipboard === 'off' ? 'disabled' : 'manual' }); return;
          }
          if (smart && (!baseline || baseline.session !== clipboard?.session)) {
            state.put(id, channel, { ...reservation, status: 'blocked_by_clipboard_change', code: 'CLIPBOARD_SESSION_CHANGED', classification: 'conflict' }); return;
          }
          requireValue(clipboard, 'CLIPBOARD_UNAVAILABLE');
          // Native helper compares under the clipboard lock on EVERY write, including retries.
          const expected = smart ? baseline?.sequence : undefined;
          const timeout = Math.max(1, policy.budgetMs - (performance.now() - started));
          let success: boolean | undefined;
          if (settings.clipboardPayload === 'files') {
            requireValue(clipboard.writeFiles, 'FILE_CLIPBOARD_UNAVAILABLE');
            success = await clipboard.writeFiles(resultFiles(task, state), expected, timeout);
          } else success = await clipboard.writeText(text, expected, timeout);
          if (!success) { state.put(id, channel, { ...reservation, status: 'blocked_by_clipboard_change', code: 'CLIPBOARD_SEQUENCE_CHANGED', classification: 'conflict' }); return; }
        }
        state.put(id, channel, { ...reservation, status: 'succeeded' }); return;
      } catch (error) {
        const failure = deliveryFailure(error, channel);
        const elapsedMs = Math.round(performance.now() - started);
        reservation.history = [...(reservation.history ?? []), { attempt: reservation.attempts, at: Date.now(), elapsedMs, ...failure }].slice(-100);
        const backoff = Math.min(1000, policy.backoffMs * 2 ** attempt);
        const remaining = policy.budgetMs - elapsedMs;
        // The native transport receives the remaining budget and kills its helper on expiry.
        // A write timeout is ambiguous and is never scheduled again.
        const again = failure.classification === 'transient' && attempt < policy.maxRetries && remaining > backoff;
        state.put(id, channel, { ...reservation, status: again ? 'pending' : 'failed', ...failure,
          stopReason: again ? undefined : failure.classification !== 'transient' ? failure.classification : attempt >= policy.maxRetries ? 'retry_limit' : 'time_budget' });
        if (!again) return;
        await new Promise(resolve => setTimeout(resolve, backoff));
        if (performance.now() - started >= policy.budgetMs) {
          state.put(id, channel, { ...reservation, status: 'failed', ...failure, stopReason: 'time_budget' }); return;
        }
      }
    }
  }));
}
