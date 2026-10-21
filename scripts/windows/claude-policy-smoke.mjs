import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

if (process.platform !== 'win32' || !process.argv[2]) throw new Error('WINDOWS_POLICY_MODULE_REQUIRED');
const { boundedProcess, claudePolicyCommand } = await import(pathToFileURL(process.argv[2]).href);
const { program, args } = claudePolicyCommand();
// The workflow marks this fixed helper ZoneId=3, as in an extracted download.
// Reproduce the old script-startup failure without touching machine policy.
const blocked = spawnSync(program.executable, args.map(arg => arg === 'Bypass' ? 'RemoteSigned' : arg), { encoding: 'utf8', windowsHide: true, timeout: 10000 });
assert.equal(blocked.status, 1);
assert.equal(blocked.stdout.trim(), '');
assert.match(blocked.stderr, /PSSecurityException|UnauthorizedAccess/);
const result = await boundedProcess(program, args, { cwd: process.env.SystemRoot, timeoutMs: 10000, maxBytes: 16384, nativePolicy: true });
await result.settled;
assert.equal(result.stopped, false);
assert.equal(result.code, 0);
assert.equal(result.output.trim(), 'absent');
await assert.rejects(boundedProcess(program, [...args, '-Command', 'exit 0'], { cwd: process.env.SystemRoot, timeoutMs: 1000, nativePolicy: true }), /SYSTEM_POLICY_PROGRAM_REQUIRED/);
process.stdout.write('PASS downloaded Claude policy helper: RemoteSigned refusal reproduced; fixed read-only check passed; arbitrary command refused; no model request\n');
