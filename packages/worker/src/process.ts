import { validateGateway } from './gateway.ts';
import type { GatewayConfig } from './gateway.ts';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { stopLinuxGroup } from './linux-platform.ts';
export interface Program { executable: string; args: string[] }
export interface ProcessRuntime { env: NodeJS.ProcessEnv; spawned(pid: number): void; closed(): void }
/** Fixed read-only OS helper; the execution policy applies only to this child. */
export function claudePolicyCommand(): { program: Program; args: string[] } {
  return { program: { executable: join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: [] },
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./claude-policy.ps1', import.meta.url))] };
}
export interface ProcessResult {
  code: number | null; output: string; stopped: boolean; launched: boolean; overflow: boolean;
  /** Actual root and tree-killer handles have closed, independently of the bounded result deadline. */
  settled: Promise<void>;
}
/** Never forwards child logs. A detached POSIX process group / taskkill tree owns descendants. */
export async function boundedProcess(program: Program, args: string[], options: {
  gateway?: { config: GatewayConfig; token: string; home: string };
  runtime?: ProcessRuntime;
  cwd: string; provider?: 'claude'; nativePolicy?: true; input?: string; signal?: AbortSignal; timeoutMs: number; maxBytes?: number;
}): Promise<ProcessResult> {
  const policyCommand = options.nativePolicy ? claudePolicyCommand() : undefined;
  if (policyCommand && (process.platform !== 'win32' || program.executable !== policyCommand.program.executable || program.args.length || JSON.stringify(args) !== JSON.stringify(policyCommand.args))) throw new Error('SYSTEM_POLICY_PROGRAM_REQUIRED');
  if (options.signal?.aborted) return { code: null, output: '', stopped: true, launched: false, overflow: false, settled: Promise.resolve() };
  return new Promise(resolve => {
    let output = ''; let total = 0; let stopped = false; let launched = false; let overflow = false;
    let done = false; let rootClosed = false; let treeClosed = true;
    let exitCode: number | null = null; let reap: ReturnType<typeof setTimeout> | undefined;
    let onSettled!: () => void;
    const settled = new Promise<void>(resolve => { onSettled = resolve; });
    const allowed = new Set(['path', 'home', 'userprofile', 'localappdata', 'appdata', 'temp', 'tmp', 'tmpdir', 'systemroot', 'windir', 'comspec', 'pathext', 'username', 'user', 'codex_home', 'openai_api_key', 'codex_api_key', 'ssl_cert_file', 'ssl_cert_dir', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']);
    if (options.provider === 'claude') for (const key of ['anthropic_api_key', 'claude_code_oauth_token', 'claude_code_git_bash_path', 'programfiles', 'programdata']) allowed.add(key);
    // Only the fixed read-only OS registry helper inherits its normal Windows environment.
    // Model CLIs always retain the provider allowlist; no Profile/task can enable this path.
    const env = options.runtime ? { ...options.runtime.env } : Object.fromEntries(Object.entries(process.env).filter(([key]) => options.nativePolicy || allowed.has(key.toLowerCase())));
    if (options.provider === 'claude') Object.assign(env, { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1' });
    if (options.gateway) {
      const { config, token, home } = options.gateway; validateGateway(config);
      // No inherited credentials, proxies, project/user settings or TLS overrides.
      for (const key of Object.keys(env)) if (!['path', 'systemroot', 'windir', 'temp', 'tmp', 'programfiles', 'programdata', 'claude_code_git_bash_path'].includes(key.toLowerCase())) delete env[key];
      Object.assign(env, { HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, CLAUDE_CONFIG_DIR: join(home, '.claude'),
        ANTHROPIC_BASE_URL: config.baseUrl, ANTHROPIC_AUTH_TOKEN: token, ANTHROPIC_MODEL: config.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: config.models.sonnet, ANTHROPIC_DEFAULT_OPUS_MODEL: config.models.opus, ANTHROPIC_DEFAULT_HAIKU_MODEL: config.models.haiku,
        ...(options.runtime ? { CLAUDE_CODE_MAX_RETRIES: '0', CLAUDE_CODE_NONSTREAMING_TIMEOUT_RETRIES: '0' } : {}),
        DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' });
    }
    const child = spawn(program.executable, [...program.args, ...args], {
      cwd: options.cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const finish = (code: number | null) => {
      if (done) return; done = true; clearTimeout(timer); if (reap) clearTimeout(reap);
      options.signal?.removeEventListener('abort', stop);
      // Do not destroy/unref a still-live process and mistake that for reaping it.
      resolve({ code, output, stopped, launched, overflow, settled });
    };
    const closed = () => {
      if (!rootClosed || !treeClosed) return;
      try { options.runtime?.closed(); } catch { finish(null); return; }
      onSettled(); finish(exitCode);
    };
    const stop = () => {
      if (stopped || done) return;
      stopped = true;
      if (child.pid) {
        if (process.platform === 'win32') {
          treeClosed = false;
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
          killer.on('close', () => { child.kill(); treeClosed = true; closed(); });
        } else if (process.platform === 'linux') {
          treeClosed = false;
          void stopLinuxGroup(child.pid).then(() => { treeClosed = true; closed(); }, () => finish(null));
        } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      // Result is bounded, but settled remains pending until the real process-close barrier.
      reap = setTimeout(() => finish(null), 1500);
    };
    const timer = setTimeout(stop, options.timeoutMs);
    child.on('spawn', () => {
      launched = true;
      try { options.runtime?.spawned(child.pid!); child.stdin.end(options.input ?? ''); }
      catch { stop(); }
    });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes: Buffer) => {
      total += bytes.length;
      if (total > (options.maxBytes ?? 1024 * 1024)) { overflow = true; stop(); }
      else if (stream === child.stdout) output += bytes.toString('utf8');
    });
    // spawn failures also emit close; the same barrier owns their stdio handles.
    child.on('error', () => {});
    child.on('close', code => {
      exitCode = code; rootClosed = true;
      // A successful root exit can leave detached stdio-less descendants alive.
      if (process.platform === 'linux' && child.pid && !stopped) {
        treeClosed = false;
        void stopLinuxGroup(child.pid).then(() => { treeClosed = true; closed(); }, () => finish(null));
      } else closed();
    });
    child.stdin.on('error', () => { /* closed stdin is reported by exit status */ });
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
  });
}
