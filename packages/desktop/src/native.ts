import { closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { requireValue } from '../../core/src/model.ts';
import type { NativeOptions } from './native-options.ts';
export { nativeDefaults } from './native-options.ts';
export type { NativeOptions } from './native-options.ts';
export function validateNative(value: unknown): asserts value is NativeOptions {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_NATIVE_SETTINGS');
  const v = value as NativeOptions;
  requireValue(Object.keys(v).sort().join(',') === 'charsPerSecond,clipboard,delayMs,directory,monitor,save,submit' &&
    typeof v.monitor === 'string' && v.monitor.length <= 128 && typeof v.directory === 'string' && v.directory.length <= 2048 &&
    (!v.directory || (isAbsolute(v.directory) && !v.directory.startsWith('\\\\') && !v.directory.startsWith('//'))) &&
    [v.save, v.submit, v.clipboard].every(b => typeof b === 'boolean') &&
    Number.isInteger(v.delayMs) && v.delayMs >= 500 && v.delayMs <= 10000 &&
    Number.isInteger(v.charsPerSecond) && v.charsPerSecond >= 1 && v.charsPerSecond <= 200, 'INVALID_NATIVE_SETTINGS');
}
/** Publish complete bytes once, never replace a user file. Temporary files are not watched. */
export function publishCapture(directory: string, bytes: Buffer, published: (path: string) => void): string {
  requireValue(isAbsolute(directory) && !directory.startsWith('\\\\') && !directory.startsWith('//'), 'CAPTURE_DIRECTORY_REQUIRED');
  let temp: string | undefined;
  try {
    mkdirSync(directory, { recursive: true });
    requireValue(realpathSync(directory) === directory && !lstatSync(directory).isSymbolicLink(), 'UNSAFE_CAPTURE_DIRECTORY');
    const path = join(directory, `Shot2Agent-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.png`);
    temp = path + '.partial';
    const fd = openSync(temp, 'wx', 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    linkSync(temp, path);
    published(path);
    return path;
  } catch (error) {
    if (error instanceof Error && error.message === 'UNSAFE_CAPTURE_DIRECTORY') throw error;
    throw new Error('CAPTURE_STORAGE_FAILED', { cause: error });
  } finally { if (temp) { try { unlinkSync(temp); } catch { /* Preserve the published file. */ } } }
}
