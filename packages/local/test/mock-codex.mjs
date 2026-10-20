import { spawn } from 'node:child_process';
import { setInterval } from 'node:timers';
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('codex-cli mock-1\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('--image --output-last-message --sandbox --ignore-user-config --ignore-rules --ephemeral'); process.exit(0); }
const mode = readFileSync('mode', 'utf8').trim();
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const descendant = mode === 'tree' ? spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }) : undefined;
writeFileSync('invocation.json', JSON.stringify({ args, prompt, pid: process.pid, descendant: descendant?.pid, cwd: process.cwd(), images: args.flatMap((a, i) => a === '--image' ? [readFileSync(args[i + 1]).length] : []) }));
if (mode === 'hang' || mode === 'tree') { setInterval(() => {}, 1000); }
else if (mode === 'exit') { process.stderr.write('PRIVATE_SECRET_DO_NOT_LOG'); process.exitCode = 7; }
else if (mode === 'logs') { for (let i = 0; i < 128; i++) process.stdout.write('x'.repeat(16384)); }
else {
  const output = args[args.indexOf('--output-last-message') + 1];
  if (mode === 'huge') writeFileSync(output, 'x'.repeat(100001));
  else if (mode === 'invalid') writeFileSync(output, Buffer.from([255, 254]));
  else if (mode !== 'missing') writeFileSync(output, '# Mock result\n\nKnown synthetic text.\n');
}
