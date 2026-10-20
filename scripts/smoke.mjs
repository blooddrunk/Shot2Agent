import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import sharp from 'sharp';
const dir = mkdtempSync(join(tmpdir(), 'shot2agent-built-'));
const entry = fileURLToPath(new URL('../dist/apps/cli/src/mvp.js', import.meta.url));
const deny = join(dir, 'deny.mjs');
writeFileSync(deny, `import net from 'node:net'; import http from 'node:http'; globalThis.fetch=()=>{throw Error('NETWORK_DENIED')}; net.Socket.prototype.connect=()=>{throw Error('NETWORK_DENIED')}; net.Server.prototype.listen=()=>{throw Error('LISTEN_DENIED')}; http.request=()=>{throw Error('NETWORK_DENIED')};`);
function run(args) {
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(deny).href, entry, ...args, '--root', join(dir, 'state')], { cwd: dir, encoding: 'utf8', env: { ...process.env, SHOT2AGENT_RELAY_URL: 'http://unusable.invalid' }, timeout: 15_000 });
  assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
}
try {
  const image = join(dir, 'synthetic.png');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: 'white' } }).png().toFile(image);
  run(['init', '--adapter', 'fake', '--clipboard', 'off', '--save', join(dir, 'out')]);
  const id = JSON.parse(run(['file', image])).taskId;
  assert.ok(id); assert.match(run(['list']), /queued/); run(['work']);
  assert.match(run(['list']), /succeeded/); assert.match(run(['show', id]), /Fake result/);
  assert.ok(existsSync(join(dir, 'out', `${id}.md`)));
  assert.ok(existsSync(fileURLToPath(new URL('../dist/packages/local/src/clipboard.ps1', import.meta.url))));
  process.stdout.write('PASS compiled fresh-cwd Fake Local smoke: queue, history, atomic Markdown, no network/listener/Relay, helper packaged\n');
} finally { rmSync(dir, { recursive: true, force: true }); }
