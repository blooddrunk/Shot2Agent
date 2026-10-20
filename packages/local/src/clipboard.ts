import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireValue } from '../../core/src/model.ts';
export interface ClipboardImage { sequence: string; bytes: Buffer }
export interface ClipboardPort {
  readonly session: string;
  sequence(): Promise<string>;
  readImage(): Promise<ClipboardImage | undefined>;
  writeText(text: string, expected?: string): Promise<boolean>;
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
    this.child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Sta', '-WindowStyle', 'Hidden', '-File', fileURLToPath(new URL('./clipboard.ps1', import.meta.url))],
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
  private request(request: object): Promise<Record<string, unknown>> {
    const operation = this.queue.then(() => new Promise<Record<string, unknown>>((resolve, reject) => {
      if (this.dead) { reject(new Error('CLIPBOARD_HELPER_STOPPED')); return; }
      const timer = setTimeout(() => { this.close(); reject(new Error('CLIPBOARD_HELPER_TIMEOUT')); }, 15_000);
      this.receive = line => {
        clearTimeout(timer); this.receive = undefined;
        try {
          const result = JSON.parse(line); requireValue(result && !result.error, 'CLIPBOARD_UNAVAILABLE_OR_OVERSIZED'); resolve(result);
        } catch { reject(new Error('CLIPBOARD_UNAVAILABLE_OR_OVERSIZED')); }
      };
      this.child.stdin.write(JSON.stringify(request) + '\n');
    }));
    this.queue = operation.catch(() => {}); return operation;
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
  async writeText(text: string, expected?: string): Promise<boolean> {
    requireValue(Buffer.byteLength(text) <= 400_000, 'CLIPBOARD_TEXT_LIMIT');
    return (await this.request({ op: 'write', text, expected: expected ?? null })).written === true;
  }
  close(): void {
    if (this.dead) return; this.dead = true; this.child.kill(); this.receive?.('{"error":"closed"}');
  }
}
