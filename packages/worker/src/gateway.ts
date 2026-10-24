import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { requireValue } from '../../core/src/model.ts';
export interface GatewayConfig {
  kind: 'claude-compatible-endpoint'; baseUrl: string; model: string;
  models: { sonnet: string; opus: string; haiku: string };
  credentialRef: string; vision: 'not-verified' | 'operator-attested' | 'synthetic-test-passed';
}
const keys = ['kind', 'baseUrl', 'model', 'models', 'credentialRef', 'vision'];
export function validateGateway(g: GatewayConfig): void {
  requireValue(g && Object.keys(g).every(k => keys.includes(k)) && g.kind === 'claude-compatible-endpoint', 'INVALID_GATEWAY');
  let url: URL; try { url = new URL(g.baseUrl); } catch { throw new Error('GATEWAY_HTTPS_ENDPOINT_REQUIRED'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !url.port &&
    ['https://open.bigmodel.cn/api/anthropic', 'https://api.z.ai/api/anthropic'].includes(g.baseUrl), 'GATEWAY_ENDPOINT_NOT_APPROVED');
  const model = (v: unknown) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v);
  requireValue(model(g.model) && g.models && Object.keys(g.models).sort().join(',') === 'haiku,opus,sonnet' && Object.values(g.models).every(model), 'INVALID_GATEWAY_MODEL');
  requireValue(/^Shot2Agent-Gateway-[0-9a-f-]{36}$/.test(g.credentialRef), 'INVALID_CREDENTIAL_REF');
  requireValue(['not-verified', 'operator-attested', 'synthetic-test-passed'].includes(g.vision), 'INVALID_VISION_QUALIFICATION');
}
export function assertGatewayVision(g: GatewayConfig): void {
  validateGateway(g);
  // Explicit documented image-capable models only; endpoint qualification remains separate.
  // https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash
  // Do not use MCP/tools as a vision substitute.
  requireValue([g.model, ...Object.values(g.models)].every(v => /^(?:glm-4\.6v(?:-flashx|-flash)?|glm-5\.3-flash)$/i.test(v)), 'GATEWAY_MODEL_VISION_UNSUPPORTED');
  // Qualification is diagnostic metadata; a supported real task needs no prior paid test.
}
export const credentialScript = fileURLToPath(new URL('./gateway-credential.ps1', import.meta.url));
export function credentialCommand(action: 'add' | 'read' | 'delete', reference: string): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  requireValue(process.platform === 'win32', 'WINDOWS_SECURE_STORE_REQUIRED');
  requireValue(/^Shot2Agent-(Gateway|Relay)-[0-9a-f-]{36}$/.test(reference), 'INVALID_CREDENTIAL_REF');
  return { executable: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    // This is a fixed, app-bundled helper. Downloaded ZIPs carry Mark-of-the-Web,
    // so RemoteSigned would otherwise refuse it for some Windows users. Scope the
    // override to this child process; never change the user's machine policy.
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', credentialScript, '-Action', action, '-Reference', reference],
    // This fixed OS helper needs the normal Windows host environment (as does the
    // fixed policy helper). Provider credentials never enter it; model processes
    // independently keep their strict environment allowlist.
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:ANTHROPIC_|CLAUDE_|OPENAI_|CODEX_|NODE_OPTIONS$|NODE_EXTRA_CA_CERTS$)/i.test(key))) };

}
/** Token travels only through a private pipe and the selected child's environment. Never diagnostic output. */
export async function readGatewayToken(reference: string): Promise<string> {
  const command = credentialCommand('read', reference);
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { env: command.env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = ''; let oversized = false;
    const timer = setTimeout(() => child.kill(), 10000);
    child.stdout.on('data', b => { if (output.length + b.length > 4096) { oversized = true; child.kill(); } else output += b.toString('utf8'); });
    child.on('error', () => {});
    child.on('close', code => { clearTimeout(timer);
      if (code === 0 && !oversized && /^[\x21-\x7e]{8,2048}$/.test(output.trim())) resolve(output.trim());
      else reject(new Error('GATEWAY_CREDENTIAL_UNAVAILABLE'));
      output = '';
    });
  });
}

/** Store a GUI-entered Token through the existing private pipe into Credential Manager. */
export async function saveGatewayToken(reference: string, token: string): Promise<void> {
  requireValue(typeof token === 'string' && /^[\x21-\x7e]{8,2048}$/.test(token), 'INVALID_GATEWAY_TOKEN');
  const command = credentialCommand('add', reference);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, [...command.args, '-TokenFromPipe'], { env: command.env, shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    let finished = false;
    const timer = setTimeout(() => { if (!finished) child.kill(); }, 30000);
    child.on('error', () => {});
    child.on('close', code => {
      finished = true; clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error('GATEWAY_SECURE_STORE_OPERATION_FAILED'));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(`${token}\n`);
  });
}

/** Delete is idempotent so an interrupted unused-profile cleanup can safely resume. */
export async function deleteGatewayToken(reference: string): Promise<void> {
  const command = credentialCommand('delete', reference);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, { env: command.env, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    let finished = false;
    const timer = setTimeout(() => { if (!finished) child.kill(); }, 10000);
    child.on('error', () => {});
    child.on('close', code => { finished = true; clearTimeout(timer); if (code === 0) resolve(); else reject(new Error('GATEWAY_SECURE_STORE_OPERATION_FAILED')); });
  });
}

/** Only a fixed diagnostic code crosses the task boundary; raw CLI/server errors never do. */
export function gatewayFailure(output: string): string {
  let events: { type?: string; is_error?: boolean; result?: string }[];
  try { events = output.trim().split('\n').map(line => JSON.parse(line)); } catch { return 'GATEWAY_TRANSPORT_INVALID'; }
  const final = events.find(e => e.type === 'result' && e.is_error === true);
  if (!final) return 'GATEWAY_REQUEST_FAILED';
  const message = typeof final.result === 'string' ? final.result.slice(0, 8192) : '';
  if (/\b(401|403)\b/.test(message)) return 'GATEWAY_AUTH_FAILED';
  if (/vision|image.*(?:unsupported|not supported)/i.test(message)) return 'GATEWAY_MODEL_VISION_UNSUPPORTED';
  if (/\b(404|429|500|502|503)\b/.test(message)) return 'GATEWAY_ENDPOINT_FAILED';
  return 'GATEWAY_REQUEST_FAILED';
}
