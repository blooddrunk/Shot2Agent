import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { openCore } from '../../core/src/core.ts';
import { sha256, verifyImage, withImageDecode } from '../../core/src/blobs.ts';
import { requireValue } from '../../core/src/model.ts';
import type { AgentAdapter, ImageContentType, Profile } from '../../contracts/src/index.ts';
import { IMAGE_LIMITS } from '../../contracts/src/index.ts';
import type { ExecutionEntry } from '../../worker/src/worker.ts';
import { runOnce } from '../../worker/src/worker.ts';
import type { ClipboardImage, ClipboardPort } from './clipboard.ts';
import { LocalState } from './state.ts';
import type { Baseline } from './state.ts';
import { deliver, resultFiles } from './delivery.ts';
import type { DeliveryConfig } from './delivery.ts';
export const LOCAL_IDENTITY = { ownerId: 'local-user', deviceId: 'local-pc' };
export class LocalApp {
  readonly core: ReturnType<typeof openCore>; readonly state: LocalState;
  private pendingImage?: ClipboardImage & { source?: string };
  private pendingQueue: (ClipboardImage & { source?: string })[] = [];
  lastCaptureStatus: 'queued' | 'no_image' | 'duplicate' | 'capture_in_progress' = 'no_image';
  private cleanupBlocked = false;
  private working = false; private capturing = false; private lastSequence?: string;
  adapter: AgentAdapter; private selected: ExecutionEntry; registry: readonly ExecutionEntry[];
  get profile(): Profile { return this.selected.profile; }
  select(id: string, version: string): void {
    const entry = this.registry.find(e => e.profile.id === id && e.profile.version === version);
    requireValue(entry, 'UNAPPROVED_PROFILE'); this.selected = entry;
  } readonly config: DeliveryConfig; readonly clipboard?: ClipboardPort;
  constructor(root: string, adapter: AgentAdapter, profile: Profile,
    config: DeliveryConfig, clipboard?: ClipboardPort, registry?: readonly ExecutionEntry[]) {
    this.adapter = adapter; this.registry = Object.freeze((registry ?? [{ adapter, profile }]).map(e => Object.freeze({ adapter: e.adapter, profile: Object.freeze(structuredClone(e.profile)) })));
    requireValue(new Set(this.registry.map(e => `${e.profile.id}:${e.profile.version}`)).size === this.registry.length, 'DUPLICATE_PROFILE');
    this.selected = this.registry.find(e => e.profile.id === profile.id && e.profile.version === profile.version)!;
    requireValue(this.selected, 'UNAPPROVED_PROFILE'); this.config = config; this.clipboard = clipboard;
    this.core = openCore(root); this.state = new LocalState(root);
    this.recoverTaskDeletions();
    // Upgrade adds a destination without notifying old completed history.
    for (const task of this.list()) if (task.status === 'succeeded' && !this.state.get(task.submission.taskId, 'notification'))
      this.state.put(task.submission.taskId, 'notification', { status: 'disabled', attempts: 0 });
  }
  /** Atomically changes the configuration available to future claims; current task bindings stay pinned. */
  setRegistry(registry: readonly ExecutionEntry[], selectedId: string, selectedVersion: string): void {
    const next = Object.freeze(registry.map(e => Object.freeze({ adapter: e.adapter, profile: Object.freeze(structuredClone(e.profile)) })));
    requireValue(new Set(next.map(e => `${e.profile.id}:${e.profile.version}`)).size === next.length, 'DUPLICATE_PROFILE');
    const selected = next.find(e => e.profile.id === selectedId && e.profile.version === selectedVersion);
    requireValue(selected, 'UNAPPROVED_PROFILE');
    this.registry = next; this.selected = selected; this.adapter = selected.adapter;
  }
  get pending() { return this.pendingImage; }
  discard(): void { this.pendingImage = this.pendingQueue.shift(); }
  private clearPending(): void { this.pendingImage = undefined; this.pendingQueue = []; }
  async ingest(bytes: Buffer, auto: boolean, baseline?: Baseline, source = 'clipboard') {
    if (auto) return this.submit(bytes, baseline, false, source);
    const hash = sha256(bytes);
    if (this.state.duplicate(hash) || [this.pendingImage, ...this.pendingQueue].some(i => i && sha256(i.bytes) === hash)) return;
    await validateLocalImage(bytes);
    requireValue(this.pendingQueue.length < 20, 'PENDING_IMAGES_FULL');
    const image = { bytes: Buffer.from(bytes), sequence: baseline?.sequence ?? '', source };
    if (!this.pendingImage || (source === 'clipboard' && this.pendingImage.source === 'clipboard')) this.pendingImage = image; else this.pendingQueue.push(image);
  }
  /** Arm at the current sequence without reading/submitting historical clipboard contents. */
  async arm(): Promise<void> {
    requireValue(this.clipboard, 'WINDOWS_CLIPBOARD_REQUIRED');
    this.clearPending();
    this.lastSequence = await this.clipboard.sequence();
  }
  async submit(bytes: Buffer, baseline?: Baseline, force = false, source = 'clipboard'): Promise<string | undefined> {
    return this.submitImages([bytes], baseline, force, source);
  }
  async submitImages(inputs: readonly Buffer[], baseline?: Baseline, force = true, source = 'composer'): Promise<string | undefined> {
    const selected = this.selected;
    requireValue(inputs.length >= 1 && inputs.length <= 5, 'BATCH_IMAGE_COUNT');
    requireValue(inputs.reduce((n, b) => n + b.length, 0) <= IMAGE_LIMITS.maxTotalBytes, 'BATCH_OVER_60_MIB');
    const prepared = [];
    for (const input of inputs) prepared.push(await validateLocalImage(input));
    const hash = prepared.length === 1 ? prepared[0].metadata.sha256 : sha256(JSON.stringify(prepared.map(i => i.metadata.sha256)));
    const taskId = randomUUID();
    if (!this.state.capture(taskId, hash, baseline, { source, images: prepared.map(i => i.provenance), ...(prepared.length === 1 ? prepared[0].provenance : {}) }, force)) {
      this.lastCaptureStatus = 'duplicate'; return undefined;
    }
    try {
      await this.core.submit(LOCAL_IDENTITY, taskId, { taskId, profileId: selected.profile.id, profileVersion: selected.profile.version,
        provider: selected.adapter.name, profileFingerprint: selected.profile.fingerprint,
        images: prepared.map(i => i.metadata) }, prepared.map(i => i.bytes));
    } catch (error) { this.state.forgetCapture(taskId); throw error; }
    this.lastCaptureStatus = 'queued'; return taskId;
  }
  async capture(force = false, current = false): Promise<string | undefined> {
    requireValue(this.clipboard, 'WINDOWS_CLIPBOARD_REQUIRED');
    if (this.capturing) { this.lastCaptureStatus = 'capture_in_progress'; return undefined; }
    this.capturing = true;
    try {
      // Confirmation uses the last observed image even if the user has since copied command text.
      const pendingAtStart = this.pendingImage;
      const staged = current ? undefined : pendingAtStart;
      const image = staged ?? await this.clipboard.readImage();
      if (!image) { this.lastCaptureStatus = 'no_image'; return undefined; }
      const id = await this.submit(image.bytes, { session: this.clipboard.session, sequence: image.sequence }, force, staged?.source ?? 'clipboard');
      if (this.pendingImage === pendingAtStart) this.discard();
      return id;
    } finally { this.capturing = false; }
  }
  /** Poll only sequence; full image read happens once per change. Text/own writes never submit. */
  async observe(auto: boolean): Promise<{ changed: boolean; image: boolean; id?: string }> {
    requireValue(this.clipboard, 'WINDOWS_CLIPBOARD_REQUIRED');
    const sequence = await this.clipboard.sequence();
    if (sequence === this.lastSequence) return { changed: false, image: false };
    const image = await this.clipboard.readImage();
    // A failed/busy read leaves the sequence unconsumed so a later poll retries.
    this.lastSequence = image?.sequence ?? sequence;
    if (!image) return { changed: true, image: false };
    const id = await this.ingest(image.bytes, auto, { session: this.clipboard.session, sequence: image.sequence });
    return { changed: true, image: true, ...(id ? { id } : {}) };
  }
  async work(signal?: AbortSignal): Promise<boolean> {
    if (this.working || this.cleanupBlocked) return false; this.state.acquireWorker(); this.working = true;
    try {
      const worked = await runOnce(this.core.worker(LOCAL_IDENTITY), this.adapter, this.registry.map(e => e.profile), 5000, signal, this.registry);
      for (const task of this.list()) await deliver(task, this.config, this.state, this.clipboard);
      return worked;
    } catch (error) {
      if (error instanceof Error && error.message === 'AGENT_STOP_UNCONFIRMED') this.cleanupBlocked = true;
      throw error;
    } finally { this.working = false; }
  }
  list() {
    const tasks = []; let cursor: string | undefined;
    do {
      const page = this.core.list(LOCAL_IDENTITY.ownerId, cursor, 100); tasks.push(...page.tasks); cursor = page.nextCursor;
    } while (cursor);
    return tasks;
  }
  get(id: string) { return this.core.get(LOCAL_IDENTITY.ownerId, id); }
  async copy(id: string, payload: 'text' | 'files' = 'text'): Promise<void> {
    const task = this.get(id); requireValue(task.result && this.clipboard, 'RESULT_OR_CLIPBOARD_UNAVAILABLE');
    const old = this.state.get(id, 'clipboard');
    requireValue(old?.status !== 'pending', 'DELIVERY_IN_PROGRESS');
    try {
      const success = payload === 'files' ? await this.clipboard.writeFiles?.(resultFiles(task, this.state)) : await this.clipboard.writeText(task.result.contentMarkdown);
      requireValue(success, 'COPY_FAILED');
      this.state.put(id, 'clipboard', { status: 'succeeded', attempts: (old?.attempts ?? 0) + 1, history: old?.history, smartGuard: old?.smartGuard, payload });
    } catch {
      this.state.put(id, 'clipboard', { status: 'failed', code: 'COPY_FAILED', attempts: (old?.attempts ?? 0) + 1, history: old?.history, smartGuard: old?.smartGuard, payload }); throw new Error('COPY_FAILED');
    }
  }
  async retryDelivery(id: string, channels?: readonly string[]): Promise<void> { await deliver(this.get(id), this.config, this.state, this.clipboard, true, undefined, channels); }
  get canReviewUnknownHistory(): boolean { return !this.working && !this.cleanupBlocked; }
  deleteHistory(ids: readonly string[], options: { reviewedUnknown?: boolean } = {}): string[] {
    requireValue(ids.length > 0 && ids.length <= 10_000 && new Set(ids).size === ids.length, 'INVALID_TASK_DELETE');
    let includesUnknown = false;
    for (const id of ids) {
      const task = this.get(id);
      if (task.status === 'execution_unknown') {
        requireValue(options.reviewedUnknown === true, 'TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW', 409);
        includesUnknown = true;
      }
      requireValue(['succeeded', 'failed', 'timed_out', 'canceled', 'execution_unknown'].includes(task.status), 'TASK_NOT_TERMINAL', 409);
    }
    if (includesUnknown) {
      requireValue(this.canReviewUnknownHistory, 'HISTORY_AGENT_STOP_PENDING', 409);
      this.state.acquireWorker(); // Another live Local Worker must not race this review.
    }
    // The durable intent is written only after review and stop checks pass.
    this.state.beginTaskDeletion(ids);
    this.core.deleteTasks(LOCAL_IDENTITY.ownerId, ids, options);
    this.core.recoverBlobCleanup();
    this.state.finishTaskDeletion(ids);
    return ids.slice();
  }
  private recoverTaskDeletions(): void {
    const pending = this.state.pendingTaskDeletions();
    if (!pending.length) return;
    // Journal entries already passed the review/stop checks before the crash.
    this.core.deleteTasks(LOCAL_IDENTITY.ownerId, pending, { allowMissing: true, reviewedUnknown: true });
    this.core.recoverBlobCleanup();
    this.state.finishTaskDeletion(pending);
  }
  close(): void { this.pendingImage = undefined; this.core.close(); this.state.close(); this.clipboard?.close(); }
}
export function readImageFile(path: string): Buffer {
  const info = lstatSync(path);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= IMAGE_LIMITS.maxTotalBytes, 'IMAGE_TOO_LARGE_OR_UNSAFE');
  return readFileSync(path);
}

// Oversized input is allowed only through this bounded, explicit lossless optimization path.
// No resize/crop/palette/quality reduction. Core always receives <=20 MiB verified stills.
export async function prepareImage(bytes: Buffer): Promise<{ bytes: Buffer; transformation: string }> {
  requireValue(bytes.length <= IMAGE_LIMITS.maxTotalBytes, 'IMAGE_INPUT_OVER_60_MIB');
  if (bytes.length <= IMAGE_LIMITS.maxImageBytes) return { bytes, transformation: 'none' };
  return withImageDecode(async () => {
  const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: IMAGE_LIMITS.maxPixels, animated: true });
  const info = await decoder.metadata();
  requireValue(['png', 'jpeg', 'webp'].includes(info.format ?? '') && (info.pages ?? 1) === 1 &&
    info.width && info.height && info.width <= IMAGE_LIMITS.maxDimension && info.height <= IMAGE_LIMITS.maxDimension, 'INVALID_IMAGE');
  const optimized = await decoder.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  requireValue(optimized.length <= IMAGE_LIMITS.maxImageBytes, 'IMAGE_OVER_20_MIB_AFTER_LOSSLESS_OPTIMIZATION_NO_RESIZE');
  return { bytes: optimized, transformation: 'lossless-png' };
  });
}

export async function validateLocalImage(input: Buffer) {
  const prepared = await prepareImage(input); const bytes = prepared.bytes;
  const info = await sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels, failOn: 'warning', animated: true }).metadata();
  const hash = sha256(bytes);
  const metadata = { fileName: `screenshot.${info.format}`, contentType: `image/${info.format}` as ImageContentType, byteSize: bytes.length, sha256: hash };
  await verifyImage(bytes, metadata);
  return { bytes, metadata, provenance: { originalHash: sha256(input), sentHash: hash, transformation: prepared.transformation, width: info.width, height: info.height } };
}
