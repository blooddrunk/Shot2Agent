import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, chmodSync, chownSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
const [directory, action, ...ids] = process.argv.slice(2);
if (!directory || !['init', 'add', 'add-worker', 'rotate', 'revoke'].includes(action) || !ids.length || ids.some(id => !/^[a-zA-Z0-9_-]{1,64}$/.test(id)) || new Set(ids).size !== ids.length) throw Error('Usage: relay-devices.mjs DIRECTORY init|add|add-worker|rotate|revoke DEVICE...');
const root = resolve(directory); mkdirSync(root, { recursive: true, mode: 0o700 });
if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) throw Error('UNSAFE_DEVICE_DIRECTORY');
const path = join(root, 'devices.json');
if (action === 'init' && existsSync(path)) throw Error('REGISTRY_ALREADY_EXISTS');
const registry = action === 'init' ? [] : JSON.parse(readFileSync(path, 'utf8'));
if (!Array.isArray(registry) || ids.some(id => ['init', 'add', 'add-worker'].includes(action) ? registry.some(d => d.deviceId === id) : !registry.some(d => d.deviceId === id))) throw Error('DEVICE_STATE_CONFLICT');
if (action === 'revoke' && registry.length <= ids.length) throw Error('KEEP_AT_LEAST_ONE_DEVICE');
function protect(path) { if (process.platform !== 'win32') { chmodSync(path, path === root ? 0o700 : 0o600); if (process.getuid() === 0) chownSync(path, 1000, 1000); } }
function atomic(path, text) { const temp = join(root, `.${randomUUID()}.tmp`); writeFileSync(temp, text, { mode: 0o600, flag: 'wx' }); protect(temp); renameSync(temp, path); }
for (const id of ids) {
  const old = registry.findIndex(d => d.deviceId === id);
  if (['init', 'add', 'add-worker'].includes(action) ? old !== -1 : old === -1) throw Error('DEVICE_STATE_CONFLICT');
  if (action === 'revoke') { registry.splice(old, 1); atomic(join(root, `${id}.token`), 'REVOKED\n'); }
  else {
    const token = randomBytes(32).toString('hex'); const device = { ownerId: 'personal', deviceId: id, role: action === 'add-worker' ? 'worker' : old >= 0 ? registry[old].role : 'desktop', token };
    if (old === -1) registry.push(device); else registry[old] = device;
    atomic(join(root, `${id}.token`), token + '\n');
  }
}
if (!registry.length) throw Error('KEEP_AT_LEAST_ONE_DEVICE');
atomic(path, JSON.stringify(registry, null, 2) + '\n'); protect(root);
process.stdout.write('Device registry updated. Import each private DEVICE.token file into that device GUI; do not publish these files.\n');
