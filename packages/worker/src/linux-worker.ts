import { lstatSync, readFileSync, realpathSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { LeaseProof, AgentResult, Profile } from '../../contracts/src/index.ts';
import type { WorkerPort, StartInfo } from '../../core/src/core.ts';
import { SqliteTaskStore } from '../../core/src/store.ts';
import { requireValue } from '../../core/src/model.ts';
import { RemoteClient, validateWorkerRelayUrl } from '../../../services/relay/src/client.ts';
import { executionRegistry } from './registry.ts';
import type { ApprovedPolicy } from './registry.ts';
import { runOnce } from './worker.ts';
import type { ExecutionEntry } from './worker.ts';
import { FakeAgent, FAKE_PROFILE } from './fake.ts';
import { LinuxProcessOwner, linuxProcesses, privateFile, privateRoot, atomicPrivate, linuxRuntime } from './linux-platform.ts';
import { inspectClaude, programDigest, resolveProgram } from './discovery.ts';
import { inspectCodex } from './codex.ts';
import { assertLinuxClaudePolicy } from './claude.ts';
import { boundedProcess } from './process.ts';
import { randomUUID } from 'node:crypto';

export interface LinuxWorkerConfig {
  url: string; trustedInternalOrigin?: string; ownerId: string; deviceId: string; label: string;
  tokenFile: string; stateRoot: string; scratchRoot: string; workspace: string; fake: boolean;
}
const identifier = (s: string) => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
export function validateLinuxConfig(c: LinuxWorkerConfig): void {
  requireValue(process.platform === 'linux' && process.getuid!() !== 0, 'NON_ROOT_LINUX_REQUIRED');
  validateWorkerRelayUrl(c.url, c.trustedInternalOrigin);
  requireValue(identifier(c.ownerId) && identifier(c.deviceId) && typeof c.label === 'string' && c.label.length > 0 && c.label.length <= 80 && ![...c.label].some(s => s.charCodeAt(0) < 32) && typeof c.fake === 'boolean', 'INVALID_WORKER_CONFIG');
  privateRoot(c.stateRoot); privateRoot(c.scratchRoot);
  requireValue(realpathSync(c.workspace) === c.workspace && lstatSync(c.workspace).isDirectory() && !lstatSync(c.workspace).isSymbolicLink(), 'UNAPPROVED_WORKSPACE');
  const paths = [c.stateRoot, c.scratchRoot, c.workspace];
  requireValue(paths.every((a, i) => paths.every((b, j) => i === j || (relative(a, b).startsWith('..') && relative(b, a).startsWith('..')))), 'WORKER_PATHS_OVERLAP');
  requireValue(!paths.some(p => { const r = relative(p, c.tokenFile); return r === '' || (!r.startsWith('..') && !r.startsWith('/')); }), 'WORKER_SECRET_ISOLATION');
  requireValue(/^[\x21-\x7e]{32,256}$/.test(privateFile(c.tokenFile, 4096).toString().trim()), 'INVALID_WORKER_TOKEN');
}
interface Pending { id: string; proof: LeaseProof; info: StartInfo; result?: AgentResult }
/** The existing SQLite store holds only the single in-flight transport receipt; Relay owns tasks. */
export class LinuxWorkerState {
  readonly store: SqliteTaskStore;
  private lock: string;
  constructor(root: string) {
    privateRoot(root); this.store = new SqliteTaskStore(join(root, 'worker.sqlite'), 'remote');
    const self = linuxProcesses().find(p => p.pid === process.pid)!;
    this.lock = JSON.stringify({ pid: process.pid, start: self.start, boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8') });
    try {
      this.store.transaction(() => {
        const old = this.get('lock') as { pid: number; start: string; boot: string } | null;
        requireValue(!old || (Number.isSafeInteger(old.pid) && old.pid > 0 && typeof old.start === 'string' && typeof old.boot === 'string'), 'WORKER_LOCK_CORRUPT');
        requireValue(!old || old.boot !== JSON.parse(this.lock).boot || !linuxProcesses().some(p => p.pid === old.pid && p.start === old.start && !['Z', 'X'].includes(p.state)), 'WORKER_ALREADY_RUNNING');
        this.put('lock', JSON.parse(this.lock));
      });
    } catch (e) { this.store.close(); throw e; }
  }
  get(key: string): unknown { return JSON.parse(this.store.metadata(`linux:${key}`).find(r => r.key === `linux:${key}`)?.value ?? 'null'); }
  put(key: string, value: unknown): void { this.store.putMetadata(`linux:${key}`, JSON.stringify(value)); }
  bind(c: LinuxWorkerConfig): void {
    const value = { url: c.url, ownerId: c.ownerId, deviceId: c.deviceId, fake: c.fake };
    const old = this.get('identity'); requireValue(!old || JSON.stringify(old) === JSON.stringify(value), 'WORKER_STATE_IDENTITY_CHANGED'); this.put('identity', value);
  }
  close(): void { this.put('lock', null); this.store.close(); }
}
export class DurableWorkerPort implements WorkerPort {
  constructor(privateClient: RemoteClient, state: LinuxWorkerState, identity: string) { this.client = privateClient; this.state = state; this.identity = identity; }
  private client: RemoteClient; private state: LinuxWorkerState; private identity: string;
  async recover(): Promise<void> {
    const p = this.state.get('pending') as Pending | null;
    if (!p) return;
    requireValue(typeof p.id === 'string' && p.proof && p.info && (!p.result || typeof p.result === 'object'), 'WORKER_JOURNAL_CORRUPT');
    const result: AgentResult = p.result ?? { status: 'execution_unknown', summary: 'Worker restarted after start reservation; review before resubmitting', contentMarkdown: '', artifacts: [], errorCode: 'WORKER_RESTARTED_AFTER_START' };
    try { await this.client.complete(p.id, p.proof, result); }
    catch (e) { if (!(e instanceof Error && e.message === 'RELAY_409')) throw e; }
    // A fenced/expired attempt cannot execute again; a lost acknowledgement replays only the result.
    this.state.put('last', { id: p.id, attemptId: p.proof.attemptId, status: result.status }); this.state.put('pending', null);
  }
  async claim(profiles: { id: string; version: string }[]) {
    requireValue(!this.state.get('pending'), 'WORKER_SETTLEMENT_PENDING'); const claim = await this.client.claim(profiles);
    requireValue(!claim || claim.task.submission.targetWorkerId === this.identity, 'WRONG_WORKER_TARGET'); return claim;
  }
  async start(id: string, proof: LeaseProof, info: StartInfo): Promise<void> {
    this.state.put('pending', { id, proof, info }); await this.client.start(id, proof, info);
  }
  async heartbeat(id: string, proof: LeaseProof): Promise<void> { await this.client.heartbeat(id, proof); }
  async complete(id: string, proof: LeaseProof, result: AgentResult) {
    const p = this.state.get('pending') as Pending;
    requireValue(p?.id === id && p.proof.attemptId === proof.attemptId, 'WORKER_JOURNAL_MISMATCH');
    this.state.put('pending', { ...p, result });
    const task = await this.client.complete(id, proof, result);
    this.state.put('last', { id, attemptId: proof.attemptId, status: result.status }); this.state.put('pending', null); return task;
  }
  file(id: string, fileId: string): Promise<Buffer> { return this.client.file(id, fileId); }
}
export function loadLinuxProfiles(c: LinuxWorkerConfig): ApprovedPolicy[] {
  const rows = JSON.parse(privateFile(join(c.stateRoot, 'approvals.json'), 1024 * 1024).toString()) as ApprovedPolicy[];
  requireValue(Array.isArray(rows) && rows.length > 0 && rows.length <= 32, 'LINUX_APPROVAL_REQUIRED');
  for (const p of rows) {
    requireValue(p?.policy?.linux?.platform === 'linux' && p.policy.linux.stateRoot === c.stateRoot && p.policy.workspace === c.workspace && p.policy.digest &&
      p.policy.linux.credentialFile !== c.tokenFile && ![c.stateRoot, c.scratchRoot, c.workspace].some(dir => !relative(dir, p.policy.linux!.credentialFile).startsWith('..')), 'LINUX_APPROVAL_REQUIRED');
  }
  executionRegistry(rows); return rows;
}
export async function preflightLinux(p: ApprovedPolicy): Promise<void> {
  requireValue(p.policy.linux && p.policy.digest === programDigest(p.policy.program), 'LINUX_APPROVAL_EXPIRED');
  const session = linuxRuntime(p.policy.linux, p.provider === 'codex' ? 'codex' : 'claude', p.provider === 'claude-compatible-endpoint');
  try {
    const version = p.provider === 'codex' ? await inspectCodex(p.policy.program, p.policy.workspace, session.runtime) : await inspectClaude(p.policy.program, p.policy.workspace, undefined, session.runtime);
    requireValue(version === p.policy.cliVersion, 'LINUX_APPROVAL_EXPIRED');
    if (p.provider === 'codex') {
      const sandbox = await boundedProcess(p.policy.program, ['sandbox', 'linux', '--', '/usr/bin/true'], { cwd: p.policy.workspace, runtime: session.runtime, timeoutMs: 5000 }); await sandbox.settled;
      requireValue(sandbox.code === 0 && !sandbox.stopped, 'LINUX_CODEX_SANDBOX_UNAVAILABLE');
    } else {
      assertLinuxClaudePolicy();
      if (p.provider === 'claude-compatible-endpoint') {
        requireValue(['2.1.305 (Claude Code)', '2.1.306 (Claude Code)'].includes(version), 'GATEWAY_CLI_NOT_QUALIFIED');
        const help = await boundedProcess(p.policy.program, ['--help'], { cwd: p.policy.workspace, runtime: session.runtime, timeoutMs: 5000 }); await help.settled;
        requireValue(help.code === 0 && !help.stopped && help.output.includes('--setting-sources'), 'GATEWAY_SETTINGS_ISOLATION_UNAVAILABLE');
      }
    }
  } finally { session.close(); }
}
export async function approveLinux(c: LinuxWorkerConfig, provider: 'codex' | 'claude' | 'claude-compatible-endpoint', executable: string, id: string, credentialFile: string, endpoint?: string, model?: string): Promise<void> {
  requireValue(!c.fake, 'FAKE_WORKER_APPROVAL_REFUSED');
  requireValue(!/\.(cmd|ps1|bat|exe)$/i.test(executable), 'LINUX_EXECUTABLE_REQUIRED');
  requireValue(credentialFile !== c.tokenFile && ![c.stateRoot, c.scratchRoot, c.workspace].some(dir => !relative(dir, credentialFile).startsWith('..')), 'WORKER_SECRET_ISOLATION');
  const linux = { platform: 'linux' as const, uid: process.getuid!(), credentialFile, stateRoot: c.stateRoot };
  const program = resolveProgram(provider === 'codex' ? 'codex' : 'claude', executable);
  const session = linuxRuntime(linux, provider === 'codex' ? 'codex' : 'claude', provider === 'claude-compatible-endpoint');
  let cliVersion: string;
  try { cliVersion = provider === 'codex' ? await inspectCodex(program, c.workspace, session.runtime) : await inspectClaude(program, c.workspace, undefined, session.runtime); }
  finally { session.close(); }
  const common = { id, version: randomUUID(), program, cliVersion, workspace: c.workspace, digest: programDigest(program), timeoutMs: 120_000,
    prompt: 'Read the screenshot and return useful Markdown. Do not use tools.', linux };
  const policy: ApprovedPolicy = provider === 'codex' ? { provider, policy: common } : { provider, policy: { ...common, imageProtocol: 'linux-jsonl-v1',
    ...(provider === 'claude-compatible-endpoint' ? { gateway: { kind: 'claude-compatible-endpoint' as const, baseUrl: endpoint!, model: model!, models: { sonnet: model!, opus: model!, haiku: model! }, credentialRef: `Shot2Agent-Gateway-${randomUUID()}`, vision: 'not-verified' as const } } : {}) } };
  const path = join(c.stateRoot, 'approvals.json'); let old: ApprovedPolicy[] = [];
  try { old = loadLinuxProfiles(c); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  executionRegistry([...old, policy]); await preflightLinux(policy); atomicPrivate(path, [...old, policy]);
}
export function linuxEntries(c: LinuxWorkerConfig): ExecutionEntry[] { return c.fake ? [{ adapter: new FakeAgent(), profile: FAKE_PROFILE }] : executionRegistry(loadLinuxProfiles(c)); }
export function linuxCapabilities(entries: ExecutionEntry[]) {
  const latest = new Map<string, Profile>(); for (const e of entries) latest.set(e.profile.id, e.profile);
  return entries.map(e => ({ id: e.profile.id, version: e.profile.version, fingerprint: e.profile.fingerprint, provider: e.adapter.name, selectable: latest.get(e.profile.id) === e.profile, isDefault: e === entries.at(-1) }));
}
export async function runLinuxWorker(c: LinuxWorkerConfig, signal: AbortSignal): Promise<void> {
  validateLinuxConfig(c); const state = new LinuxWorkerState(c.stateRoot);
  const owner = new LinuxProcessOwner(c.stateRoot); let client: RemoteClient | undefined;
  let entries: ExecutionEntry[] = [];
  try {
    state.bind(c); await owner.recover();
    entries = linuxEntries(c);
    // Dedicated scratch only, after all old groups are proven dead. Never clean workspace/exported files.
    for (const name of readdirSync(c.scratchRoot)) { const path = join(c.scratchRoot, name); requireValue(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink() && name.startsWith('shot2agent-'), 'UNSAFE_WORKER_SCRATCH'); rmSync(path, { recursive: true }); }
    if (!c.fake) for (const p of loadLinuxProfiles(c)) await preflightLinux(p);
    const token = privateFile(c.tokenFile, 4096).toString().trim();
    client = new RemoteClient(c.url, token, undefined, c.trustedInternalOrigin ? { trustedInternalOrigin: c.trustedInternalOrigin } : undefined);
    const session = await client.session(); requireValue(session.ownerId === c.ownerId && session.deviceId === c.deviceId && session.role === 'worker', 'WORKER_TOKEN_IDENTITY_MISMATCH');
    const port = new DurableWorkerPort(client, state, c.deviceId); const caps = linuxCapabilities(entries);
    await port.recover();
    process.stdout.write('LINUX_WORKER_READY\n');
    let failures = 0;
    while (!signal.aborted) {
      try {
        await port.recover(); await client.presence(c.label, caps, true);
        await runOnce(port, entries[0].adapter, entries.map(e => e.profile), 5000, signal, entries);
        failures = 0;
      } catch (error) {
        if (error instanceof Error && /AGENT_STOP_UNCONFIRMED|JOURNAL|WRONG_WORKER|RELAY_40[13]/.test(error.message)) throw error;
        failures++;
        process.stderr.write('WORKER_TRANSPORT_UNAVAILABLE\n');
      }
      if (!signal.aborted) await delay(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), undefined, { signal }).catch(() => {});
    }
  } finally {
    if (client) await client.presence(c.label, linuxCapabilities(entries), false).catch(() => {});
    state.close();
  }
}
