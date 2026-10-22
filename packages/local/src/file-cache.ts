import { existsSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { requireValue } from '../../core/src/model.ts';
export const CACHE_MAX_FILES = 1000;
export const CACHE_MAX_BYTES = 256 * 1024 * 1024;
export function fileCacheUsage(root: string) {
  const directory = join(root, 'file-clipboard');
  let files = 0, bytes = 0;
  if (existsSync(directory)) {
    requireValue(realpathSync(directory) === directory && !lstatSync(directory).isSymbolicLink(), 'UNSAFE_FILE_CACHE');
    for (const name of readdirSync(directory)) {
      const st = lstatSync(join(directory, name));
      requireValue(st.isFile() && !st.isSymbolicLink() && (/^[0-9a-f-]{36}\.md$/.test(name) || /^\.[0-9a-f-]{36}-[0-9a-f-]{36}\.tmp$/.test(name)), 'UNSAFE_FILE_CACHE');
      files++; bytes += st.size;
    }
  }
  return { directory, files, bytes, maxFiles: CACHE_MAX_FILES, maxBytes: CACHE_MAX_BYTES };
}
