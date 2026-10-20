import { resolve } from 'node:path';
import { openCore } from '../../../packages/core/src/core.ts';
import { createRelay } from './server.ts';
// Configuration is operator-provided; tokens are never generated into logs or arguments.
const devices = JSON.parse(process.env.SHOT2AGENT_DEVICES ?? 'null');
if (!Array.isArray(devices)) throw new Error('SHOT2AGENT_DEVICES must contain the private device registry');
const core = openCore(resolve(process.env.SHOT2AGENT_RELAY_ROOT ?? '.local/relay'), 'remote');
try {
  const server = await createRelay(core, devices);
  server.addHook('onClose', async () => core.close());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close(); });
  const address = await server.listen({ host: '127.0.0.1', port: Number(process.env.SHOT2AGENT_PORT ?? 3100) });
  process.stdout.write(`M1 test Relay: ${address}\n`);
} catch (error) { core.close(); throw error; }
