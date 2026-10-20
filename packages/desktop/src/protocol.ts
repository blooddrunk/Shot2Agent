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
  input.resume();
  input.on('end', () => { void finish(); });
  return finish;
}
