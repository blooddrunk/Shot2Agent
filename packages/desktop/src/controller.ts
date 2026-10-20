import sharp from 'sharp';
import type { AgentAdapter, Profile } from '../../contracts/src/index.ts';
import { requireValue } from '../../core/src/model.ts';
import { LocalApp } from '../../local/src/app.ts';
import type { ClipboardPort } from '../../local/src/clipboard.ts';
import { CodexAgent, codexProfile } from '../../worker/src/codex.ts';
import { FAKE_PROFILE, FakeAgent } from '../../worker/src/fake.ts';
import { loadSettings, saveSettings, validate } from './settings.ts';
import type { Settings } from './settings.ts';
export function safeError(error: unknown): string { return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'LOCAL_OPERATION_FAILED'; }
/** The exact allowlisted interface used by Tauri and the process E2E tests. */
export class DesktopController {
  readonly root: string; readonly app: LocalApp; settings: Settings;
  private controller = new AbortController(); private worker?: Promise<unknown>;
  private closed = false; private armed = false; private workerError?: string; private captureError?: string;
  private preview?: string; private previewImage?: object;
  constructor(root: string, clipboard: ClipboardPort, injected?: { adapter: AgentAdapter; profile: Profile }) {
    this.root = root; this.settings = loadSettings(root);
    const policy = this.settings.codex;
    requireValue(this.settings.adapter !== 'codex' || policy, 'MISSING_CODEX_POLICY');
    this.app = new LocalApp(root, injected?.adapter ?? (this.settings.adapter === 'codex' ? new CodexAgent([policy!]) : new FakeAgent()),
      injected?.profile ?? (this.settings.adapter === 'codex' ? codexProfile(policy!) : FAKE_PROFILE), this.settings.delivery, clipboard);
  }
  async start() { this.app.state.acquireWorker(); await this.app.arm(); this.armed = true; }
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
      submit: [], current: [], discard: [], pause: ['paused'], copy: ['id'], detail: ['id'], 'retry-delivery': ['id'], recover: [], quit: [] };
    requireValue(Object.hasOwn(allowed, r.command) && Object.keys(r).every(k => ['v', 'command', ...allowed[r.command as string]].includes(k)), 'COMMAND_REFUSED');
    const id = () => { requireValue(typeof r.id === 'string' && /^[0-9a-f-]{36}$/.test(r.id), 'INVALID_TASK_ID'); return r.id; };
    switch (r.command) {
      case 'configure': {
        const next = structuredClone(this.settings);
        if (r.capture !== undefined) {
          requireValue(r.capture && typeof r.capture === 'object' && !Array.isArray(r.capture), 'INVALID_CAPTURE_SETTINGS');
          const capture = r.capture as Record<string, unknown>;
          requireValue(Object.keys(capture).every(k => ['enabled', 'mode'].includes(k)), 'INVALID_CAPTURE_SETTINGS');
          Object.assign(next.desktop, capture);
        }
        if (r.autoConsent === true) next.desktop.autoConsent = true;
        if (r.alwaysConsent === true) next.desktop.alwaysConsent = true;
        if (r.delivery !== undefined) {
          requireValue(r.delivery && typeof r.delivery === 'object' && !Array.isArray(r.delivery) && Object.keys(r.delivery).every(k => ['clipboard', 'saveDirectory'].includes(k)), 'INVALID_DELIVERY_SETTINGS');
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
        await this.app.arm(); this.settings.desktop.paused = r.paused; saveSettings(this.root, this.settings); this.armed = true; this.captureError = undefined; break;
      case 'submit':
        requireValue(this.app.pending, 'NO_PENDING_IMAGE'); await this.app.capture(); break;
      case 'current': await this.app.capture(false, true); break;
      case 'discard': this.app.discard(); break;
      case 'copy': await this.app.copy(id()); break;
      case 'retry-delivery': await this.app.retryDelivery(id()); break;
      case 'detail': {
        const task = this.app.get(id()); return { id: task.submission.taskId, status: task.status, result: task.result ? { contentMarkdown: task.result.contentMarkdown, summary: task.result.summary, errorCode: task.result.errorCode } : undefined, attempts: task.attempts };
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
    return { settings: this.settings.desktop, delivery: this.settings.delivery, root: this.root,
      profile: { adapter: this.settings.adapter, id: this.app.profile.id, workspace: this.settings.codex?.workspace, version: this.settings.codex?.cliVersion, sandbox: 'read-only' },
      status: this.workerError ? 'worker_error' : this.captureError ? 'capture_error' : this.settings.desktop.paused ? 'paused' : !this.settings.desktop.enabled ? 'capture_off' : 'monitoring',
      error: this.workerError ?? this.captureError, pending: this.preview ?? null, captureStatus: this.app.lastCaptureStatus,
      total: tasks.length, tasks: tasks.slice(-50).reverse().map(t => ({ id: t.submission.taskId, status: t.status, summary: t.result?.summary, error: t.result?.errorCode,
        save: this.app.state.get(t.submission.taskId, 'save'), clipboard: this.app.state.get(t.submission.taskId, 'clipboard') })) };
  }
  async close() {
    if (this.closed) return; this.closed = true; this.controller.abort();
    await this.worker; this.app.close();
  }
}
