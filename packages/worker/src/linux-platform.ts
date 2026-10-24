import { closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { requireValue } from '../../core/src/model.ts';
import type { ProcessRuntime } from './process.ts';

/** Linux-only, operator-owned binding. Never received from a task or Windows approval. */
export interface LinuxApproval {
  platform: 'linux'; uid: number; credentialFile: string; stateRoot: string;
}
export function privateFile(path: string, max = 65536): Buffer {
  requireValue(process.platform === 'linux' && isAbsolute(path) && realpathSync(path) === path, 'LINUX_PRIVATE_FILE_REQUIRED');
  const s = lstatSync(path);
  requireValue(s.isFile() && !s.isSymbolicLink() && s.uid === process.getuid!() && (s.mode & 0o077) === 0 && s.size > 0 && s.size <= max, 'UNSAFE_LINUX_SECRET');
  return readFileSync(path);
}
export function privateRoot(path: string): void {
  requireValue(process.platform === 'linux' && isAbsolute(path) && resolve(path) === path, 'LINUX_PATH_REQUIRED');
  mkdirSync(path, { recursive: true, mode: 0o700 }); const s = lstatSync(path);
  requireValue(realpathSync(path) === path && s.isDirectory() && s.uid === process.getuid!() && (s.mode & 0o077) === 0, 'UNSAFE_LINUX_ROOT');
}
export function assertLinuxApproval(a: LinuxApproval): void {
  requireValue(a && a.platform === 'linux' && process.platform === 'linux' && process.getuid!() !== 0 && a.uid === process.getuid!(), 'LINUX_APPROVAL_IDENTITY');
  privateRoot(a.stateRoot); privateFile(a.credentialFile);
}
export function atomicPrivate(path: string, value: unknown): void {
  const temp = `${path}.${randomUUID()}.partial`; const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temp, path); const dir = openSync(join(path, '..'), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); }
}
export interface LinuxProcess { pid: number; group: number; start: string; state: string }
export function linuxProcesses(): LinuxProcess[] {
  requireValue(process.platform === 'linux', 'LINUX_REQUIRED');
  const found: LinuxProcess[] = [];
  for (const pid of readdirSync('/proc').filter(p => /^\d+$/.test(p))) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      found.push({ pid: Number(pid), group: Number(fields[2]), start: fields[19], state: fields[0] });
    } catch (e) { requireValue(['ENOENT', 'ESRCH'].includes((e as NodeJS.ErrnoException).code ?? ''), 'PROCESS_SCAN_UNAVAILABLE'); }
  }
  return found;
}
export function liveGroup(group: number): boolean { return linuxProcesses().some(p => p.group === group && !['Z', 'X'].includes(p.state)); }
export async function stopLinuxGroup(group: number): Promise<void> {
  requireValue(Number.isSafeInteger(group) && group > 1 && group !== process.pid, 'INVALID_PROCESS_GROUP');
  const kill = (signal: NodeJS.Signals) => { try { process.kill(-group, signal); } catch (e) { requireValue((e as NodeJS.ErrnoException).code === 'ESRCH', 'PROCESS_STOP_FAILED'); } };
  if (!liveGroup(group)) return;
  kill('SIGTERM'); await delay(150); if (liveGroup(group)) kill('SIGKILL');
  for (let i = 0; i < 100 && liveGroup(group); i++) await delay(20);
  requireValue(!liveGroup(group), 'AGENT_STOP_UNCONFIRMED');
}
/** Before stdin is sent, fsync the process-group identity; restart kills survivors first. */
export class LinuxProcessOwner {
  private file: string;
  constructor(root: string) { privateRoot(root); this.file = join(root, 'process.json'); }
  spawned(pid: number): void {
    const p = linuxProcesses().find(p => p.pid === pid);
    requireValue(p && p.group === pid, 'PROCESS_IDENTITY_UNAVAILABLE'); atomicPrivate(this.file, { boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(), ...p });
  }
  closed(): void { atomicPrivate(this.file, null); }
  async recover(): Promise<void> {
    let record;
    try { record = JSON.parse(privateFile(this.file).toString()); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
    if (record) {
      requireValue(Number.isSafeInteger(record.pid) && record.pid > 1 && record.group === record.pid && typeof record.start === 'string' && typeof record.boot === 'string', 'PROCESS_JOURNAL_CORRUPT');
      if (record.boot === readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()) {
        const leader = linuxProcesses().find(p => p.pid === record.pid);
        requireValue(!leader || leader.start === record.start, 'PROCESS_IDENTITY_CHANGED');
        await stopLinuxGroup(record.group);
      }
    }
    this.closed();
  }
}
export function linuxRuntime(a: LinuxApproval, provider: 'codex' | 'claude', gateway = false): { runtime: ProcessRuntime; close(): void } {
  assertLinuxApproval(a);
  const secret = privateFile(a.credentialFile); if (!gateway) JSON.parse(secret.toString('utf8'));
  const home = mkdtempSync(join(tmpdir(), 'shot2agent-linux-auth-'));
  const owner = new LinuxProcessOwner(a.stateRoot);
  const auth = join(home, provider === 'codex' ? '.codex' : '.claude'); mkdirSync(auth, { mode: 0o700 });
  if (!gateway) writeFileSync(join(auth, provider === 'codex' ? 'auth.json' : '.credentials.json'), secret, { mode: 0o600, flag: 'wx' });
  return { runtime: { env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: home, USER: String(a.uid), TMPDIR: tmpdir(), CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' }, spawned: pid => owner.spawned(pid), closed: () => owner.closed() },
  close: () => rmSync(home, { recursive: true, force: true }) };
}
