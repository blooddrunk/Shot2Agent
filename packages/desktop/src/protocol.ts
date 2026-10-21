import type { Readable, Writable } from 'node:stream';
import { safeError } from './controller.ts';
import type { DesktopController } from './controller.ts';
/** Inherited anonymous pipes only. Production and process-backed tests share this transport. */
export function serve(desktop: DesktopController, input: Readable, output: Writable, pollMs = 600) {
  let buffer = ''; let pending = Promise.resolve(); let ending = false; let tick = false;
  const timer = setInterval(() => {
    if (ending || tick) return; tick = true;
    pending = pending.then(() => desktop.tick()).catch(() => {}).finally(() => { tick = false; });
  }, pollMs);
  const finish = async () => { if (ending) return; ending = true; clearInterval(timer); await pending; await desktop.close(); };
  input.setEncoding('utf8');
  input.on('data', (data: string) => {
    buffer += data;
    if (Buffer.byteLength(buffer) > 65536) { input.pause(); void finish(); return; }
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      pending = pending.then(async () => {
        if (ending) return;
        try {
          const request = JSON.parse(line);
          const value = await desktop.dispatch(request);
          output.write(JSON.stringify({ ok: true, value }) + '\n');
          if (request.command === 'quit') { ending = true; clearInterval(timer); input.destroy(); }
        } catch (error) { output.write(JSON.stringify({ ok: false, error: safeError(error) }) + '\n'); }
      });
    }
  });
  input.on('end', () => { void finish(); });
  input.resume();
  return finish;
}

/** A parent may coalesce its startup gate and first JSON request into one pipe chunk. */
export function waitForParent(input: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    let gate = '';
    const timeout = setTimeout(() => { input.off('data', receive); reject(new Error('PARENT_HANDSHAKE_TIMEOUT')); }, 10000);
    const receive = (chunk: Buffer | string) => {
      gate += chunk.toString();
      const newline = gate.indexOf('\n');
      if (newline < 0 && gate.length <= 16) return;
      clearTimeout(timeout); input.off('data', receive); input.pause();
      if (newline < 0 || gate.slice(0, newline + 1) !== 'SHOT2AGENT/1\n') { reject(new Error('PARENT_HANDSHAKE_INVALID')); return; }
      const remainder = gate.slice(newline + 1);
      if (remainder) input.unshift(Buffer.from(remainder));
      resolve();
    };
    input.on('data', receive);
  });
}
