// Test-only CLI to fixture gateway transport: no production injection switch.
import http from 'node:http';
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.305 (Claude Code)\n'); process.exit(0); }
if (args.includes('--help')) { process.stdout.write('--input-format --output-format --tools --disallowedTools --restricted --safe-mode --no-session-persistence --strict-mcp-config --mcp-config --settings --setting-sources'); process.exit(0); }
let input = ''; for await (const chunk of process.stdin) input += chunk;
const message = JSON.parse(input);
const transport = JSON.parse(readFileSync('mock-gateway.json', 'utf8'));
const result = await new Promise((resolve, reject) => {
 const req = http.request({ hostname: '127.0.0.1', port: transport.port, path: '/api/anthropic/v1/messages', method: 'POST',
 headers: { authorization: `Bearer ${process.env.ANTHROPIC_AUTH_TOKEN}`, 'content-type': 'application/json' } }, res => {
 let body=''; res.on('data', c => body += c); res.on('end', () => resolve(JSON.parse(body)));
 }); req.on('error', reject);
 req.end(JSON.stringify({ model: process.env.ANTHROPIC_MODEL, messages: [message.message], evidence: {
  args, endpoint: process.env.ANTHROPIC_BASE_URL, homeIsolated: process.env.HOME !== transport.operatorHome,
  apiKeyAbsent: !process.env.ANTHROPIC_API_KEY, oauthAbsent: !process.env.CLAUDE_CODE_OAUTH_TOKEN, proxyAbsent: !process.env.HTTPS_PROXY,
  models: [process.env.ANTHROPIC_DEFAULT_OPUS_MODEL, process.env.ANTHROPIC_DEFAULT_SONNET_MODEL, process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL] } }));
});
process.stdout.write(JSON.stringify(result) + '\n');
