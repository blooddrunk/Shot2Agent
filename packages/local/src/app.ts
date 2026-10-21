import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { openCore } from '../../core/src/core.ts';
import { sha256, withImageDecode } from '../../core/src/blobs.ts';
import { requireValue } from '../../core/src/model.ts';
import type { AgentAdapter, ImageContentType, Profile } from '../../contracts/src/index.ts';
import { IMAGE_LIMITS } from '../../contracts/src/index.ts';
import { runOnce } from '../../worker/src/worker.ts';
import type { ClipboardImage, ClipboardPort } from './clipboard.ts';
import { LocalState } from './state.ts';
import type { Baseline } from './state.ts';
import { deliver } from './delivery.ts';
import type { DeliveryConfig } from './delivery.ts';
export const LOCAL_IDENTITY = { ownerId: 'local-user', deviceId: 'local-pc' };
export class LocalApp {
  readonly core; readonly state;
  private pendingImage?: ClipboardImage;
  lastCaptureStatus: 'queued' | 'no_image' | 'duplicate' | 'capture_in_progress' = 'no_image';
  private cleanupBlocked = false;
  private working = false; private capturing = false; private lastSequence?: string;
  readonly adapter: AgentAdapter; readonly profile: Profile; readonly config: DeliveryConfig; readonly clipboard?: ClipboardPort;
  constructor(root: string, adapter: AgentAdapter, profile: Profile,
    config: DeliveryConfig, clipboard?: ClipboardPort) {
    this.adapter = adapter; this.profile = profile; this.config = config; this.clipboard = clipboard;
    this.core = openCore(root); this.state = new LocalState(root);
  }
  get pending() { return this.pendingImage; }
  discard(): void { this.pendingImage = undefined; }
  /** Arm at the current sequence without reading/submitting historical clipboard contents. */
  async arm(): Promise<void> {
    requireValue(this.clipboard, 'WINDOWS_CLIPBOARD_REQUIRED');
    this.pendingImage = undefined;
    this.lastSequence = await this.clipboard.sequence();
  }
  async submit(bytes: Buffer, baseline?: Baseline, force = false): Promise<string | undefined> {
    const originalHash = sha256(bytes);
    const prepared = await prepareImage(bytes); bytes = prepared.bytes;
    const hash = sha256(bytes);
    if (!force && this.state.duplicate(hash)) { this.lastCaptureStatus = 'duplicate'; return undefined; }
    const info = await sharp(bytes, { limitInputPixels: IMAGE_LIMITS.maxPixels, failOn: 'warning', animated: true }).metadata();
    const contentType = `image/${info.format}` as ImageContentType;
    const taskId = randomUUID();
    // Persist baseline first. A crash cannot publish a task with an unsafe guessed baseline.
    if (!this.state.capture(taskId, hash, baseline, { originalHash, sentHash: hash, transformation: prepared.transformation, width: info.width, height: info.height }, force)) { this.lastCaptureStatus = 'duplicate'; return undefined; }
    try { await this.core.submit(LOCAL_IDENTITY, taskId, { taskId, profileId: this.profile.id, profileVersion: this.profile.version,
      images: [{ fileName: `screenshot.${info.format}`, contentType, byteSize: bytes.length, sha256: hash }] }, [bytes]); } catch (error) { this.state.forgetCapture(taskId); throw error; }
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
      const id = await this.submit(image.bytes, { session: this.clipboard.session, sequence: image.sequence }, force);
      if (this.pendingImage === pendingAtStart) this.pendingImage = undefined;
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
    if (!auto) this.pendingImage = image;
    return { changed: true, image: true, ...(auto ? { id: await this.submit(image.bytes, { session: this.clipboard.session, sequence: image.sequence }) } : {}) };
  }
  async work(signal?: AbortSignal): Promise<boolean> {
    if (this.working || this.cleanupBlocked) return false; this.state.acquireWorker(); this.working = true;
    try {
      const worked = await runOnce(this.core.worker(LOCAL_IDENTITY), this.adapter, [this.profile], 5000, signal);
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
  async copy(id: string): Promise<void> {
    const task = this.get(id); requireValue(task.result && this.clipboard, 'RESULT_OR_CLIPBOARD_UNAVAILABLE');
    const old = this.state.get(id, 'clipboard');
    requireValue(old?.status !== 'pending', 'DELIVERY_IN_PROGRESS');
    try {
      requireValue(await this.clipboard.writeText(task.result.contentMarkdown), 'COPY_FAILED');
      this.state.put(id, 'clipboard', { status: 'succeeded', attempts: (old?.attempts ?? 0) + 1, history: old?.history, smartGuard: old?.smartGuard });
    } catch {
      this.state.put(id, 'clipboard', { status: 'failed', code: 'COPY_FAILED', attempts: (old?.attempts ?? 0) + 1, history: old?.history, smartGuard: old?.smartGuard }); throw new Error('COPY_FAILED');
    }
  }
  async retryDelivery(id: string): Promise<void> { await deliver(this.get(id), this.config, this.state, this.clipboard, true); }
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
