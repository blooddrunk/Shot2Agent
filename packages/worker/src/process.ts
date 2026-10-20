import { spawn } from 'node:child_process';
export interface Program { executable: string; args: string[] }
export interface ProcessResult { code: number | null; output: string; stopped: boolean; launched: boolean; overflow: boolean }
/** Never forwards child logs. A detached POSIX process group / taskkill tree owns descendants. */
export async function boundedProcess(program: Program, args: string[], options: {
  cwd: string; input?: string; signal?: AbortSignal; timeoutMs: number; maxBytes?: number;
}): Promise<ProcessResult> {
  if (options.signal?.aborted) return { code: null, output: '', stopped: true, launched: false, overflow: false };
  return new Promise(resolve => {
    let output = ''; let total = 0; let stopped = false; let launched = false; let overflow = false;
    let done = false; let reap: ReturnType<typeof setTimeout> | undefined;
    const allowed = new Set(['path', 'home', 'userprofile', 'localappdata', 'appdata', 'temp', 'tmp', 'tmpdir', 'systemroot', 'windir', 'comspec', 'pathext', 'username', 'user', 'codex_home', 'openai_api_key', 'codex_api_key', 'ssl_cert_file', 'ssl_cert_dir', 'https_proxy', 'http_proxy', 'all_proxy', 'no_proxy']);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
    const child = spawn(program.executable, [...program.args, ...args], {
      cwd: options.cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stop = () => {
      if (stopped || done) return;
      stopped = true;
      if (child.pid) {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
          killer.on('close', () => child.kill());
        } else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
      }
      reap = setTimeout(() => finish(null), 1500);
    };
    const timer = setTimeout(stop, options.timeoutMs);
    const finish = (code: number | null) => {
      if (done) return; done = true; clearTimeout(timer); if (reap) clearTimeout(reap);
      options.signal?.removeEventListener('abort', stop);
      child.stdout.destroy(); child.stderr.destroy(); child.stdin.destroy(); child.unref();
      resolve({ code, output, stopped, launched, overflow });
    };
    child.on('spawn', () => { launched = true; });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes: Buffer) => {
      total += bytes.length;
      if (total > (options.maxBytes ?? 1024 * 1024)) { overflow = true; stop(); }
      else if (stream === child.stdout) output += bytes.toString('utf8');
    });
    child.on('error', () => finish(null)); child.on('close', finish);
    child.stdin.on('error', () => { /* closed stdin is reported by exit status */ });
    child.stdin.end(options.input ?? '');
    options.signal?.addEventListener('abort', stop, { once: true });
    if (options.signal?.aborted) stop();
  });
}
