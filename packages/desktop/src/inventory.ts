import { posix, win32 } from 'node:path';
import type { Candidate } from '../../worker/src/discovery.ts';
function installationPath(candidate: Candidate): string {
  return candidate.program?.args[0] ?? candidate.program?.executable ?? candidate.path;
}
function keyPath(path: string): string {
  return (/^[a-z]:/i.test(path) || path.startsWith('\\\\')) ? win32.normalize(path).toLowerCase() : posix.normalize(path);
}
/** Display inventory only: merging rows never changes approved programs, digests or selection. */
export function displayInventory(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter(c => {
    if (c.status === 'not_found' && candidates.some(other => other.provider === c.provider && other.path)) return false;
    // Keep differing versions/refusal states visible, including scan-incomplete warnings.
    const key = JSON.stringify([c.provider, keyPath(installationPath(c)), c.version, c.status]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).map(c => ({ ...c, path: installationPath(c) }));
}
