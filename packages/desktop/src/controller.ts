import { fileCacheUsage } from '../../local/src/file-cache.ts';
import { APP_VERSION } from './version.ts';
import { RemoteQueue, remoteDefaults, validateRemote } from './remote.ts';
import { RemoteClient } from '../../../services/relay/src/client.ts';
import { FolderSource, validateCaptureFolder } from './folder.ts';
import { displayInventory } from './inventory.ts';
import { ACTIONS, completedResults, retryableDelivery, retryableChannels, validateHotkeys } from './actions.ts';
import { trayView } from './tray.ts';
import sharp from 'sharp';
import { effectiveDelivery } from '../../local/src/delivery.ts';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentAdapter, Profile } from '../../contracts/src/index.ts';
import { requireValue } from '../../core/src/model.ts';
import { LocalApp, readImageFile, validateLocalImage } from '../../local/src/app.ts';
import type { ClipboardPort } from '../../local/src/clipboard.ts';
import { CodexAgent, codexProfile } from '../../worker/src/codex.ts';
import type { CodexPolicy } from '../../worker/src/codex.ts';
import { claudeProfile } from '../../worker/src/claude.ts';
import type { ClaudePolicy } from '../../worker/src/claude.ts';
import { executionRegistry } from '../../worker/src/registry.ts';
import type { ApprovedPolicy } from '../../worker/src/registry.ts';
import { discover, inspectCandidate } from '../../worker/src/discovery.ts';
import type { Candidate } from '../../worker/src/discovery.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
import { deleteGatewayToken, readGatewayToken, saveGatewayToken, validateGateway } from '../../worker/src/gateway.ts';
import type { GatewayConfig } from '../../worker/src/gateway.ts';
import { testGatewayVision } from '../../worker/src/gateway-test.ts';
import type { GatewayTestResult } from '../../worker/src/gateway-test.ts';
import { loadSettings, saveSettings, validate } from './settings.ts';
import type { Settings } from './settings.ts';
export function safeError(error: unknown): string { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED'; }
const DEFAULT_PROMPT = 'Analyze the screenshot and return a concise, useful Markdown explanation.';
export interface DesktopCredentialStore {
  save(reference: string, token: string): Promise<void>;
  read(reference: string): Promise<string>;
  delete(reference: string): Promise<void>;
}
export type GatewayVisionTest = (gateway: GatewayConfig, token: string) => Promise<GatewayTestResult>;
function profileKey(id: string, version: string) { return `${id}:${version}`; }
function validateWorkspace(path: string): string {
  requireValue(typeof path === 'string' && path.length <= 2048 && !path.startsWith('\\\\') && !path.startsWith('//'), 'UNAPPROVED_WORKSPACE');
  let actual: string; let info;
  try { actual = realpathSync(path); info = lstatSync(actual); }
  catch { throw new Error('WORKSPACE_PATH_UNAVAILABLE'); }
  requireValue(actual === path && info.isDirectory() && !info.isSymbolicLink(), 'UNAPPROVED_WORKSPACE');
  return actual;
}
/** The exact allowlisted interface used by Tauri and the process E2E tests. */
export class DesktopController {
  readonly launchMode: 'codex' | 'staging' | 'legacy';
  readonly root: string; readonly app: LocalApp; settings: Settings;
  private controller = new AbortController(); private worker?: Promise<unknown>;
  private closed = false; private armed = false; private workerError?: string; private captureError?: string;
  private readonly inventory: typeof discover;
  private discovery: Candidate[] = []; private discovering?: Promise<void>;
  private lastAction?: { action: string; status: string; at: number };
  private lastHistoryCleanup?: { deleted: number; preservedActive: number; preservedUnknown: number };
  private credentialStatuses = new Map<string, 'unchecked' | 'available' | 'missing'>();
  private gatewayTests = new Map<string, 'synthetic_test_passed' | 'not_tested' | 'previously_attested'>();
  private actionBusy = false;
  private folder = new FolderSource();
  private composer: { id: string; bytes: Buffer; preview: string }[] = [];
  private preview?: string; private previewImage?: object;
  private credentials: DesktopCredentialStore;
  private testGateway: GatewayVisionTest;
  readonly remote: RemoteQueue;
  private remoteConnection?: { url: string; reference: string; client: RemoteClient };
  private remoteSync?: Promise<void>; private nextRemoteSync = 0;
  constructor(root: string, clipboard: ClipboardPort, injected?: { adapter: AgentAdapter; profile: Profile }, launchMode: 'codex' | 'staging' | 'legacy' = 'legacy', inventory: typeof discover = discover,
    dependencies: { credentials?: DesktopCredentialStore; testGateway?: GatewayVisionTest } = {}) {
    this.launchMode = launchMode; this.inventory = inventory;
    this.root = root; this.settings = loadSettings(root);
    this.remote = new RemoteQueue(root);
    requireValue(launchMode !== 'staging' || this.settings.adapter === 'fake', 'FAKE_ACCEPTANCE_PROFILE_REQUIRED');
    this.credentials = dependencies.credentials ?? { save: saveGatewayToken, read: readGatewayToken, delete: deleteGatewayToken };
    this.testGateway = dependencies.testGateway ?? testGatewayVision;
    const policy = this.settings.codex;
    const entries = !injected && this.settings.agents ? executionRegistry(this.settings.agents.profiles) : undefined;
    const selected = entries?.find(e => e.profile.id === this.settings.agents!.selected.id && e.profile.version === this.settings.agents!.selected.version);
    const legacyEntry = !injected && !entries && policy ? { adapter: new CodexAgent([policy]), profile: codexProfile(policy, false) } : undefined;
    const fallback = { adapter: injected?.adapter ?? legacyEntry?.adapter ?? new FakeAgent(), profile: injected?.profile ?? legacyEntry?.profile ?? FAKE_PROFILE };
    const registry = entries ?? (legacyEntry ? [legacyEntry] : undefined);
    this.app = new LocalApp(root, injected?.adapter ?? selected?.adapter ?? fallback.adapter,
      injected?.profile ?? selected?.profile ?? fallback.profile,
      // A fresh desktop preselects Always, but cannot write until overwrite consent.
      effectiveDelivery(this.settings), clipboard, registry, this.remotePort());
    for (const profile of this.settings.agents?.profiles ?? []) {
      const gateway = profile.provider === 'claude-compatible-endpoint' ? profile.policy.gateway : undefined;
      if (gateway) this.gatewayTests.set(gateway.credentialRef,
        gateway.vision === 'synthetic-test-passed' ? 'synthetic_test_passed' : gateway.vision === 'operator-attested' ? 'previously_attested' : 'not_tested');
    }
  }
  private async refreshDiscovery() {
    if (this.discovering) return this.discovering;
    if (this.launchMode === 'staging') return;
    this.discovering = (async () => {
      const workspace = this.settings.agents?.profiles[0]?.policy.workspace ?? this.settings.codex?.workspace ?? homedir();
      const results = await Promise.allSettled((['codex', 'claude'] as const).map(provider => this.inventory(provider, workspace)));
      this.discovery = displayInventory(results.flatMap(r => r.status === 'fulfilled' ? r.value : []));
    })().finally(() => { this.discovering = undefined; });
    return this.discovering;
  }
  private isLocalConfigured() { return this.launchMode !== 'codex' || !!(this.settings.agents?.profiles.length || this.settings.codex); }
  private isConfigured() { return this.settings.remote?.mode === 'remote' ? !!(this.settings.remote.identity && this.settings.remote.target && this.settings.remote.credentialRef) : this.isLocalConfigured(); }
  private remotePort(): LocalApp['remote'] {
    const settings = structuredClone(this.settings.remote ?? remoteDefaults()); const queue = this.remote;
    return { enabled: () => settings.mode === 'remote', binding: () => {
      requireValue(settings.target, 'REMOTE_SETUP_REQUIRED'); const t = settings.target;
      return { profileId: t.id, profileVersion: t.version, profileFingerprint: t.fingerprint, provider: t.provider, targetWorkerId: t.deviceId };
    }, enqueue: (metadata, images) => queue.enqueue(settings, metadata, images), list: () => queue.list(), get: id => queue.get(id), delete: ids => queue.delete(ids) };
  }
  private async remoteClient(settings = this.settings.remote): Promise<RemoteClient> {
    requireValue(settings?.url && settings.credentialRef, 'REMOTE_SETUP_REQUIRED');
    if (this.remoteConnection?.url === settings.url && this.remoteConnection.reference === settings.credentialRef) return this.remoteConnection.client;
    const client = new RemoteClient(settings.url, await this.credentials.read(settings.credentialRef), this.controller.signal);
    this.remoteConnection = { url: settings.url, reference: settings.credentialRef, client }; return client;
  }
  private remoteRegistry() { return this.isLocalConfigured() ? this.app.registry : []; }
  private remoteCapabilities() {
    const selectable = this.settings.agents || this.settings.codex ? this.selectableProfileKeys() : undefined;
    return this.remoteRegistry().map(e => ({ id: e.profile.id, version: e.profile.version, fingerprint: e.profile.fingerprint, provider: e.adapter.name,
      selectable: !selectable || selectable.has(profileKey(e.profile.id, e.profile.version)),
      isDefault: e.profile.id === this.app.profile.id && e.profile.version === this.app.profile.version }));
  }
  private async syncRemote() {
    const settings = structuredClone(this.settings.remote);
    if (!settings?.credentialRef || !settings.url || !settings.identity) return;
    try {
      const client = await this.remoteClient(settings); const registry = this.remoteRegistry();
      await client.presence(settings.label, this.remoteCapabilities(), settings.receive && registry.length > 0);
      await this.remote.sync(settings, client);
    } catch (e) { this.remote.status = 'disconnected'; this.remote.error = safeError(e) === 'LOCAL_OPERATION_FAILED' ? 'REMOTE_NETWORK_UNAVAILABLE' : safeError(e); }
  }
  private currentPolicy(): ApprovedPolicy | undefined {
    const selected = this.settings.agents?.selected;
    if (selected) return this.settings.agents?.profiles.find(p => p.policy.id === selected.id && p.policy.version === selected.version);
    return this.settings.codex ? { provider: 'codex', policy: this.settings.codex } : undefined;
  }
  private latestProfiles(): Map<string, ApprovedPolicy> {
    const latest = new Map<string, ApprovedPolicy>();
    for (const profile of this.settings.agents?.profiles ?? (this.settings.codex ? [{ provider: 'codex' as const, policy: this.settings.codex }] : []))
      if (!this.isArchived(profile.policy.id, profile.policy.version)) latest.set(profile.policy.id, profile);
    return latest;
  }
  private selectableProfileKeys(): Set<string> { return new Set([...this.latestProfiles().values()].map(p => profileKey(p.policy.id, p.policy.version))); }
  private referencedProfileKeys(): Set<string> {
    return new Set(this.app.list().map(task => profileKey(task.submission.profileId, task.submission.profileVersion)));
  }
  private async refreshSelectedCredential() {
    const profile = this.currentPolicy(); const gateway = profile?.provider === 'claude-compatible-endpoint' ? profile.policy.gateway : undefined;
    if (!gateway) return;
    try { await this.credentials.read(gateway.credentialRef); this.credentialStatuses.set(gateway.credentialRef, 'available'); }
    catch { this.credentialStatuses.set(gateway.credentialRef, 'missing'); }
  }
  private async drainCredentialCleanup() {
    for (const reference of this.settings.credentialCleanup ?? []) {
      try {
        await this.credentials.delete(reference);
        const next = structuredClone(this.settings); next.credentialCleanup = (next.credentialCleanup ?? []).filter(ref => ref !== reference);
        saveSettings(this.root, next); this.settings = next; this.credentialStatuses.delete(reference); this.gatewayTests.delete(reference);
      } catch { /* Persistent queue is retried on the next app start or explicit cleanup. */ }
    }
  }
  async start() {
    this.app.state.acquireWorker(); this.remote.recover(this.root); await this.app.arm(); this.armed = true;
    try { this.armFolder(this.settings); } catch { this.folder.arm(); this.folder.error = 'CAPTURE_FOLDER_UNAVAILABLE'; }
    void this.refreshDiscovery(); void this.refreshSelectedCredential(); void this.drainCredentialCleanup();
  }
  private async createProfile(request: Record<string, unknown>) {
    requireValue(this.launchMode === 'codex', 'FORMAL_PROFILE_REQUIRED');
    const provider = request.provider;
    requireValue(provider === 'codex' || provider === 'claude' || provider === 'claude-compatible-endpoint', 'INVALID_PROVIDER');
    const cliProvider = provider === 'codex' ? 'codex' : 'claude';
    const editId = request.editId; const editVersion = request.editVersion;
    const editing = typeof editId === 'string' && typeof editVersion === 'string'
      ? this.settings.agents?.profiles.find(p => p.policy.id === editId && p.policy.version === editVersion) : undefined;
    requireValue((editId === undefined && editVersion === undefined) || !!editing, 'PROFILE_NOT_FOUND');
    const reuseExisting = request.reuseExisting === true;
    requireValue(!reuseExisting || (!!editing && (editing.provider === provider || (editing.provider !== 'codex' && provider !== 'codex'))), 'PROFILE_NOT_FOUND');
    const requestedWorkspace = String(request.workspace ?? '');
    if (requestedWorkspace === this.workspaceSuggestion() && !existsSync(requestedWorkspace)) {
      try { mkdirSync(requestedWorkspace, { recursive: true }); }
      catch { throw new Error('WORKSPACE_CREATE_FAILED'); }
    }
    const workspace = validateWorkspace(requestedWorkspace);
    requireValue(reuseExisting || (typeof request.path === 'string' && request.path.length <= 2048), 'CLI_PATH_REQUIRED');
    const candidate = reuseExisting
      ? await inspectCandidate(cliProvider, editing!.policy.program.executable, workspace,
        { version: editing!.policy.cliVersion, digest: editing!.policy.digest }, editing!.policy.program)
      : await inspectCandidate(cliProvider, request.path as string, workspace);
    requireValue(candidate.status === 'unverified_auth' && candidate.program && candidate.digest && candidate.version, 'CLI_NOT_USABLE');
    const id = request.id;
    requireValue(typeof id === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(id), 'INVALID_PROFILE_ID');
    requireValue(!this.settings.agents?.profiles.some(p => p.policy.id === id && id !== editing?.policy.id), 'PROFILE_NAME_EXISTS');
    const prompt = typeof request.prompt === 'string' && request.prompt.trim() ? request.prompt.trim() : DEFAULT_PROMPT;
    requireValue(prompt.length <= 10_000, 'INVALID_PROFILE_PROMPT');
    const version = `m7-${randomUUID().slice(0, 8)}`;
    const common = { id, version, workspace, program: candidate.program, cliVersion: candidate.version, timeoutMs: 180_000, prompt, digest: candidate.digest };
    let approved: ApprovedPolicy;
    let credentialRef: string | undefined;
    let credentialSaved = false;
    let syntheticTestPassed = false;
    let operationStage = 'PROFILE_SETTINGS_SAVE_FAILED';
    try {
      if (provider === 'claude-compatible-endpoint') {
        requireValue(['2.1.305 (Claude Code)', '2.1.306 (Claude Code)'].includes(candidate.version), 'GATEWAY_CLI_NOT_QUALIFIED');
        const endpoint = request.endpoint;
        const model = request.model;
        requireValue(typeof endpoint === 'string' && typeof model === 'string', 'GATEWAY_CONFIGURATION_REQUIRED');
        const existing = editing;
        const existingGateway = existing?.provider === 'claude-compatible-endpoint' ? existing.policy.gateway : undefined;
        const tokenInput = typeof request.token === 'string' ? request.token.trim() : '';
        credentialRef = tokenInput ? `Shot2Agent-Gateway-${randomUUID()}` : existingGateway?.credentialRef;
        requireValue(credentialRef, 'GATEWAY_TOKEN_REQUIRED');
        operationStage = 'GATEWAY_CREDENTIAL_STORE_FAILED';
        let token: string;
        if (tokenInput) {
          // Verify the local secure store before making the potentially billable request.
          await this.credentials.save(credentialRef, tokenInput);
          credentialSaved = true;
          token = await this.credentials.read(credentialRef);
          requireValue(token === tokenInput, 'GATEWAY_CREDENTIAL_VERIFY_FAILED');
        } else token = await this.credentials.read(credentialRef);
        const gateway: GatewayConfig = { kind: 'claude-compatible-endpoint', baseUrl: endpoint, model,
          models: { sonnet: model, opus: model, haiku: model }, credentialRef, vision: 'not-verified' };
        validateGateway(gateway);
        // Saving credentials is local-only. Qualification survives only an unchanged connection.
        if (!tokenInput && existingGateway?.baseUrl === endpoint && existingGateway.model === model)
          gateway.vision = existingGateway.vision;
        if (request.enableAfterTest === true) {
          operationStage = 'GATEWAY_SYNTHETIC_TEST_FAILED';
          await this.testGateway(gateway, token);
          syntheticTestPassed = true;
          gateway.vision = 'synthetic-test-passed';
        }
        const policy: ClaudePolicy = { ...common, gateway,
          ...(['2.1.305 (Claude Code)', '2.1.306 (Claude Code)'].includes(candidate.version) ? { imageProtocol: 'windows-jsonl-v1' } : {}) };
        claudeProfile(policy);
        approved = { provider, policy };
      } else if (provider === 'claude') {
        requireValue(['2.1.305 (Claude Code)', '2.1.306 (Claude Code)'].includes(candidate.version), 'CLAUDE_IMAGE_PROTOCOL_NOT_VERIFIED');
        const policy: ClaudePolicy = { ...common, imageProtocol: 'windows-jsonl-v1' };
        claudeProfile(policy); approved = { provider, policy };
      } else {
        const policy: CodexPolicy = { ...common };
        codexProfile(policy); approved = { provider, policy };
      }
      const next = structuredClone(this.settings);
      const profiles = next.agents?.profiles ?? (next.codex ? [{ provider: 'codex' as const, policy: next.codex }] : []);
      profiles.push(approved);
      next.adapter = 'codex';
      if (provider === 'codex' && !next.codex) next.codex = approved.policy as CodexPolicy;
      const selected = editing && next.agents && (next.agents.selected.id !== editId || next.agents.selected.version !== editVersion)
        ? next.agents.selected : { id, version };
      next.agents = { version: 1, selected, profiles, archived: next.agents?.archived ?? [] };
      const registry = executionRegistry(profiles);
      // Fresh installs preselect Always, but leave capture disabled and require consent before writing.
      validate(next, true);
      operationStage = 'PROFILE_SETTINGS_SAVE_FAILED';
      saveSettings(this.root, next);
      this.settings = next; this.app.setRegistry(registry, selected.id, selected.version);
      if (credentialRef) {
        this.credentialStatuses.set(credentialRef, 'available');
        this.gatewayTests.set(credentialRef, syntheticTestPassed ? 'synthetic_test_passed' : approved.provider === 'claude-compatible-endpoint' && approved.policy.gateway?.vision !== 'not-verified' ? 'previously_attested' : 'not_tested');
      }
      await this.refreshDiscovery();
      return { provider, id, version, gateway: syntheticTestPassed ? 'synthetic_test_passed' : undefined };
    } catch (error) {
      if (credentialSaved && credentialRef) await this.credentials.delete(credentialRef).catch(() => {});
      if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) throw error;
      throw new Error(operationStage, { cause: error });
    }
  }
  private async removeProfiles(keys: readonly string[]) {
    requireValue(this.settings.agents && keys.length > 0 && new Set(keys).size === keys.length, 'PROFILE_NOT_FOUND');
    const profiles = this.settings.agents.profiles;
    const latest = this.selectableProfileKeys(); const referenced = this.referencedProfileKeys();
    if (this.settings.remote?.credentialRef && this.settings.remote.identity) {
      // A version still queued on the Relay is as immutable as a Local queued version.
      try {
        const client = await this.remoteClient(); let cursor: string | undefined;
        do {
          const page = await client.list(cursor);
          for (const task of page.tasks) if (task.submission.targetWorkerId === this.settings.remote.identity.deviceId &&
            ['queued', 'leased', 'running', 'execution_unknown'].includes(task.status)) referenced.add(profileKey(task.submission.profileId, task.submission.profileVersion));
          cursor = page.nextCursor;
        } while (cursor);
      } catch { throw new Error('REMOTE_PROFILE_REFERENCES_UNAVAILABLE'); }
    }
    const selected = this.settings.agents.selected;
    const removed = profiles.filter(profile => keys.includes(profileKey(profile.policy.id, profile.policy.version)));
    requireValue(removed.length === keys.length, 'PROFILE_NOT_FOUND');
    for (const profile of removed) {
      const key = profileKey(profile.policy.id, profile.policy.version);
      const archived = this.isArchived(profile.policy.id, profile.policy.version);
      requireValue(!(profile.policy.id === selected.id && profile.policy.version === selected.version), 'SELECT_ANOTHER_PROFILE_FIRST');
      requireValue(!referenced.has(key), 'PROFILE_REFERENCED_BY_TASK');
      requireValue(!latest.has(key) || archived, 'PROFILE_IS_ACTIVE_CONFIGURATION');
    }
    requireValue(profiles.length > removed.length, 'LAST_PROFILE_CANNOT_BE_DELETED');
    const remaining = profiles.filter(profile => !keys.includes(profileKey(profile.policy.id, profile.policy.version)));
    const remainingCredentials = new Set(remaining.flatMap(profile => profile.provider === 'claude-compatible-endpoint' && profile.policy.gateway ? [profile.policy.gateway.credentialRef] : []));
    const cleanup = removed.flatMap(profile => profile.provider === 'claude-compatible-endpoint' && profile.policy.gateway && !remainingCredentials.has(profile.policy.gateway.credentialRef) ? [profile.policy.gateway.credentialRef] : []);
    const next = structuredClone(this.settings);
    next.agents!.profiles = remaining;
    next.agents!.archived = (next.agents!.archived ?? []).filter(profile => !keys.includes(profileKey(profile.id, profile.version)));
    next.credentialCleanup = [...new Set([...(next.credentialCleanup ?? []), ...cleanup])];
    if (next.codex && removed.some(profile => profile.provider === 'codex' && JSON.stringify(profile.policy) === JSON.stringify(next.codex))) delete next.codex;
    const registry = executionRegistry(remaining);
    validate(next, true); saveSettings(this.root, next);
    this.settings = next; this.app.setRegistry(registry, selected.id, selected.version);
    await this.drainCredentialCleanup();
    return { removed: removed.length, credentialCleanupPending: this.settings.credentialCleanup?.length ?? 0 };
  }
  private workspaceSuggestion(): string {
    return this.settings.agents?.profiles[0]?.policy.workspace ?? this.settings.codex?.workspace ?? join(process.env.LOCALAPPDATA ?? homedir(), 'Shot2Agent-Workspace');
  }
  private armFolder(settings: Settings) {
    const directory = settings.desktop.folderEnabled && !settings.desktop.paused ? settings.desktop.folderDirectory : undefined;
    if (directory) validateCaptureFolder(directory, [this.root, ...(settings.delivery.saveDirectory ? [settings.delivery.saveDirectory] : [])]);
    const next = new FolderSource(); next.arm(directory); this.folder = next;
  }
  private async addComposer(inputs: Buffer[]) {
    requireValue(inputs.length > 0 && this.composer.length + inputs.length <= 5, 'BATCH_IMAGE_COUNT');
    requireValue(this.composer.reduce((n, i) => n + i.bytes.length, 0) + inputs.reduce((n, b) => n + b.length, 0) <= 60 * 1024 * 1024, 'BATCH_OVER_60_MIB');
    const additions = [];
    for (const bytes of inputs) {
      const prepared = await validateLocalImage(bytes);
      additions.push({ id: randomUUID(), bytes: Buffer.from(prepared.bytes), preview: `data:image/png;base64,${(await sharp(prepared.bytes).resize({ width: 180, height: 120, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64')}` });
    }
    this.composer.push(...additions);
  }
  async tick() {
    if (this.closed) return;
    if (!this.remoteSync && Date.now() >= this.nextRemoteSync && this.settings.remote?.credentialRef && (this.settings.remote.mode === 'remote' || this.settings.remote.receive || this.remote.hasPending())) {
      this.nextRemoteSync = Date.now() + 3000;
      this.remoteSync = this.syncRemote().finally(() => { this.remoteSync = undefined; });
    }
    if (this.isConfigured() && !this.captureError && this.armed && (this.settings.desktop.enabled || this.settings.desktop.folderEnabled) && !this.settings.desktop.paused) {
      try {
        const auto = this.settings.desktop.mode === 'auto';
        if (this.settings.desktop.enabled) await this.app.observe(auto);
        if (this.settings.desktop.folderEnabled) await this.folder.poll(async bytes => {
          const sequence = await this.app.clipboard!.sequence();
          await this.app.ingest(bytes, auto, { session: this.app.clipboard!.session, sequence }, 'folder');
        });
      }
      catch (error) { this.captureError = safeError(error); this.armed = false; this.app.discard(); }
    }
    if (!this.worker && !this.workerError) {
      this.worker = (async () => {
        if (await this.app.work(this.controller.signal)) return;
        if (this.settings.remote?.receive && this.remote.status === 'connected' && this.remoteRegistry().length) {
          try { await this.app.work(this.controller.signal, await this.remoteClient(), this.remoteRegistry()); }
          catch (error) {
            if (safeError(error) === 'AGENT_STOP_UNCONFIRMED') throw error;
            this.remote.error = safeError(error); this.remote.status = 'disconnected';
          }
        }
      })().catch(error => { this.workerError = safeError(error); }).finally(() => { this.worker = undefined; });
    }
  }
  async dispatch(raw: unknown): Promise<unknown> {
    requireValue(!this.closed, 'APP_CLOSED');
    requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), 'INVALID_REQUEST');
    const r = raw as Record<string, unknown>;
    requireValue(r.v === 1 && typeof r.command === 'string', 'INVALID_PROTOCOL');
    const allowed: Record<string, string[]> = { 'remote-configure': ['mode', 'url', 'label', 'receive', 'token'], 'remote-delete-token': [], 'remote-test': [], 'remote-select': ['deviceId', 'id', 'version'], 'remote-retry': [], 'staging-fault': ['kind'], snapshot: ['offset', 'query'], 'configure-hotkeys': ['hotkeys'], action: ['action'], configure: ['capture', 'delivery', 'autoConsent', 'alwaysConsent'],
      'composer-add-files': ['paths'], 'composer-add-clipboard': [], 'composer-add-pending': [], 'composer-move': ['index', 'to'], 'composer-remove': ['index'], 'composer-discard': [], 'composer-submit': [], 'copy-files': ['id'], 'clean-file-cache': ['confirm'],
      submit: [], current: [], discard: [], pause: ['paused'], copy: ['id'], detail: ['id'], 'retry-delivery': ['id'], recover: [], 'select-agent': ['id', 'version'],
      'archive-agent': ['id', 'version', 'archived', 'confirm'], 'delete-agent': ['id', 'version', 'confirm'], 'cleanup-unused-agents': [],
      'create-profile': ['provider', 'id', 'path', 'workspace', 'prompt', 'endpoint', 'model', 'token', 'editId', 'editVersion', 'reuseExisting', 'enableAfterTest'], 'credential-status': ['id', 'version'], 'test-agent': ['id', 'version', 'confirm'],
      'delete-history': ['ids', 'reviewedUnknown'], 'clear-history': ['mode'], 'discover-agents': [], quit: [] };
    requireValue(Object.hasOwn(allowed, r.command) && Object.keys(r).every(k => ['v', 'command', ...allowed[r.command as string]].includes(k)), 'COMMAND_REFUSED');
    const id = () => { requireValue(typeof r.id === 'string' && /^[0-9a-f-]{36}$/.test(r.id), 'INVALID_TASK_ID'); return r.id; };
    if (r.command === 'snapshot') {
      requireValue(r.offset === undefined || (Number.isSafeInteger(r.offset) && Number(r.offset) >= 0), 'INVALID_HISTORY_PAGE');
      requireValue(r.query === undefined || (typeof r.query === 'string' && r.query.length <= 200), 'INVALID_HISTORY_QUERY');
      return this.snapshot(Number(r.offset ?? 0), String(r.query ?? ''));
    }
    switch (r.command) {
      case 'remote-configure': {
        await this.remoteSync;
        requireValue(!this.worker || (r.url === undefined && r.token === undefined), 'REMOTE_WAIT_FOR_IDLE');
        const next = structuredClone(this.settings); const remote = next.remote ?? remoteDefaults(); const oldRef = remote.credentialRef;
        for (const key of ['mode', 'url', 'label', 'receive'] as const) if (r[key] !== undefined) (remote as unknown as Record<string, unknown>)[key] = r[key];
        if (typeof remote.url === 'string') remote.url = remote.url.trim();
        if (typeof remote.label === 'string') remote.label = remote.label.trim();
        if (remote.url !== this.settings.remote?.url) { delete remote.identity; delete remote.target; }
        const token = typeof r.token === 'string' ? r.token.trim() : r.token;
        if (r.token !== undefined) {
          requireValue(typeof token === 'string' && /^[\x21-\x7e]{32,256}$/.test(token), 'INVALID_REMOTE_TOKEN');
          remote.credentialRef = `Shot2Agent-Relay-${randomUUID()}`;
        }
        validateRemote(remote);
        if (r.token !== undefined) {
          let stage = 'REMOTE_TOKEN_SAVE_FAILED';
          try {
            await this.credentials.save(remote.credentialRef!, token as string);
            stage = 'REMOTE_TOKEN_VERIFY_FAILED';
            requireValue(await this.credentials.read(remote.credentialRef!) === token, stage);
          } catch {
            await this.credentials.delete(remote.credentialRef!).catch(() => {});
            throw new Error(stage);
          }
        }
        next.remote = remote;
        try { saveSettings(this.root, next); } catch { if (remote.credentialRef !== oldRef && remote.credentialRef) await this.credentials.delete(remote.credentialRef).catch(() => {}); throw new Error('REMOTE_SETTINGS_SAVE_FAILED'); }
        const connectionChanged = remote.url !== this.settings.remote?.url || r.token !== undefined;
        this.settings = next; this.app.remote = this.remotePort(); this.nextRemoteSync = 0;
        if (connectionChanged) { this.remoteConnection = undefined; this.remote.status = 'disconnected'; }
        if (oldRef && oldRef !== remote.credentialRef) await this.credentials.delete(oldRef);
        break;
      }
      case 'remote-delete-token': {
        await this.remoteSync; requireValue(!this.worker, 'REMOTE_WAIT_FOR_IDLE');
        const next = structuredClone(this.settings); const reference = next.remote?.credentialRef;
        if (reference) await this.credentials.delete(reference);
        if (next.remote) { delete next.remote.credentialRef; next.remote.receive = false; next.remote.mode = 'local'; }
        saveSettings(this.root, next); this.settings = next; this.app.remote = this.remotePort(); this.remoteConnection = undefined; this.remote.status = 'unconfigured'; this.remote.lastSync = undefined; this.remote.error = undefined; this.remote.workers = []; break;
      }
      case 'remote-test': {
        await this.remoteSync;
        const client = await this.remoteClient(); const session = await client.session(); requireValue(session.role === 'desktop', 'REMOTE_DESKTOP_TOKEN_REQUIRED');
        const next = structuredClone(this.settings); next.remote!.identity = { ownerId: session.ownerId, deviceId: session.deviceId };
        saveSettings(this.root, next); this.settings = next; this.app.remote = this.remotePort();
        await this.syncRemote(); requireValue(this.remote.status === 'connected', this.remote.error ?? 'REMOTE_NETWORK_UNAVAILABLE');
        this.remote.retry(); this.nextRemoteSync = 0; break;
      }
      case 'remote-select': {
        requireValue(r.deviceId !== this.settings.remote?.identity?.deviceId, 'REMOTE_OTHER_DEVICE_REQUIRED');
        const device = this.remote.workers.find(w => w.deviceId === r.deviceId); const profile = device?.profiles.find(p => p.id === r.id && p.version === r.version);
        requireValue(device && profile, 'UNAPPROVED_TARGET');
        const next = structuredClone(this.settings); requireValue(next.remote?.identity, 'REMOTE_SETUP_REQUIRED');
        next.remote.target = { deviceId: device.deviceId, ...profile }; saveSettings(this.root, next); this.settings = next; this.app.remote = this.remotePort(); break;
      }
      case 'remote-retry': this.remote.retry(); this.nextRemoteSync = 0; break;
      case 'configure-hotkeys': {
        validateHotkeys(r.hotkeys);
        const next = structuredClone(this.settings); next.hotkeys = r.hotkeys;
        try { saveSettings(this.root, next); }
        catch { throw new Error('HOTKEY_SETTINGS_SAVE_FAILED'); }
        this.settings = next; break;
      }
      case 'action': {
        requireValue(ACTIONS.includes(r.action as typeof ACTIONS[number]), 'ACTION_REFUSED');
        requireValue(!this.actionBusy, 'ACTION_IN_PROGRESS'); this.actionBusy = true;
        try {
          switch (r.action) {
            case 'toggle-pause': await this.dispatch({ v: 1, command: 'pause', paused: !this.settings.desktop.paused }); break;
            case 'copy-latest': {
              const task = completedResults(this.app)[0]; requireValue(task, 'NO_COMPLETED_RESULT');
              await this.app.copy(task.submission.taskId); break;
            }
            case 'retry-latest-delivery': {
              const task = completedResults(this.app).find(t => retryableDelivery(this.app, t));
              requireValue(task, 'NO_ELIGIBLE_FAILED_DELIVERY');
              await this.app.retryDelivery(task.submission.taskId, retryableChannels(this.app, task));
              requireValue(!retryableDelivery(this.app, this.app.get(task.submission.taskId)), 'DELIVERY_STILL_FAILED'); break;
            }
            case 'cycle-agent': {
              const selectable = this.selectableProfileKeys();
              const available = this.app.registry.filter(e => selectable.has(profileKey(e.profile.id, e.profile.version)));
              requireValue(this.settings.agents && available.length > 1, 'NO_OTHER_APPROVED_AGENT');
              const index = available.findIndex(e => e.profile.id === this.app.profile.id && e.profile.version === this.app.profile.version);
              const next = available[(index + 1) % available.length].profile;
              await this.dispatch({ v: 1, command: 'select-agent', id: next.id, version: next.version }); break;
            }
            case 'current': requireValue(this.isConfigured(), 'AGENT_SETUP_REQUIRED'); await this.app.capture(true, true); requireValue(this.app.lastCaptureStatus === 'queued', this.app.lastCaptureStatus === 'duplicate' ? 'DUPLICATE_IMAGE' : 'NO_CURRENT_IMAGE'); break;
          }
          this.lastAction = { action: String(r.action), status: 'succeeded', at: Date.now() };
        } catch (error) { this.lastAction = { action: String(r.action), status: safeError(error), at: Date.now() }; throw error; }
        finally { this.actionBusy = false; }
        break;
      }
      case 'discover-agents': {
        requireValue(this.launchMode !== 'staging', 'FORMAL_PROFILE_REQUIRED');
        // Inventory never changes an approved choice or performs a model request.
        await this.refreshDiscovery();
        break;
      }
      case 'create-profile': await this.createProfile(r); break;
      case 'test-agent': {
        requireValue(r.confirm === true, 'GATEWAY_TEST_CONFIRMATION_REQUIRED');
        const profile = this.settings.agents?.profiles.find(p => p.policy.id === r.id && p.policy.version === r.version);
        requireValue(profile?.provider === 'claude-compatible-endpoint' && profile.policy.gateway, 'GATEWAY_PROFILE_REQUIRED');
        await this.createProfile({ provider: profile.provider, id: profile.policy.id, editId: profile.policy.id,
          editVersion: profile.policy.version, reuseExisting: true, workspace: profile.policy.workspace,
          prompt: profile.policy.prompt, endpoint: profile.policy.gateway.baseUrl, model: profile.policy.gateway.model, enableAfterTest: true });
        break;
      }
      case 'credential-status': {
        requireValue(this.settings.agents && typeof r.id === 'string' && typeof r.version === 'string', 'PROFILE_NOT_FOUND');
        const profile = this.settings.agents.profiles.find(p => p.policy.id === r.id && p.policy.version === r.version);
        requireValue(profile?.provider === 'claude-compatible-endpoint' && profile.policy.gateway, 'GATEWAY_PROFILE_REQUIRED');
        try { await this.credentials.read(profile.policy.gateway.credentialRef); this.credentialStatuses.set(profile.policy.gateway.credentialRef, 'available'); }
        catch { this.credentialStatuses.set(profile.policy.gateway.credentialRef, 'missing'); }
        break;
      }
      case 'archive-agent': {
        requireValue(this.settings.agents && typeof r.id === 'string' && typeof r.version === 'string', 'UNAPPROVED_PROFILE');
        requireValue(typeof r.archived === 'boolean' && r.confirm === true, 'PROFILE_REMOVAL_CONFIRMATION_REQUIRED');
        requireValue(this.app.registry.some(e => e.profile.id === r.id && e.profile.version === r.version), 'UNAPPROVED_PROFILE');
        requireValue(!r.archived || this.app.profile.id !== r.id || this.app.profile.version !== r.version, 'SELECT_ANOTHER_PROFILE_FIRST');
        const next = structuredClone(this.settings);
        const archived = (next.agents!.archived ?? []).filter(p => p.id !== r.id || p.version !== r.version);
        if (r.archived) archived.push({ id: r.id, version: r.version });
        next.agents!.archived = archived;
        if (!r.archived) {
          const restored = next.agents!.profiles.find(p => p.policy.id === r.id && p.policy.version === r.version)!;
          next.agents!.profiles = next.agents!.profiles.filter(p => p !== restored).concat(restored);
          // If another version of this same Agent is selected, it becomes historical after restore.
          // Keep the selected entry in the new-task list by selecting the restored version.
          if (next.agents!.selected.id === r.id) next.agents!.selected = { id: r.id, version: r.version };
        }
        // Keep immutable execution entries for existing queued/running tasks and provenance.
        const registry = executionRegistry(next.agents!.profiles); saveSettings(this.root, next); this.settings = next;
        this.app.setRegistry(registry, next.agents!.selected.id, next.agents!.selected.version); break;
      }
      case 'select-agent': {
        requireValue(this.settings.agents && typeof r.id === 'string' && typeof r.version === 'string', 'UNAPPROVED_PROFILE');
        requireValue(this.app.registry.some(e => e.profile.id === r.id && e.profile.version === r.version) && this.selectableProfileKeys().has(profileKey(r.id, r.version)), 'UNAPPROVED_PROFILE');
        const next = structuredClone(this.settings); next.agents!.selected = { id: r.id, version: r.version };
        saveSettings(this.root, next); this.app.select(r.id, r.version); this.settings = next; break;
      }
      case 'delete-agent': {
        requireValue(typeof r.id === 'string' && typeof r.version === 'string' && r.confirm === true, 'PROFILE_DELETE_CONFIRMATION_REQUIRED');
        await this.removeProfiles([profileKey(r.id, r.version)]); break;
      }
      case 'cleanup-unused-agents': {
        requireValue(this.settings.agents, 'PROFILE_NOT_FOUND');
        const referenced = this.referencedProfileKeys(); const selectable = this.selectableProfileKeys();
        const keys = this.settings.agents.profiles.filter(p => {
          const key = profileKey(p.policy.id, p.policy.version);
          return key !== profileKey(this.settings.agents!.selected.id, this.settings.agents!.selected.version) && !referenced.has(key) && (!selectable.has(key) || this.isArchived(p.policy.id, p.policy.version));
        }).map(p => profileKey(p.policy.id, p.policy.version));
        if (keys.length) await this.removeProfiles(keys);
        break;
      }
      case 'configure': {
        const next = structuredClone(this.settings);
        if (r.capture !== undefined) {
          requireValue(r.capture && typeof r.capture === 'object' && !Array.isArray(r.capture), 'INVALID_CAPTURE_SETTINGS');
          const capture = r.capture as Record<string, unknown>;
          requireValue(Object.keys(capture).every(k => ['enabled', 'mode', 'folderEnabled', 'folderDirectory'].includes(k)), 'INVALID_CAPTURE_SETTINGS');
          Object.assign(next.desktop, capture);
        }
        requireValue(!(next.desktop.enabled || next.desktop.folderEnabled) || this.isConfigured(), 'AGENT_SETUP_REQUIRED');
        for (const key of ['autoConsent', 'alwaysConsent'] as const) {
          if (r[key] !== undefined) { requireValue(typeof r[key] === 'boolean', 'INVALID_CONSENT'); next.desktop[key] = r[key]; }
        }
        if (r.delivery !== undefined) {
          requireValue(r.delivery && typeof r.delivery === 'object' && !Array.isArray(r.delivery) && Object.keys(r.delivery).every(k => ['clipboard', 'saveDirectory', 'retry', 'clipboardPayload', 'notification'].includes(k)), 'INVALID_DELIVERY_SETTINGS');
          next.delivery = r.delivery as Settings['delivery'];
        }
        validate(next);
        // A mode/source switch invalidates the staging slot and skips historical content.
        this.armFolder(next); await this.app.arm(); saveSettings(this.root, next); this.settings = next;
        for (const key of Object.keys(this.app.config)) delete (this.app.config as unknown as Record<string, unknown>)[key];
        Object.assign(this.app.config, effectiveDelivery(next)); this.armed = true; this.captureError = undefined;
        break;
      }
      case 'pause':
        requireValue(typeof r.paused === 'boolean', 'INVALID_PAUSE');
        { const next = structuredClone(this.settings); next.desktop.paused = r.paused;
          this.armFolder(next); await this.app.arm(); saveSettings(this.root, next); this.settings = next; this.armed = true; this.captureError = undefined; } break;
      case 'submit':
        requireValue(this.isConfigured(), 'AGENT_SETUP_REQUIRED');
        requireValue(this.app.pending, 'NO_PENDING_IMAGE'); await this.app.capture(true); break;
      case 'current': requireValue(this.isConfigured(), 'AGENT_SETUP_REQUIRED'); await this.app.capture(true, true); break;
      case 'composer-add-files': {
        requireValue(Array.isArray(r.paths) && r.paths.length > 0 && r.paths.length + this.composer.length <= 5 && r.paths.every(p => typeof p === 'string' && p.length <= 2048), 'BATCH_IMAGE_COUNT');
        const inputs: Buffer[] = []; let total = this.composer.reduce((n, i) => n + i.bytes.length, 0);
        for (const path of r.paths as string[]) { const bytes = readImageFile(path); total += bytes.length; requireValue(total <= 60 * 1024 * 1024, 'BATCH_OVER_60_MIB'); inputs.push(bytes); }
        await this.addComposer(inputs); break;
      }
      case 'composer-add-clipboard': {
        const image = await this.app.clipboard!.readImage(); requireValue(image, 'NO_CURRENT_IMAGE');
        await this.addComposer([image.bytes]); break;
      }
      case 'composer-add-pending': {
        requireValue(this.app.pending, 'NO_PENDING_IMAGE'); await this.addComposer([this.app.pending.bytes]); this.app.discard(); break;
      }
      case 'composer-move': {
        requireValue(Number.isInteger(r.index) && Number.isInteger(r.to) && Number(r.index) >= 0 && Number(r.to) >= 0 && Number(r.index) < this.composer.length && Number(r.to) < this.composer.length, 'INVALID_COMPOSER_INDEX');
        const [image] = this.composer.splice(Number(r.index), 1); this.composer.splice(Number(r.to), 0, image); break;
      }
      case 'composer-remove': {
        requireValue(Number.isInteger(r.index) && Number(r.index) >= 0 && Number(r.index) < this.composer.length, 'INVALID_COMPOSER_INDEX'); this.composer.splice(Number(r.index), 1); break;
      }
      case 'composer-discard': this.composer = []; break;
      case 'composer-submit': {
        requireValue(this.isConfigured(), 'AGENT_SETUP_REQUIRED'); requireValue(this.composer.length >= 2 && this.composer.length <= 5, 'BATCH_IMAGE_COUNT');
        const images = this.composer;
        const sequence = await this.app.clipboard!.sequence();
        await this.app.submitImages(images.map(i => i.bytes), { session: this.app.clipboard!.session, sequence }, true);
        this.composer = []; break;
      }
      case 'clean-file-cache': {
        requireValue(r.confirm === true, 'CACHE_CLEANUP_CONFIRMATION_REQUIRED');
        const usage = fileCacheUsage(this.root);
        requireValue(this.app.clipboard?.cleanFileCache, 'FILE_CACHE_CLEANUP_UNAVAILABLE');
        if (!existsSync(usage.directory)) return { deleted: 0, retained: 0 };
        return this.app.clipboard.cleanFileCache(usage.directory);
      }
      case 'copy-files': await this.app.copy(id(), 'files'); break;
      case 'delete-history': {
        requireValue(Array.isArray(r.ids) && r.ids.length > 0 && r.ids.length <= 500 && r.ids.every(id => typeof id === 'string'), 'INVALID_TASK_DELETE');
        requireValue(r.reviewedUnknown === undefined || typeof r.reviewedUnknown === 'boolean', 'INVALID_HISTORY_REVIEW');
        this.app.deleteHistory(r.ids as string[], { reviewedUnknown: r.reviewedUnknown === true }); this.lastHistoryCleanup = undefined; break;
      }
      case 'clear-history': {
        requireValue(r.mode === 'completed' || r.mode === 'all-safe', 'INVALID_HISTORY_CLEAR_MODE');
        const tasks = this.app.list();
        const safe = r.mode === 'completed' ? tasks.filter(task => task.status === 'succeeded') : tasks.filter(task => ['succeeded', 'failed', 'timed_out', 'canceled'].includes(task.status));
        const active = tasks.filter(task => ['queued', 'leased', 'running'].includes(task.status)).length;
        const unknown = tasks.filter(task => task.status === 'execution_unknown').length;
        if (safe.length) this.app.deleteHistory(safe.map(task => task.submission.taskId));
        this.lastHistoryCleanup = { deleted: safe.length, preservedActive: active, preservedUnknown: unknown }; break;
      }
      case 'discard': this.app.discard(); break;
      case 'copy': await this.app.copy(id()); break;
      case 'retry-delivery': {
        const task = this.app.get(id());
        requireValue(task.status === 'succeeded' && retryableDelivery(this.app, task), 'NO_ELIGIBLE_FAILED_DELIVERY');
        await this.app.retryDelivery(id(), retryableChannels(this.app, task));
        requireValue(!retryableDelivery(this.app, this.app.get(id())), 'DELIVERY_STILL_FAILED'); break;
      }
      case 'staging-fault':
        requireValue(this.launchMode === 'staging', 'STAGING_ONLY');
        requireValue(r.kind === 'capture' || r.kind === 'worker', 'INVALID_STAGING_FAULT');
        if (r.kind === 'capture') this.captureError = 'CLIPBOARD_HELPER_STOPPED';
        else this.workerError = 'STAGING_WORKER_STOPPED';
        break;
      case 'detail': {
        const task = this.app.get(id());
        const approved = this.settings.agents?.profiles.find(p => p.policy.id === task.submission.profileId && p.policy.version === task.submission.profileVersion);
        const gateway = approved && approved.provider !== 'codex' ? approved.policy.gateway : undefined;
        return { images: task.submission.images, gateway: gateway ? { endpoint: gateway.baseUrl, model: gateway.model, vision: gateway.vision } : undefined, id: task.submission.taskId, status: task.status, provider: task.submission.provider, profileId: task.submission.profileId, result: task.result ? { contentMarkdown: task.result.contentMarkdown, summary: task.result.summary, errorCode: task.result.errorCode } : undefined, attempts: task.attempts };
      }
      case 'recover':
        // Explicit re-arm, never blindly restart a dead helper or an unconfirmed Agent.
        requireValue(!this.workerError, 'RESTART_APP_AFTER_CHECKING_AGENT'); await this.start(); this.captureError = undefined; break;
      case 'quit': await this.close(); return { stopped: true };
    }
    return this.snapshot();
  }
  private isArchived(id: string, version: string) { return !!this.settings.agents?.archived?.some(p => p.id === id && p.version === version); }
  private async snapshot(offset = 0, query = '') {
    const image = this.app.pending;
    if (image !== this.previewImage) {
      this.previewImage = image;
      this.preview = image ? `data:image/png;base64,${(await sharp(image.bytes).resize({ width: 420, height: 220, fit: 'inside', withoutEnlargement: true }).png().toBuffer()).toString('base64')}` : undefined;
    }
    const tasks = this.app.list();
    const matching = tasks.filter(t => !query || `${t.result?.summary ?? ''} ${t.submission.provider ?? ''} ${t.submission.profileId} ${t.status}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.createdAt - a.createdAt || b.submission.taskId.localeCompare(a.submission.taskId));
    const historyOffset = Math.min(offset, Math.max(0, Math.floor((matching.length - 1) / 50) * 50));
    const policies = this.settings.agents?.profiles ?? (this.settings.codex ? [{ provider: 'codex' as const, policy: this.settings.codex }] : []);
    const selected = this.settings.agents?.selected;
    const selectable = this.selectableProfileKeys(); const referenced = new Set(tasks.map(t => profileKey(t.submission.profileId, t.submission.profileVersion)));
    const agents = policies.map(approved => {
      const { id, version } = approved.policy; const key = profileKey(id, version); const archived = this.isArchived(id, version);
      const gateway = approved.provider === 'claude-compatible-endpoint' ? approved.policy.gateway : undefined;
      const removable = !!this.settings.agents && (id !== selected?.id || version !== selected?.version);
      const deletable = removable && !referenced.has(key) && (!selectable.has(key) || archived) && policies.length > 1;
      return { id, version, provider: approved.provider, archived, historical: !archived && !selectable.has(key), referenced: referenced.has(key), removable, deletable,
        gateway: gateway ? { endpoint: gateway.baseUrl, model: gateway.model, vision: gateway.vision,
          credentialStatus: this.credentialStatuses.get(gateway.credentialRef) ?? 'unchecked',
          connectionStatus: this.gatewayTests.get(gateway.credentialRef) ?? (gateway.vision === 'operator-attested' ? 'previously_attested' : 'not_tested') } : undefined,
        path: approved.policy.program.args[0] ?? approved.policy.program.executable, cliVersion: approved.policy.cliVersion,
        workspace: approved.policy.workspace, prompt: approved.policy.prompt };
    });
    const current = this.currentPolicy();
    const selectedAgent = this.app.registry.find(e => e.profile.id === this.app.profile.id && e.profile.version === this.app.profile.version);
    let fileCache;
    try { fileCache = fileCacheUsage(this.root); } catch { fileCache = { error: 'UNSAFE_FILE_CACHE' }; }
    const snapshot = { appVersion: APP_VERSION, fileCache, composer: this.composer.map(({ id, preview }) => ({ id, preview })), folderError: this.folder.error, activity: { running: tasks.filter(t => ['leased', 'running'].includes(t.status)).length, queued: tasks.filter(t => t.status === 'queued').length }, hotkeys: this.settings.hotkeys ?? {}, lastAction: this.lastAction, lastHistoryCleanup: this.lastHistoryCleanup, canReviewUnknownHistory: this.app.canReviewUnknownHistory,
      settings: this.settings.desktop, delivery: this.settings.delivery, root: this.root, launchMode: this.launchMode, setupRequired: !this.isConfigured(),
      remote: { ...Object.fromEntries(Object.entries(this.settings.remote ?? remoteDefaults()).filter(([key]) => key !== 'credentialRef')), hasToken: !!this.settings.remote?.credentialRef, status: this.remote.status, error: this.remote.error, lastSync: this.remote.lastSync, workers: this.remote.workers },
      agents, discovery: this.discovery.map(candidate => ({ provider: candidate.provider, path: candidate.path, selectionPath: candidate.selectionPath ?? candidate.path, version: candidate.version, status: candidate.status })),
      profile: { adapter: selectedAgent?.adapter.name ?? current?.provider ?? 'fake', id: this.isConfigured() ? this.app.profile.id : '', profileVersion: this.isConfigured() ? this.app.profile.version : '',
        workspace: current?.policy.workspace ?? this.settings.codex?.workspace, version: current?.policy.cliVersion ?? this.settings.codex?.cliVersion, sandbox: 'read-only' }, workspaceSuggestion: this.workspaceSuggestion(),
      status: this.workerError ? 'worker_error' : this.captureError ? 'capture_error' : !this.isConfigured() ? 'setup_required' : this.settings.desktop.paused ? 'paused' : !(this.settings.desktop.enabled || this.settings.desktop.folderEnabled) ? 'capture_off' : 'monitoring',
      error: this.workerError ?? this.captureError, pending: this.preview ?? null, captureStatus: this.app.lastCaptureStatus,
      total: tasks.length, historyTotal: matching.length, historyOffset, tasks: matching.slice(historyOffset, historyOffset + 50).map(t => ({ id: t.submission.taskId, mode: t.mode, remote: this.remote.info(t.submission.taskId), createdAt: t.createdAt, status: t.status, provider: t.submission.provider ?? t.attempts[0]?.adapterName, profileId: t.submission.profileId, summary: t.result?.summary, error: t.result?.errorCode ?? (t.mode === 'local' && t.status === 'queued' && !this.app.registry.some(e => e.profile.id === t.submission.profileId && e.profile.version === t.submission.profileVersion) ? 'PROFILE_UNAVAILABLE' : undefined),
        retryableChannels: t.status === 'succeeded' ? retryableChannels(this.app, t) : [], save: this.app.state.get(t.submission.taskId, 'save'), imageCount: t.submission.images.length, notification: this.app.state.get(t.submission.taskId, 'notification'), clipboard: this.app.state.get(t.submission.taskId, 'clipboard') })) };
    const results = completedResults(this.app);
    const actions = { copy: results.length > 0, retry: results.some(t => retryableDelivery(this.app, t)),
      cycle: !!this.settings.agents && this.app.registry.filter(e => selectable.has(profileKey(e.profile.id, e.profile.version))).length > 1,
      current: this.isConfigured() && !this.workerError && !this.captureError };
    return { ...snapshot, tray: trayView({ ...snapshot, actions }) };
  }
  async close() {
    if (this.closed) return; this.closed = true; this.controller.abort();
    await this.worker; await this.remoteSync; await this.discovering; this.app.close(); this.remote.close();
  }
}
