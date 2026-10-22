import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireValue } from '../../core/src/model.ts';
export interface ClipboardImage { sequence: string; bytes: Buffer }
export interface ClipboardPort {
  readonly session: string;
  sequence(): Promise<string>;
  readImage(): Promise<ClipboardImage | undefined>;
  writeText(text: string, expected?: string, timeoutMs?: number): Promise<boolean>;
  writeFiles?(paths: string[], expected?: string, timeoutMs?: number): Promise<boolean>;
  notify?(): Promise<void>;
  close(): void;
}
/** Persistent hidden native helper. Requests are serialized; no foreground/window activation APIs. */
export class WindowsClipboard implements ClipboardPort {
  readonly session = randomUUID();
  private child;
  private queue: Promise<unknown> = Promise.resolve();
  private receive?: (line: string) => void;
  private chunks: Buffer[] = []; private buffered = 0; private dead = false;
  constructor() {
    requireValue(process.platform === 'win32', 'WINDOWS_INTERACTIVE_SESSION_REQUIRED');
    // Files extracted from a downloaded portable ZIP carry Mark-of-the-Web.
    // RemoteSigned otherwise prevents this fixed, app-bundled helper from starting.
    // The process-scoped setting does not change the user's or machine's policy.
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./clipboard.ps1', import.meta.url))],
      { shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.on('data', (chunk: Buffer) => {
      this.buffered += chunk.length;
      if (this.buffered > 85 * 1024 * 1024) { this.close(); return; }
      this.chunks.push(chunk);
      if (chunk.includes(10)) {
        const line = Buffer.concat(this.chunks).toString('utf8').trim();
        this.chunks = []; this.buffered = 0; this.receive?.(line);
      }
    });
    this.child.stderr.resume(); this.child.stdin.on('error', () => this.close());
    this.child.on('error', () => this.close()); this.child.on('close', () => this.close());
  }
  private request(request: object, timeoutMs = 15000): Promise<Record<string, unknown>> {
    const deadline = performance.now() + timeoutMs;
    let queuedTimer: ReturnType<typeof setTimeout> | undefined;
    let expiredInQueue = false;
    const operation = this.queue.then(() => new Promise<Record<string, unknown>>((resolve, reject) => {
      clearTimeout(queuedTimer);
      if (expiredInQueue || performance.now() >= deadline) { reject(new Error('CLIPBOARD_DEADLINE_BEFORE_WRITE')); return; }
      if (this.dead) { reject(new Error('CLIPBOARD_HELPER_STOPPED')); return; }
      const timer = setTimeout(() => { this.receive = undefined; this.close(); reject(new Error('CLIPBOARD_HELPER_TIMEOUT')); }, Math.max(1, deadline - performance.now()));
      this.receive = line => {
        clearTimeout(timer); this.receive = undefined;
        try {
          const result = JSON.parse(line);
          if (result?.error) {
            const allowed = ['CLIPBOARD_BUSY', 'CLIPBOARD_WRITE_AMBIGUOUS', 'CLIPBOARD_ALLOC', 'CLIPBOARD_UNAVAILABLE_OR_OVERSIZED', 'CLIPBOARD_HELPER_STOPPED'];
            reject(new Error(allowed.includes(result.error) ? result.error : 'CLIPBOARD_PROTOCOL')); return;
          }
          requireValue(result && typeof result === 'object', 'CLIPBOARD_PROTOCOL'); resolve(result);
        } catch { reject(new Error('CLIPBOARD_PROTOCOL')); }
      };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    }));
    // Expiry while queued is a proven non-write. The queued operation still checks
    // the same deadline before touching the pipe, so it cannot write after rejection.
    const queuedDeadline = new Promise<Record<string, unknown>>((_, reject) => {
      queuedTimer = setTimeout(() => { expiredInQueue = true; reject(new Error('CLIPBOARD_DEADLINE_BEFORE_WRITE')); }, timeoutMs);
    });
    this.queue = operation.catch(() => {});
    return Promise.race([operation, queuedDeadline]).finally(() => clearTimeout(queuedTimer));
  }
  async sequence(): Promise<string> {
    const result = await this.request({ op: 'sequence' }); requireValue(typeof result.sequence === 'string', 'CLIPBOARD_PROTOCOL'); return result.sequence;
  }
  async readImage(): Promise<ClipboardImage | undefined> {
    const result = await this.request({ op: 'read' });
    if (result.data === null) return undefined;
    requireValue(typeof result.data === 'string' && typeof result.sequence === 'string', 'CLIPBOARD_PROTOCOL');
    return { sequence: result.sequence, bytes: Buffer.from(result.data, 'base64') };
  }
  async writeText(text: string, expected?: string, timeoutMs?: number): Promise<boolean> {
    requireValue(expected === undefined || /^\d{1,10}$/.test(expected), 'INVALID_CLIPBOARD_SEQUENCE');
    requireValue(Buffer.byteLength(text) <= 400_000, 'CLIPBOARD_TEXT_LIMIT');
    const result = await this.request({ op: 'write', text, expected: expected ?? null }, timeoutMs);
    requireValue(typeof result.written === 'boolean', 'CLIPBOARD_PROTOCOL');
    return result.written;
  }
  async writeFiles(paths: string[], expected?: string, timeoutMs?: number): Promise<boolean> {
    requireValue(expected === undefined || /^\d{1,10}$/.test(expected), 'INVALID_CLIPBOARD_SEQUENCE');
    requireValue(paths.length > 0 && paths.length <= 5 && paths.every(path => isAbsolute(path) && !path.includes('\0') && path.length <= 2048 && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()), 'INVALID_CLIPBOARD_FILES');
    const result = await this.request({ op: 'files', paths, expected: expected ?? null }, timeoutMs);
    requireValue(typeof result.written === 'boolean', 'CLIPBOARD_PROTOCOL'); return result.written;
  }
  async notify(): Promise<void> {
    const result = await this.request({ op: 'notify' }, 3000);
    requireValue(result.notified === true, 'NATIVE_NOTIFICATION_UNAVAILABLE');
  }
  close(): void {
    if (this.dead) return; this.dead = true; this.child.kill(); this.receive?.('{"error":"CLIPBOARD_HELPER_STOPPED"}');
  }
}
