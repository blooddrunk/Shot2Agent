import test from 'node:test';
import assert from 'node:assert/strict';
import { displayInventory } from '../src/inventory.ts';
test('inventory merges approved Node runtime and npm shim by actual CLI entry without changing execution configuration', () => {
 const entry = 'C:\\Users\\Synthetic\\npm\\node_modules\\@openai\\codex\\bin\\codex.js';
 const approved = { provider: 'codex', path: 'C:\\Program Files\\nodejs\\node.exe', program: { executable: 'C:\\Program Files\\nodejs\\node.exe', args: [entry] }, version: 'codex-cli mock', status: 'unverified_auth', digest: 'approved' };
 const detected = { ...approved, path: 'C:\\Users\\Synthetic\\npm\\codex.cmd', program: { executable: 'D:\\Package\\runtime\\node.exe', args: [entry] }, digest: 'detected' };
 const before = JSON.parse(JSON.stringify([approved, detected]));
 const rows = displayInventory([approved, detected]);
 assert.equal(rows.length, 1); assert.equal(rows[0].path, entry);
 assert.deepEqual(rows[0].program, approved.program); assert.equal(rows[0].digest, 'approved');
 assert.deepEqual([approved, detected], before);
});
test('inventory merges repeated native Windows paths and preserves distinct installs and differing refusal states', () => {
 const first = { provider: 'claude', path: 'C:\\Users\\Synthetic\\.local\\bin\\claude.exe', version: '2.1.305 (Claude Code)', status: 'unverified_auth' };
 const duplicate = { ...first, path: 'c:/users/Synthetic/.local/bin/claude.exe' };
 assert.equal(displayInventory([first, duplicate]).length, 1);
 assert.equal(displayInventory([first, { ...first, path: 'D:\\Other\\claude.exe' }]).length, 2);
 assert.equal(displayInventory([first, { ...first, status: 'version_changed' }]).length, 2);
 const warnings = [{ provider: 'claude', path: '', status: 'scan_incomplete' }, { provider: 'claude', path: '', status: 'not_found' }];
 assert.deepEqual(displayInventory([first, ...warnings]).map(c => c.status), ['unverified_auth', 'scan_incomplete']);
 assert.equal(displayInventory(warnings).length, 2);
});

test('inventory keeps case-sensitive POSIX installations distinct', () => {
 const row = { provider: 'claude', path: '/opt/Claude/bin/claude', version: 'mock', status: 'unverified_auth' };
 assert.equal(displayInventory([row, { ...row, path: '/opt/claude/bin/claude' }]).length, 2);
});
