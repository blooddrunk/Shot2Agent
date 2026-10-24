import { resolve } from 'node:path';
import { discover } from '../../../packages/worker/src/discovery.ts';
import { LinuxWorkerState, approveLinux, loadLinuxProfiles, preflightLinux, runLinuxWorker, validateLinuxConfig } from '../../../packages/worker/src/linux-worker.ts';
import type { LinuxWorkerConfig } from '../../../packages/worker/src/linux-worker.ts';
import { LinuxProcessOwner } from '../../../packages/worker/src/linux-platform.ts';
const env = process.env;
const config: LinuxWorkerConfig = {
  url: env.SHOT2AGENT_RELAY_URL ?? '', trustedInternalOrigin: env.SHOT2AGENT_TRUSTED_INTERNAL_RELAY,
  ownerId: env.SHOT2AGENT_WORKER_OWNER ?? 'personal', deviceId: env.SHOT2AGENT_WORKER_DEVICE ?? 'vps-worker', label: env.SHOT2AGENT_WORKER_LABEL ?? 'Linux VPS',
  tokenFile: env.SHOT2AGENT_WORKER_TOKEN_FILE ?? '/run/worker-secrets/worker.token',
  stateRoot: resolve(env.SHOT2AGENT_WORKER_ROOT ?? '/data'), scratchRoot: resolve(env.SHOT2AGENT_WORKER_SCRATCH ?? '/scratch'),
  workspace: resolve(env.SHOT2AGENT_WORKSPACE ?? '/workspace'), fake: env.SHOT2AGENT_WORKER_FAKE === '1',
};
const [command = 'run', provider, executable, id] = process.argv.slice(2);
try {
  validateLinuxConfig(config); process.umask(0o077); process.env.TMPDIR = config.scratchRoot;
  if (command === 'run') {
    const controller = new AbortController();
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
    await runLinuxWorker(config, controller.signal);
  } else {
    const state = new LinuxWorkerState(config.stateRoot);
    try {
      await new LinuxProcessOwner(config.stateRoot).recover();
      if (command === 'discover') {
        for (const name of ['codex', 'claude'] as const) process.stdout.write(JSON.stringify(await discover(name, config.workspace, { linux: true })) + '\n');
      } else if (command === 'approve' && ['codex', 'claude', 'claude-compatible-endpoint'].includes(provider) && executable && id) {
        await approveLinux(config, provider as 'codex' | 'claude' | 'claude-compatible-endpoint', executable, id,
          env.SHOT2AGENT_AGENT_SECRET_FILE ?? '/run/worker-secrets/agent-secret', env.SHOT2AGENT_GLM_ENDPOINT ?? 'https://open.bigmodel.cn/api/anthropic', env.SHOT2AGENT_GLM_MODEL ?? 'glm-5.3-flash');
        process.stdout.write('LINUX_PROFILE_APPROVED_NO_MODEL_REQUEST\n');
      } else if (command === 'doctor') {
        for (const p of loadLinuxProfiles(config)) { await preflightLinux(p); process.stdout.write(JSON.stringify({ provider: p.provider, id: p.policy.id, version: p.policy.version, cliVersion: p.policy.cliVersion, status: 'PASS_STARTUP_ONLY_NO_MODEL_REQUEST' }) + '\n'); }
      } else throw new Error('USAGE_RUN_DISCOVER_DOCTOR_OR_APPROVE_PROVIDER_EXECUTABLE_ID');
    } finally { state.close(); }
  }
} catch (error) {
  process.stderr.write((error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LINUX_WORKER_REFUSED') + '\n'); process.exitCode = 1;
}
