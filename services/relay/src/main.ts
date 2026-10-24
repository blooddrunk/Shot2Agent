import { resolve } from 'node:path';
import { lstatSync, readFileSync } from 'node:fs';
import { openCore } from '../../../packages/core/src/core.ts';
import { requireValue } from '../../../packages/core/src/model.ts';
import { createRelay, validateDevices } from './server.ts';
import type { Device } from './server.ts';
function registry(): Device[] {
  const path = process.env.SHOT2AGENT_DEVICE_FILE;
  let text: string;
  if (path) {
    const st = lstatSync(path);
    requireValue(st.isFile() && !st.isSymbolicLink() && st.size <= 65536 && (process.platform === 'win32' || (st.mode & 0o077) === 0), 'UNSAFE_DEVICE_REGISTRY');
    text = readFileSync(path, 'utf8');
  } else text = process.env.SHOT2AGENT_DEVICES ?? 'null';
  const devices = JSON.parse(text); validateDevices(devices); return devices;
}
const host = process.env.SHOT2AGENT_HOST ?? '127.0.0.1';
requireValue(host === '127.0.0.1' || (host === '0.0.0.0' && !!process.env.SHOT2AGENT_DEVICE_FILE), 'PRIVATE_REGISTRY_REQUIRED');
const core = openCore(resolve(process.env.SHOT2AGENT_RELAY_ROOT ?? '.local/relay'), 'remote');
try {
  const server = await createRelay(core, registry(), registry);
  server.addHook('onClose', async () => core.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close(); });
  await server.listen({ host, port: Number(process.env.SHOT2AGENT_PORT ?? 3100) });
  process.stdout.write('Shot2Agent Relay ready\n');
} catch { core.close(); process.stderr.write('RELAY_START_FAILED\n'); process.exitCode = 1; }
