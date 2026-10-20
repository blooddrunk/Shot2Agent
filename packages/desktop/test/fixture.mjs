// Test-only process host. Production has no event injection or arbitrary filesystem IPC command.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { DesktopController } from '../src/controller.ts';
import { serve } from '../src/protocol.ts';
import { FakeAgent, FAKE_PROFILE } from '../../worker/src/fake.ts';
import { setTimeout as delay } from 'node:timers/promises';
for (const mod of [net, http, https]) {
  if ('connect' in mod) mod.connect = () => { throw Error('NETWORK_DENIED'); };
  if ('request' in mod) mod.request = () => { throw Error('NETWORK_DENIED'); };
  if ('createServer' in mod) mod.createServer = () => { throw Error('LISTENER_DENIED'); };
}
globalThis.fetch = () => { throw Error('NETWORK_DENIED'); };
const [root, fixture] = process.argv.slice(2); let written;
const state = () => JSON.parse(readFileSync(fixture, 'utf8'));
const clipboard = { session: String(process.pid),
  async sequence() { return state().sequence; },
  async readImage() { const s = state(); if (s.error) throw Error('CLIPBOARD_HELPER_STOPPED'); return s.image ? { sequence: s.sequence, bytes: Buffer.from(s.image, 'base64') } : undefined; },
  async writeText(text, expected) { if (expected && expected !== state().sequence) return false; written = text; return true; }, close() {} };
const fake = new FakeAgent();
const mode = process.argv[4];
const injected = mode ? { profile: { ...FAKE_PROFILE, timeoutMs: 5000 }, adapter: { name: 'fake', version: 'test', async execute(...args) {
  if (mode === 'fail') return new FakeAgent('fail').execute(...args);
  if (mode === 'unknown') throw Error('synthetic crash');
  while (!state().release && !args[3].aborted) await delay(15);
  if (args[3].aborted) throw Error('synthetic stop');
  return fake.execute(...args);
} } } : undefined;
const desktop = new DesktopController(root, clipboard, injected);
await desktop.start();
// Return writes only in the test's snapshot extension, never in production API.
const original = desktop.dispatch.bind(desktop);
desktop.dispatch = async r => { const value = await original(r); if (r.command === 'snapshot') value.testWrite = written; return value; };
serve(desktop, process.stdin, process.stdout, 20);
