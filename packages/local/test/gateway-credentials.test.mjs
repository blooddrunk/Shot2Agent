import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { credentialCommand, readGatewayToken } from '../../worker/src/gateway.ts';
const gateway = () => ({ credentialRef: `Shot2Agent-Gateway-${randomUUID()}` });
test('credential helper uses only a process-scoped policy for the downloaded packaged script', { skip: process.platform !== 'win32' }, () => {
  const command = credentialCommand('add', gateway().credentialRef);
  assert.deepEqual(command.args.slice(0, 4), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File']);
});
test('Windows secure store refuses absent disposable reference; no personal credentials accessed', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(readGatewayToken(gateway().credentialRef), /GATEWAY_CREDENTIAL_UNAVAILABLE/);
});
test('Windows OS-backed credential lifecycle uses a unique disposable target and refuses replacement', { skip: process.platform !== 'win32' }, async () => {
  const { spawnSync } = await import('node:child_process');
  const reference = gateway().credentialRef; const native = credentialCommand('delete', reference);
  const addCommand = credentialCommand('add', reference);
  const add = () => spawnSync(addCommand.executable, [...addCommand.args, '-TokenFromPipe'], { env: addCommand.env, input: 'synthetic-fixture-only-credential\n', shell: false, encoding: 'utf8', timeout: 15000 });
  try {
    const created = add(); assert.equal(created.status, 0, `synthetic secure-store create refused: ${created.stderr}`);
    assert.equal(await readGatewayToken(reference), 'synthetic-fixture-only-credential');
    assert.notEqual(add().status, 0, 'existing reference must be immutable');
    assert.equal(spawnSync(native.executable, native.args, { env: native.env, shell: false, timeout: 15000 }).status, 0);
    await assert.rejects(readGatewayToken(reference), /GATEWAY_CREDENTIAL_UNAVAILABLE/);
  } finally {
    spawnSync(native.executable, native.args, { env: native.env, shell: false, timeout: 15000, stdio: 'ignore' });
  }
});
