import { join } from 'node:path';
import { readdirSync, lstatSync, unlinkSync } from 'node:fs';
import { openCore } from '../../core/src/core.ts';
import { parseTaskView, requireValue } from '../../core/src/model.ts';
import type { TaskView } from '../../core/src/model.ts';
import type { SubmissionMetadata, FileReference } from '../../contracts/src/index.ts';
import { isTerminalTaskState, validateSubmissionMetadata } from '../../contracts/src/index.ts';
import { sha256 } from '../../core/src/blobs.ts';
import { RemoteClient, validateRelayUrl } from '../../../services/relay/src/client.ts';
import type { Capability, Presence } from '../../../services/relay/src/capabilities.ts';
export interface RemoteSettings {
  version: 1; mode: 'local' | 'remote'; url: string; label: string; receive: boolean; credentialRef?: string;
  identity?: { ownerId: string; deviceId: string };
  target?: Capability & { deviceId: string };
}
export const remoteDefaults = (): RemoteSettings => ({ version: 1, mode: 'local', url: '', label: 'Windows PC', receive: false });
export function validateRemote(r: RemoteSettings): void {
  requireValue(r && r.version === 1 && Object.keys(r).every(k => ['version', 'mode', 'url', 'label', 'receive', 'credentialRef', 'identity', 'target'].includes(k)) &&
    ['local', 'remote'].includes(r.mode) && typeof r.url === 'string' && typeof r.receive === 'boolean' && typeof r.label === 'string' && r.label.length > 0 && r.label.length <= 80, 'INVALID_REMOTE_SETTINGS');
  if (r.url) validateRelayUrl(r.url);
  requireValue(!r.credentialRef || /^Shot2Agent-Relay-[0-9a-f-]{36}$/.test(r.credentialRef), 'INVALID_CREDENTIAL_REF');
  if (r.identity) requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(r.identity.ownerId) && /^[a-zA-Z0-9_-]{1,64}$/.test(r.identity.deviceId), 'INVALID_REMOTE_IDENTITY');
  if (r.target) requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(r.target.deviceId) && /^[a-z][a-z0-9-]{0,63}$/.test(r.target.id) && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(r.target.version) && /^[a-f0-9]{64}$/.test(r.target.fingerprint) && ['fake', 'codex', 'claude', 'claude-compatible-endpoint'].includes(r.target.provider), 'INVALID_REMOTE_TARGET');
  requireValue(r.mode !== 'remote' || (r.url && r.credentialRef && r.identity && r.target), 'REMOTE_SETUP_REQUIRED');
}
interface Outbox {
  version: 1; url: string; ownerId: string; deviceId: string; key: string; metadata: SubmissionMetadata;
  files: FileReference[]; cachedFiles?: FileReference[]; createdAt: number; task?: TaskView;
  upload: 'pending_upload' | 'acknowledged' | 'upload_failed'; error?: string; failures: number; nextAt: number; deleted?: boolean;
}
/** Separate private database: entries can never be claimed by the executable Local Core. */
export class RemoteQueue {
  private core: ReturnType<typeof openCore>;
  workers: Presence[] = []; status = 'unconfigured'; lastSync?: number; error?: string;
  constructor(root: string) {
    this.core = openCore(join(root, 'remote'), 'remote');
  }
  /** Called only after the desktop owns the shared process lock. */
  recover(root: string): void {
    this.delete(this.rows().filter(r => r.deleted).map(r => r.key));
    // Crashes between blob fsync and SQLite commit leave only unreferenced app-owned IDs.
    const retained = new Set(this.rows().flatMap(r => [...r.files, ...(r.cachedFiles ?? [])].map(f => f.fileId)));
    const directory = join(root, 'remote', 'blobs');
    for (const name of readdirSync(directory)) if (/^[0-9a-f-]{36}$/.test(name) && !retained.has(name)) {
      const path = join(directory, name); requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_FILE'); unlinkSync(path);
    }
  }
  private rows(): Outbox[] { return this.core.store.metadata('outbox:').map(row => {
    const r = JSON.parse(row.value) as Outbox;
    requireValue(r.version === 1 && Array.isArray(r.files) && r.key === r.metadata?.taskId, 'INVALID_REMOTE_DATABASE'); return r;
  }); }
  private usage(): number { return this.rows().reduce((n, r) => n + Buffer.byteLength(JSON.stringify(r)) + [...r.files, ...(r.cachedFiles ?? [])].reduce((m, f) => m + f.byteSize, 0), 0); }
  private put(r: Outbox): void { this.core.store.putMetadata(`outbox:${r.key}`, JSON.stringify(r)); }
  async enqueue(settings: RemoteSettings, metadata: SubmissionMetadata, images: Buffer[]): Promise<void> {
    const parsed = validateSubmissionMetadata(metadata); requireValue(parsed.ok, 'INVALID_SUBMISSION'); metadata = parsed.value;
    requireValue(settings.identity && settings.target && settings.credentialRef && settings.url, 'REMOTE_SETUP_REQUIRED');
    const rows = this.rows();
    requireValue(rows.filter(r => !r.deleted).length < 1000 && this.usage() + Buffer.byteLength(JSON.stringify(metadata)) + images.reduce((n, b) => n + b.length, 0) <= 512 * 1024 * 1024, 'REMOTE_CACHE_FULL');
    const files: FileReference[] = [];
    try {
      for (let i = 0; i < images.length; i++) files.push(this.core.blobs.put(images[i], metadata.images[i]));
      this.put({ version: 1, url: settings.url, ...settings.identity, key: metadata.taskId, metadata, files, createdAt: Date.now(), upload: 'pending_upload', failures: 0, nextAt: 0 });
    } catch (e) { for (const f of files) this.core.blobs.remove(f); throw e; }
  }
  list(): TaskView[] {
    return this.rows().filter(r => !r.deleted).map(r => r.task ?? { schemaVersion: 1, mode: 'remote', ownerId: r.ownerId, originDeviceId: r.deviceId,
      submission: r.metadata, status: 'queued', createdAt: r.createdAt, updatedAt: r.createdAt, inputs: r.files, attempts: [] });
  }
  info(id: string) { const r = this.rows().find(r => r.key === id && !r.deleted); return r ? { upload: r.upload, error: r.error, targetWorkerId: r.metadata.targetWorkerId } : undefined; }
  get(id: string): TaskView | undefined { return this.list().find(t => t.submission.taskId === id); }
  hasPending(): boolean { return this.rows().some(r => !r.deleted && (!r.task || !isTerminalTaskState(r.task.status))); }
  delete(ids: readonly string[]): void {
    for (const r of this.rows().filter(r => ids.includes(r.key))) {
      // Tombstone prevents polling from resurrecting deleted history after restart.
      r.deleted = true; this.put(r);
      for (const f of [...r.files, ...(r.cachedFiles ?? [])]) this.core.blobs.remove(f);
      r.files = []; r.cachedFiles = []; delete r.task; delete r.metadata.taskInstructions; r.metadata.images = []; this.put(r);
    }
  }
  retry(): void { for (const r of this.rows().filter(r => !r.deleted)) { r.nextAt = 0; if (r.upload === 'upload_failed') r.upload = 'pending_upload'; this.put(r); } }
  private async accept(r: Outbox, task: TaskView, client: RemoteClient): Promise<void> {
    if (this.rows().find(row => row.key === r.key)?.deleted) return;
    task = parseTaskView(task);
    requireValue(task.mode === 'remote' && task.ownerId === r.ownerId && task.originDeviceId === r.deviceId && JSON.stringify(task.submission) === JSON.stringify(r.metadata), 'REMOTE_IDENTITY_MISMATCH');
    if (task.result) {
      requireValue(task.result.artifacts.length <= 5 && task.result.artifacts.every(f => f.byteSize <= 1024 * 1024 && f.contentType === 'text/plain' && !/[\\/]/.test(f.fileName) && ![...f.fileName].some(c => c.charCodeAt(0) < 32)) &&
        task.result.workerId === r.metadata.targetWorkerId && task.result.adapterName === r.metadata.provider && task.attempts.some(a => a.attemptId === task.result!.attemptId && a.workerId === r.metadata.targetWorkerId && a.profileFingerprint === r.metadata.profileFingerprint), 'INVALID_RELAY_RESPONSE');
      requireValue(this.usage() + Buffer.byteLength(JSON.stringify(task)) + task.result.artifacts.reduce((n, f) => n + f.byteSize, 0) <= 512 * 1024 * 1024, 'REMOTE_CACHE_FULL');
      const staged: FileReference[] = [];
      try {
        for (const f of task.result.artifacts) {
          const bytes = await client.file(r.key, f.fileId, 1024 * 1024);
          requireValue(bytes.length === f.byteSize && sha256(bytes) === f.sha256, 'ARTIFACT_INTEGRITY');
          staged.push(this.core.blobs.put(bytes, f));
        }
      } catch (e) { for (const f of staged) this.core.blobs.remove(f); throw e; }
      if (this.rows().find(row => row.key === r.key)?.deleted) { for (const f of staged) this.core.blobs.remove(f); return; }
      const old = r.cachedFiles; r.cachedFiles = staged; r.task = task; r.upload = 'acknowledged'; r.error = undefined; r.failures = 0; this.put(r);
      for (const f of old ?? []) this.core.blobs.remove(f);
      return;
    }
    r.task = task; r.upload = 'acknowledged'; r.error = undefined; r.failures = 0; this.put(r);
  }
  async sync(settings: RemoteSettings, client: RemoteClient): Promise<void> {
    try {
      const session = await client.session();
      requireValue(settings.identity?.ownerId === session.ownerId && settings.identity.deviceId === session.deviceId, 'REMOTE_IDENTITY_MISMATCH');
      this.workers = await client.workers(); this.status = 'connected'; this.error = undefined; this.lastSync = Date.now();
      for (const r of this.rows()) {
        if (r.deleted || r.url !== settings.url || r.ownerId !== session.ownerId || r.deviceId !== session.deviceId || r.nextAt > Date.now() || r.upload === 'upload_failed' || (r.task && isTerminalTaskState(r.task.status))) continue;
        try {
          const task = r.upload === 'pending_upload' ? await client.submit(r.key, r.metadata, r.files.map(f => this.core.blobs.read(f))) : await client.get(r.key);
          await this.accept(r, task, client);
        } catch (e) {
          if (this.rows().find(row => row.key === r.key)?.deleted) continue;
          const code = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'REMOTE_NETWORK_UNAVAILABLE';
          r.error = code; r.failures++; r.nextAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(r.failures, 6)) + Math.floor(Math.random() * 500);
          if (/^RELAY_4|INTEGRITY|IDENTITY|INVALID_|TOO_LARGE/.test(code)) { if (r.upload === 'pending_upload') r.upload = 'upload_failed'; r.nextAt = Number.MAX_SAFE_INTEGER; }
          this.put(r); this.error = code;
        }
      }
    } catch (e) { this.status = 'disconnected'; this.error = e instanceof Error && /^[A-Z0-9_]+$/.test(e.message) ? e.message : 'REMOTE_NETWORK_UNAVAILABLE'; }
  }
  close(): void { this.core.close(); }
}
