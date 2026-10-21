import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { requireValue } from '../../core/src/model.ts';
export interface GatewayConfig {
  kind: 'claude-compatible-endpoint'; baseUrl: string; model: string;
  models: { sonnet: string; opus: string; haiku: string };
  credentialRef: string; vision: 'not-verified' | 'operator-attested';
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
  requireValue(['not-verified', 'operator-attested'].includes(g.vision), 'INVALID_VISION_QUALIFICATION');
}
export function assertGatewayVision(g: GatewayConfig): void {
  validateGateway(g);
  // Coding-plan defaults can be text only. Do not use MCP/tools as a vision substitute.
  requireValue([g.model, ...Object.values(g.models)].every(v => /^glm-4\.6v(?:-flashx|-flash)?$/i.test(v)), 'GATEWAY_MODEL_VISION_UNSUPPORTED');
  requireValue(g.vision === 'operator-attested', 'GATEWAY_VISION_NOT_VERIFIED');
}
export const credentialScript = fileURLToPath(new URL('./gateway-credential.ps1', import.meta.url));
export function credentialCommand(action: 'add' | 'read' | 'delete', reference: string): { executable: string; args: string[]; env: NodeJS.ProcessEnv } {
  requireValue(process.platform === 'win32', 'WINDOWS_SECURE_STORE_REQUIRED');
  requireValue(/^Shot2Agent-Gateway-[0-9a-f-]{36}$/.test(reference), 'INVALID_CREDENTIAL_REF');
  return { executable: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-File', credentialScript, '-Action', action, '-Reference', reference],
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => ['systemroot', 'windir', 'path', 'temp', 'tmp', 'userprofile', 'appdata', 'localappdata', 'programdata', 'programfiles'].includes(key.toLowerCase()))),
      // The caller may be pwsh/CI; never inherit its incompatible or user-owned module paths.
      PSModulePath: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'Modules') } };
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
