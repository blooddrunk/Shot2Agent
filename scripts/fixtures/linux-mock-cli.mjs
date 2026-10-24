// Test-only CLI; synthetic images and credentials, never a network/model request.
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setInterval } from 'node:timers';
const root = dirname(fileURLToPath(import.meta.url)); const args = process.argv.slice(2);
const codex = root.includes('codex');
if (args[0] === '--version') { process.stdout.write(codex ? 'codex-cli mock-linux\n' : '2.1.306 (Claude Code)\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('--image --output-last-message --sandbox --ignore-user-config --ignore-rules --ephemeral --input-format --output-format --tools --disallowedTools --restricted --safe-mode --no-session-persistence --strict-mcp-config --mcp-config --settings --setting-sources'); process.exit(0); }
if (args[0] === 'sandbox') process.exit(0);
if (args.includes('auth')) { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }
const mode = existsSync(join(root, 'mode')) ? readFileSync(join(root, 'mode'), 'utf8').trim() : 'success';
let input = ''; for await (const b of process.stdin) input += b;
const images = codex ? args.flatMap((a, i) => a === '--image' ? [readFileSync(args[i + 1]).length] : []) : JSON.parse(input).message.content.filter(c => c.type === 'image').map(c => Buffer.from(c.source.data, 'base64').length);
const child = ['tree', 'orphan'].includes(mode) ? spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }) : undefined;
if (mode === 'orphan') child.unref();
const record = { args, images, pid: process.pid, child: child?.pid, cwd: process.cwd(), home: process.env.HOME, retryBudget: process.env.CLAUDE_CODE_MAX_RETRIES, inheritedSecret: !!process.env.SHOT2AGENT_TOKEN || !!process.env.OPENAI_API_KEY || !!process.env.NODE_OPTIONS };
appendFileSync(join(root, 'executions.jsonl'), JSON.stringify(record) + '\n');
if (['hang', 'tree'].includes(mode)) setInterval(() => {}, 1000);
else if (mode === 'exit') { process.stderr.write('PRIVATE_MOCK_ERROR'); process.exitCode = 7; }
else if (codex) writeFileSync(args[args.indexOf('--output-last-message') + 1], '# Mock Linux Codex\nSHOT2AGENT 42');
else process.stdout.write(mode === 'corrupt' ? 'private invalid output' : JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: `# Mock Linux Claude\nSHOT2AGENT 42\n${images.length} image(s)` }) + '\n');
