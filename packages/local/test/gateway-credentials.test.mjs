import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { credentialCommand, readGatewayToken } from '../../worker/src/gateway.ts';
const gateway = () => ({ credentialRef: `Shot2Agent-Gateway-${randomUUID()}` });
test('Windows secure store refuses absent disposable reference; no personal credentials accessed', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(readGatewayToken(gateway().credentialRef), /GATEWAY_CREDENTIAL_UNAVAILABLE/);
});
test('Windows OS-backed credential lifecycle uses a unique disposable target and refuses replacement', { skip: process.platform !== 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const { credentialScript } = await import('../../worker/src/gateway.ts');
  const reference = gateway().credentialRef; const native = credentialCommand('delete', reference);
  const helper = fileURLToPath(new URL('./mock-credential-add.ps1', import.meta.url));
  const add = () => spawnSync(native.executable, ['-NoProfile', '-NonInteractive', '-File', helper, '-Script', credentialScript, '-Reference', reference], { shell: false, encoding: 'utf8', timeout: 15000 });
  try {
    const created = add(); assert.equal(created.status, 0, `synthetic secure-store create refused: ${created.stderr}`);
    assert.equal(await readGatewayToken(reference), 'synthetic-fixture-only-credential');
    assert.notEqual(add().status, 0, 'existing reference must be immutable');
    assert.equal(spawnSync(native.executable, native.args, { shell: false, timeout: 15000 }).status, 0);
    await assert.rejects(readGatewayToken(reference), /GATEWAY_CREDENTIAL_UNAVAILABLE/);
  } finally { spawnSync(native.executable, native.args, { shell: false, timeout: 15000, stdio: 'ignore' }); }
});
