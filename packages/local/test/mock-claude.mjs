import { setInterval } from 'node:timers';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.306 (Claude Code)\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('--input-format --output-format --tools --disallowedTools --restricted --safe-mode --no-session-persistence --strict-mcp-config --mcp-config --settings'); process.exit(0); }
if (args.includes('auth')) { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: readFileSync('mode', 'utf8').trim() === 'auth' ? 'team' : 'pro' })); process.exit(0); }
const mode = readFileSync('mode', 'utf8').trim();
let input = ''; for await (const chunk of process.stdin) input += chunk;
const message = JSON.parse(input);
const descendant = mode === 'tree' ? spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', shell: false }) : undefined;
writeFileSync('invocation.json', JSON.stringify({ descendant: descendant?.pid, args, images: message.message.content.filter(c => c.type === 'image').map(c => c.source), lines: input.trim().split('\n').length }));
if (mode === 'hang' || mode === 'tree') setInterval(() => {}, 1000);
else if (mode === 'exit') { process.stderr.write('PRIVATE_SECRET_DO_NOT_LOG'); process.exitCode = 7; }
else if (mode === 'logs') { for (let i = 0; i < 128; i++) process.stdout.write('x'.repeat(16384)); }
else if (mode === 'invalid') process.stdout.write('INVALID PRIVATE_SECRET_DO_NOT_LOG');
else if (mode !== 'missing') {
  const result = { type: 'result', subtype: mode === 'error' ? 'error_during_execution' : 'success', is_error: mode === 'error', result: mode === 'huge' ? 'x'.repeat(100001) : '# Mock Claude\nSHOT2AGENT 42' };
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: [] }) + '\n' + JSON.stringify(result) + '\n');
  if (mode === 'double') process.stdout.write(JSON.stringify(result) + '\n');
}
