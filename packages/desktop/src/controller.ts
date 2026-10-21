import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentAdapter, Profile } from '../../contracts/src/index.ts';
import { requireValue } from '../../core/src/model.ts';
import { LocalApp } from '../../local/src/app.ts';
import type { ClipboardPort } from '../../local/src/clipboard.ts';
import { CodexAgent, codexProfile } from '../../worker/src/codex.ts';
import { executionRegistry } from '../../worker/src/registry.ts';
import { discover } from '../../worker/src/discovery.ts';
import type { Candidate } from '../../worker/src/discovery.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
import { loadSettings, saveSettings, validate } from './settings.ts';
import type { Settings } from './settings.ts';
export function safeError(error: unknown): string { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED'; }
/** The exact allowlisted interface used by Tauri and the process E2E tests. */
export class DesktopController {
  readonly launchMode: 'codex' | 'staging' | 'legacy';
  readonly root: string; readonly app: LocalApp; settings: Settings;
  private controller = new AbortController(); private worker?: Promise<unknown>;
  private closed = false; private armed = false; private workerError?: string; private captureError?: string;
  private discovery: Candidate[] = []; private discovering?: Promise<void>;
  private preview?: string; private previewImage?: object;
  constructor(root: string, clipboard: ClipboardPort, injected?: { adapter: AgentAdapter; profile: Profile }, launchMode: 'codex' | 'staging' | 'legacy' = 'legacy') {
    this.launchMode = launchMode;
    requireValue(launchMode !== 'codex' || existsSync(join(root, 'settings.json')), 'CODEX_SETUP_REQUIRED');
    this.root = root; this.settings = loadSettings(root);
    requireValue(launchMode !== 'codex' || (this.settings.adapter === 'codex' && !injected), 'CODEX_PROFILE_REQUIRED');
    requireValue(launchMode !== 'staging' || this.settings.adapter === 'fake', 'FAKE_ACCEPTANCE_PROFILE_REQUIRED');
    const policy = this.settings.codex;
    requireValue(this.settings.adapter !== 'codex' || policy, 'MISSING_CODEX_POLICY');
    const entries = !injected && this.settings.agents ? executionRegistry(this.settings.agents.profiles) : undefined;
    const selected = entries?.find(e => e.profile.id === this.settings.agents!.selected.id && e.profile.version === this.settings.agents!.selected.version);
    this.app = new LocalApp(root, injected?.adapter ?? selected?.adapter ?? (this.settings.adapter === 'codex' ? new CodexAgent([policy!]) : new FakeAgent()),
      injected?.profile ?? selected?.profile ?? (this.settings.adapter === 'codex' ? codexProfile(policy!, false) : FAKE_PROFILE), this.settings.delivery, clipboard, entries);
  }
  private async refreshDiscovery() {
    if (this.discovering) return this.discovering;
    if (this.settings.adapter !== 'codex') return;
    this.discovering = (async () => {
      const results = await Promise.allSettled((['codex', 'claude'] as const).map(async provider => {
        const policies = this.settings.agents?.profiles.filter(p => p.provider === provider).map(p => p.policy) ?? (provider === 'codex' ? [this.settings.codex!] : []);
        const approved: Candidate[] = []; const seen = new Set<string>(); const deadline = Date.now() + 8000;
        for (const policy of policies) {
          const key = JSON.stringify([policy.program, policy.cliVersion]); if (seen.has(key)) continue; seen.add(key);
          if (Date.now() > deadline) { approved.push({ provider, path: '', status: 'scan_incomplete' }); break; }
          approved.push(...await discover(provider, policy.workspace, { approved: { program: policy.program, version: policy.cliVersion, digest: policy.digest } }));
        }
        return [...approved, ...await discover(provider, this.settings.codex!.workspace)];
      }));
      this.discovery = results.flatMap(r => r.status === 'fulfilled' ? r.value : []);
    })().finally(() => { this.discovering = undefined; });
    return this.discovering;
  }
  async start() { this.app.state.acquireWorker(); await this.app.arm(); this.armed = true; void this.refreshDiscovery(); }
  async tick() {
    if (this.closed) return;
    if (!this.captureError && this.armed && this.settings.desktop.enabled && !this.settings.desktop.paused) {
      try { await this.app.observe(this.settings.desktop.mode === 'auto'); }
      catch (error) { this.captureError = safeError(error); this.armed = false; this.app.discard(); }
    }
    if (!this.worker && !this.workerError) {
      this.worker = this.app.work(this.controller.signal).catch(error => { this.workerError = safeError(error); }).finally(() => { this.worker = undefined; });
    }
  }
  async dispatch(raw: unknown): Promise<unknown> {
    requireValue(!this.closed, 'APP_CLOSED');
    requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_REQUEST');
    const r = raw as Record<string, unknown>;
    requireValue(r.v === 1 && typeof r.command === 'string', 'INVALID_PROTOCOL');
    const allowed: Record<string, string[]> = { snapshot: [], configure: ['capture', 'delivery', 'autoConsent', 'alwaysConsent'],
      submit: [], current: [], discard: [], pause: ['paused'], copy: ['id'], detail: ['id'], 'retry-delivery': ['id'], recover: [], 'select-agent': ['id', 'version'], 'discover-agents': [], quit: [] };
    requireValue(Object.hasOwn(allowed, r.command) && Object.keys(r).every(k => ['v', 'command', ...allowed[r.command as string]].includes(k)), 'COMMAND_REFUSED');
    const id = () => { requireValue(typeof r.id === 'string' && /^[0-9a-f-]{36}$/.test(r.id), 'INVALID_TASK_ID'); return r.id; };
    switch (r.command) {
      case 'discover-agents': {
        requireValue(this.launchMode !== 'staging' && this.settings.adapter === 'codex', 'FORMAL_PROFILE_REQUIRED');
        // Inventory never changes an approved choice or performs a model request.
        await this.refreshDiscovery();
        break;
      }
      case 'select-agent': {
        requireValue(this.settings.agents && typeof r.id === 'string' && typeof r.version === 'string', 'UNAPPROVED_PROFILE');
        requireValue(this.app.registry.some(e => e.profile.id === r.id && e.profile.version === r.version), 'UNAPPROVED_PROFILE');
        const next = structuredClone(this.settings); next.agents!.selected = { id: r.id, version: r.version };
        saveSettings(this.root, next); this.app.select(r.id, r.version); this.settings = next; break;
      }
      case 'configure': {
        const next = structuredClone(this.settings);
        if (r.capture !== undefined) {
          requireValue(r.capture && typeof r.capture === 'object' && !Array.isArray(r.capture), 'INVALID_CAPTURE_SETTINGS');
          const capture = r.capture as Record<string, unknown>;
          requireValue(Object.keys(capture).every(k => ['enabled', 'mode'].includes(k)), 'INVALID_CAPTURE_SETTINGS');
          Object.assign(next.desktop, capture);
        }
        for (const key of ['autoConsent', 'alwaysConsent'] as const) {
          if (r[key] !== undefined) { requireValue(typeof r[key] === 'boolean', 'INVALID_CONSENT'); next.desktop[key] = r[key]; }
        }
        if (r.delivery !== undefined) {
          requireValue(r.delivery && typeof r.delivery === 'object' && !Array.isArray(r.delivery) && Object.keys(r.delivery).every(k => ['clipboard', 'saveDirectory', 'retry'].includes(k)), 'INVALID_DELIVERY_SETTINGS');
          next.delivery = r.delivery as Settings['delivery'];
        }
        validate(next);
        // A mode/source switch invalidates the staging slot and skips historical content.
        await this.app.arm(); saveSettings(this.root, next); this.settings = next;
        for (const key of Object.keys(this.app.config)) delete (this.app.config as unknown as Record<string, unknown>)[key];
        Object.assign(this.app.config, next.delivery); this.armed = true; this.captureError = undefined;
        break;
      }
      case 'pause':
        requireValue(typeof r.paused === 'boolean', 'INVALID_PAUSE');
        { const next = structuredClone(this.settings); next.desktop.paused = r.paused;
          await this.app.arm(); saveSettings(this.root, next); this.settings = next; this.armed = true; this.captureError = undefined; } break;
      case 'submit':
        requireValue(this.app.pending, 'NO_PENDING_IMAGE'); await this.app.capture(); break;
      case 'current': await this.app.capture(false, true); break;
      case 'discard': this.app.discard(); break;
      case 'copy': await this.app.copy(id()); break;
      case 'retry-delivery': await this.app.retryDelivery(id()); break;
      case 'detail': {
        const task = this.app.get(id()); return { id: task.submission.taskId, status: task.status, provider: task.submission.provider, profileId: task.submission.profileId, profileVersion: task.submission.profileVersion, profileFingerprint: task.submission.profileFingerprint, result: task.result ? { contentMarkdown: task.result.contentMarkdown, summary: task.result.summary, errorCode: task.result.errorCode } : undefined, attempts: task.attempts };
      }
      case 'recover':
        // Explicit re-arm, never blindly restart a dead helper or an unconfirmed Agent.
        requireValue(!this.workerError, 'RESTART_APP_AFTER_CHECKING_AGENT'); await this.start(); this.captureError = undefined; break;
      case 'quit': await this.close(); return { stopped: true };
    }
    return this.snapshot();
  }
  private async snapshot() {
    const image = this.app.pending;
    if (image !== this.previewImage) {
      this.previewImage = image;
      this.preview = image ? `data:image/png;base64,${(await sharp(image.bytes).resize({ width: 420, height: 220, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64')}` : undefined;
    }
    const tasks = this.app.list();
    return { settings: this.settings.desktop, delivery: this.settings.delivery, root: this.root, launchMode: this.launchMode,
      agents: this.app.registry.map(e => {
        const policy = this.settings.agents?.profiles.find(p => p.policy.id === e.profile.id && p.policy.version === e.profile.version)?.policy ?? this.settings.codex;
        return { id: e.profile.id, version: e.profile.version, provider: e.adapter.name, fingerprint: e.profile.fingerprint, path: policy?.program.args[0] ?? policy?.program.executable, cliVersion: policy?.cliVersion, status: e.adapter.name === 'claude' && !('imageProtocol' in (policy ?? {})) ? 'image_protocol_not_verified' : 'unverified_auth' };
      }), discovery: this.discovery,
      profile: { adapter: this.app.registry.find(e => e.profile === this.app.profile)?.adapter.name ?? this.settings.adapter, id: this.app.profile.id, profileVersion: this.app.profile.version, workspace: this.settings.agents?.profiles.find(p => p.policy.id === this.app.profile.id && p.policy.version === this.app.profile.version)?.policy.workspace ?? this.settings.codex?.workspace, version: this.settings.agents?.profiles.find(p => p.policy.id === this.app.profile.id && p.policy.version === this.app.profile.version)?.policy.cliVersion ?? this.settings.codex?.cliVersion, sandbox: 'read-only' },
      status: this.workerError ? 'worker_error' : this.captureError ? 'capture_error' : this.settings.desktop.paused ? 'paused' : !this.settings.desktop.enabled ? 'capture_off' : 'monitoring',
      error: this.workerError ?? this.captureError, pending: this.preview ?? null, captureStatus: this.app.lastCaptureStatus,
      total: tasks.length, tasks: tasks.slice(-50).reverse().map(t => ({ id: t.submission.taskId, status: t.status, provider: t.submission.provider ?? t.attempts[0]?.adapterName, profileId: t.submission.profileId, profileVersion: t.submission.profileVersion, summary: t.result?.summary, error: t.result?.errorCode ?? (t.status === 'queued' && !this.app.registry.some(e => e.profile.id === t.submission.profileId && e.profile.version === t.submission.profileVersion) ? 'PROFILE_UNAVAILABLE' : undefined),
        save: this.app.state.get(t.submission.taskId, 'save'), clipboard: this.app.state.get(t.submission.taskId, 'clipboard') })) };
  }
  async close() {
    if (this.closed) return; this.closed = true; this.controller.abort();
    await this.worker; await this.discovering; this.app.close();
  }
}
