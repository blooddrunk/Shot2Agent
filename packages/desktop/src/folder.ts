import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { sha256 } from '../../core/src/blobs.ts';
import { requireValue } from '../../core/src/model.ts';
import { readImageFile } from '../../local/src/app.ts';
/** Nonrecursive reconciliation: at most 1024 entries, 600ms host cadence, >=1200ms stable bytes. */
export function validateCaptureFolder(directory: string, excluded: string[]): void {
  requireValue(isAbsolute(directory) && !directory.startsWith('\\\\') && !directory.startsWith('//'), 'INVALID_CAPTURE_FOLDER');
  requireValue(realpathSync(directory) === directory && lstatSync(directory).isDirectory(), 'UNSAFE_CAPTURE_FOLDER');
  for (const path of excluded) {
    const inside = (parent: string, child: string) => { const r = relative(parent, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)); };
    requireValue(!inside(directory, path) && !inside(path, directory), 'CAPTURE_OUTPUT_OVERLAP');
  }
}
type Observation = { stamp: string; hash?: string; since: number; consumed: boolean; ignored?: boolean };
export class FolderSource {
  private entries = new Map<string, Observation>();
  private directory?: string;
  private newFilesOnly = true;
  error?: string;
  /** Suppress our published PNG before a watcher tick can observe it. */
  suppress(path: string): void {
    if (!this.directory) return;
    const stamp = this.scan().get(path);
    if (stamp) this.entries.set(path, { stamp, since: 0, consumed: true, ignored: true });
  }
  private scan(): Map<string, string> {
    requireValue(realpathSync(this.directory!) === this.directory && !lstatSync(this.directory!).isSymbolicLink(), 'UNSAFE_CAPTURE_FOLDER');
    const names = readdirSync(this.directory!);
    requireValue(names.length <= 1024, 'CAPTURE_FOLDER_TOO_MANY_FILES');
    const found = new Map<string, string>();
    for (const name of names) {
      if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
      const path = join(this.directory!, name);
      try {
        const st = lstatSync(path);
        if (!st.isFile() || st.isSymbolicLink() || st.size > 60 * 1024 * 1024) { this.error = 'FOLDER_IMAGE_UNSAFE_OR_TOO_LARGE'; continue; }
        found.set(path, `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`);
      } catch { this.error = 'FOLDER_IMAGE_UNREADABLE'; }
    }
    return found;
  }
  arm(directory?: string, newFilesOnly = true): void {
    this.directory = directory; this.newFilesOnly = newFilesOnly; this.entries.clear(); this.error = undefined;
    if (directory) for (const [path, stamp] of this.scan()) this.entries.set(path, { stamp, since: 0, consumed: newFilesOnly, ignored: newFilesOnly });
  }
  async poll(accept: (bytes: Buffer) => Promise<void>, now = Date.now()): Promise<void> {
    if (!this.directory) return;
    this.error = undefined;
    try {
      const found = this.scan();
      for (const path of this.entries.keys()) if (!found.has(path)) this.entries.delete(path);
      // Bound expensive reads per tick; next scans continue the remaining candidates.
      let reads = 0;
      for (const [path, stamp] of found) {
        let old = this.entries.get(path);
        // Baseline/accepted files stay ignored even if metadata or bytes change.
        // Seeing deletion removes this entry, allowing a later new file at that path.
        if (old?.ignored) continue;
        if (!old || old.stamp !== stamp) { old = { stamp, since: now, consumed: false }; this.entries.set(path, old); continue; }
        if (old.consumed || now - old.since < 1200 || reads >= 4) continue;
        reads++;
        try {
          const bytes = readImageFile(path); const hash = sha256(bytes);
          if (old.hash !== hash) { old.hash = hash; old.since = now; continue; }
          await accept(bytes); old.consumed = true; old.ignored = this.newFilesOnly;
        } catch { old.consumed = true; this.error = 'FOLDER_IMAGE_INVALID_OR_UNREADABLE'; }
      }
    } catch { this.error = 'CAPTURE_FOLDER_UNAVAILABLE'; }
  }
}
