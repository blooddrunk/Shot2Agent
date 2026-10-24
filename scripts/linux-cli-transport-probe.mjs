// Actual installed Linux Claude CLI against a loopback mock; no account/model traffic.
import assert from 'node:assert/strict';
import console from 'node:console';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boundedProcess } from './dist/packages/worker/src/process.js';
import { CLAUDE_ARGS, parseClaudeOutput } from './dist/packages/worker/src/claude.js';
assert.equal(process.platform, 'linux');
const root = mkdtempSync(join(tmpdir(), 'shot2agent-native-transport-'));
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const model = 'glm-5.3-flash'; let calls = 0; let imageSeen = false; const routes = [];
const mode = process.argv[3] ?? 'success'; assert.ok(['success', 'refusal'].includes(mode));
const server = createServer(async (req, res) => {
  routes.push(req.url?.split('?')[0]); let body = '';
  for await (const bytes of req) { body += bytes; if (body.length > 1024 * 1024) { res.writeHead(413); res.end(); return; } }
  if (req.url?.split('?')[0].endsWith('/messages')) {
    calls++; const value = JSON.parse(body);
    imageSeen ||= value.messages?.some(m => m.content?.some(c => c.type === 'image' && c.source?.data === png));
    if (mode === 'refusal') { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'Synthetic refused request' } })); return; }
    if (value.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [event, data] of [
        ['message_start', { type: 'message_start', message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'SHOT2AGENT 42' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 8 } }],
        ['message_stop', { type: 'message_stop' }],
      ]) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      res.end();
    } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'msg_mock', type: 'message', role: 'assistant', model, content: [{ type: 'text', text: 'SHOT2AGENT 42' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 8 } })); }
  } else { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: root, USERPROFILE: root, CLAUDE_CONFIG_DIR: join(root, '.claude'),
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}/api/anthropic`, ANTHROPIC_AUTH_TOKEN: 'synthetic-not-a-credential', ANTHROPIC_MODEL: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model, ANTHROPIC_DEFAULT_SONNET_MODEL: model, ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1', CLAUDE_CODE_MAX_RETRIES: '0', CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES: '0' };
  const input = JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Read this synthetic image; no tools.' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }] }, parent_tool_use_id: null }) + '\n';
  const result = await boundedProcess({ executable: process.argv[2] ?? '/usr/local/bin/claude', args: [] }, [...CLAUDE_ARGS, '--model', model, '--setting-sources', ''], {
    cwd: root, runtime: { env, spawned() {}, closed() {} }, input, timeoutMs: 30000, maxBytes: 1024 * 1024,
  }); await result.settled;
  let marker = false; try { marker = parseClaudeOutput(result.output).includes('SHOT2AGENT 42'); } catch { /* failure is reported by the receipt */ }
  const accepted = mode === 'success' ? result.code === 0 && marker : result.code !== 0 && !marker && !result.stopped;
  console.log(JSON.stringify({ mode, status: accepted && calls === 1 && imageSeen ? 'PASS' : 'FAIL', code: result.code, stopped: result.stopped, calls, imageSeen, marker, routes, stdoutPresent: !!result.output }));
  assert.equal(accepted, true); assert.equal(imageSeen, true); assert.equal(calls, 1);
} finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(root, { recursive: true, force: true }); }
