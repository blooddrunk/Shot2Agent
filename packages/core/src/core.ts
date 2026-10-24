import { randomUUID, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { canTransitionTask, validateAgentResult, validateSubmissionMetadata } from '../../contracts/src/index.ts';
import type { LeaseProof, TaskState, FileReference } from '../../contracts/src/index.ts';
import { PrivateBlobStore, sha256, verifyImage } from './blobs.ts';
import type { BlobStore } from './blobs.ts';
import { SqliteTaskStore, privateDirectory } from './store.ts';
import type { TaskStore } from './store.ts';
import { requireValue } from './model.ts';
import type { Attempt, Claim, Identity, Mode, Task, TaskView } from './model.ts';
export interface StartInfo { profileFingerprint: string; adapterName: string; adapterVersion: string; timeoutMs: number }
export interface WorkerPort {
  claim(profiles: { id: string; version: string }[]): Promise<Claim | null>;
  start(id: string, proof: LeaseProof, info: StartInfo): Promise<void>;
  heartbeat(id: string, proof: LeaseProof): Promise<void>;
  complete(id: string, proof: LeaseProof, result: unknown): Promise<TaskView>;
  file(id: string, fileId: string): Promise<Buffer>;
}
export class TaskCore {
  readonly store: TaskStore; readonly blobs: BlobStore; readonly mode: Mode;
  private now: () => number; readonly leaseMs: number;
  constructor(store: TaskStore, blobs: BlobStore, mode: Mode,
    now: () => number = Date.now, leaseMs = 30_000) {
    this.store = store; this.blobs = blobs; this.mode = mode; this.now = now; this.leaseMs = leaseMs;
    requireValue(Number.isSafeInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 300_000, 'INVALID_LEASE_DURATION');
    this.recoverBlobCleanup();
  }
  private view(task: Task): TaskView {
    const { digest: _digest, idempotencyKey: _key, ...publicTask } = task;
    void _digest; void _key;
    return { ...publicTask, attempts: this.store.attempts(task.submission.taskId).map(attempt => {
      const { token: _token, completionDigest: _completion, ...visible } = attempt;
      void _token; void _completion;
      return visible;
    }) };
  }
  private owned(id: string, ownerId: string): Task {
    const task = this.store.get(id);
    requireValue(task && task.ownerId === ownerId, 'TASK_NOT_FOUND', 404);
    return task;
  }
  private move(task: Task, to: TaskState): void {
    requireValue(canTransitionTask(task.status, to), 'INVALID_TRANSITION', 409);
    task.status = to; task.updatedAt = this.now();
  }
  async submit(identity: Identity, key: string, input: unknown, bytes: Buffer[]): Promise<TaskView> {
    requireValue(typeof key === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(key), 'INVALID_IDEMPOTENCY_KEY');
    const parsed = validateSubmissionMetadata(input);
    requireValue(parsed.ok, 'INVALID_SUBMISSION');
    const submission = parsed.value;
    requireValue(bytes.length === submission.images.length, 'IMAGE_COUNT');
    // Sequential decoding bounds peak memory to one image rather than twenty.
    for (let i = 0; i < bytes.length; i++) await verifyImage(bytes[i], submission.images[i]);
    const digest = sha256(JSON.stringify({ origin: identity.deviceId, submission }));
    const staged: FileReference[] = [];
    try {
      return this.store.transaction(() => {
        const existing = this.store.get(submission.taskId);
        const keyed = this.store.tasks().find(t => t.ownerId === identity.ownerId && t.idempotencyKey === key);
        if (existing || keyed) {
          requireValue(existing && keyed && existing.submission.taskId === keyed.submission.taskId &&
            existing.ownerId === identity.ownerId && existing.digest === digest, 'IDEMPOTENCY_CONFLICT', 409);
          return this.view(existing);
        }
        for (let i = 0; i < bytes.length; i++) staged.push(this.blobs.put(bytes[i], submission.images[i]));
        const task: Task = { schemaVersion: 1, mode: this.mode, ownerId: identity.ownerId, originDeviceId: identity.deviceId,
          submission, idempotencyKey: key, digest, status: 'queued', createdAt: this.now(), updatedAt: this.now(), inputs: staged };
        this.store.put(task);
        return this.view(task);
      });
    } catch (error) { for (const file of staged) this.blobs.remove(file); throw error; }
  }
  /** Lazy recovery on every queue/read/lease operation, using coordinator time. */
  private recover(): void {
    for (const task of this.store.tasks()) {
      if (task.status !== 'leased' && task.status !== 'running') continue;
      const attempt = this.store.attempts(task.submission.taskId).find(a => a.attemptId === task.activeAttemptId)!;
      if (attempt.leaseUntil > this.now() && (attempt.deadline === undefined || attempt.deadline > this.now())) continue;
      const started = task.status === 'running';
      this.move(task, started ? 'execution_unknown' : 'queued');
      attempt.status = started ? 'execution_unknown' : 'queued'; attempt.finishedAt = this.now();
      if (started) task.result = { taskId: task.submission.taskId, attemptId: attempt.attemptId, status: 'execution_unknown',
        summary: 'Execution outcome is unknown; review before resubmitting.', contentMarkdown: '', artifacts: [],
        errorCode: attempt.deadline !== undefined && attempt.deadline <= this.now() ? 'EXECUTION_DEADLINE' : 'LEASE_EXPIRED_AFTER_START',
        profileId: task.submission.profileId, profileVersion: task.submission.profileVersion, workerId: attempt.workerId,
        adapterName: attempt.adapterName!, adapterVersion: attempt.adapterVersion!, startedAt: attempt.startedAt, finishedAt: this.now() };
      this.store.putAttempt(attempt); this.store.put(task);
    }
  }
  get(owner: string, id: string): TaskView {
    return this.store.transaction(() => { this.recover(); return this.view(this.owned(id, owner)); });
  }
  list(owner: string, cursor?: string, limit = 50): { tasks: TaskView[]; nextCursor?: string } {
    requireValue(Number.isInteger(limit) && limit > 0 && limit <= 100, 'INVALID_LIMIT');
    return this.store.transaction(() => {
      this.recover();
      const tasks = this.store.tasks().filter(t => t.ownerId === owner);
      const start = cursor === undefined ? 0 : tasks.findIndex(t => t.submission.taskId === cursor) + 1;
      requireValue(cursor === undefined || start > 0, 'INVALID_CURSOR');
      const page = tasks.slice(start, start + limit);
      return { tasks: page.map(t => this.view(t)), ...(start + limit < tasks.length ? { nextCursor: page.at(-1)!.submission.taskId } : {}) };
    });
  }
  claim(identity: Identity, profiles: { id: string; version: string }[]): Claim | null {
    requireValue(Array.isArray(profiles) && profiles.length > 0 && profiles.length <= 20 && profiles.every(p => p && typeof p.id === 'string' && typeof p.version === 'string'), 'INVALID_CAPABILITIES');
    return this.store.transaction(() => {
      this.recover();
      const tasks = this.store.tasks();
      // M1 is deliberately a single-execution coordinator, even across Worker identities.
      if (tasks.some(t => t.status === 'leased' || t.status === 'running')) return null;
      const task = tasks.find(t => t.ownerId === identity.ownerId && t.status === 'queued' &&
        (!t.submission.targetWorkerId || t.submission.targetWorkerId === identity.deviceId) &&
        profiles.some(p => p.id === t.submission.profileId && p.version === t.submission.profileVersion));
      if (!task) return null;
      const attempt: Attempt = { attemptId: randomUUID(), taskId: task.submission.taskId, workerId: identity.deviceId,
        token: randomUUID(), status: 'leased', leasedAt: this.now(), leaseUntil: this.now() + this.leaseMs };
      this.move(task, 'leased'); task.activeAttemptId = attempt.attemptId;
      this.store.put(task); this.store.putAttempt(attempt);
      return { task: this.view(task), proof: { attemptId: attempt.attemptId, token: attempt.token }, leaseUntil: attempt.leaseUntil };
    });
  }
  private fenced(identity: Identity, id: string, proof: LeaseProof): { task: Task; attempt: Attempt } {
    const task = this.owned(id, identity.ownerId);
    requireValue(proof && typeof proof.attemptId === 'string' && typeof proof.token === 'string' && proof.token.length <= 128, 'INVALID_PROOF');
    const attempt = this.store.attempts(id).find(a => a.attemptId === proof.attemptId);
    const expected = Buffer.from(attempt?.token ?? ''); const supplied = Buffer.from(proof.token);
    requireValue(attempt && task.activeAttemptId === attempt.attemptId && attempt.workerId === identity.deviceId &&
      expected.length === supplied.length && timingSafeEqual(expected, supplied), 'STALE_LEASE', 409);
    return { task, attempt };
  }
  start(identity: Identity, id: string, proof: LeaseProof, info: StartInfo): void {
    requireValue(info && /^[a-f0-9]{64}$/.test(info.profileFingerprint) &&
      typeof info.adapterName === 'string' && /^[a-z0-9-]{1,64}$/.test(info.adapterName) &&
      typeof info.adapterVersion === 'string' && /^[a-zA-Z0-9._-]{1,64}$/.test(info.adapterVersion) &&
      Number.isSafeInteger(info.timeoutMs) && info.timeoutMs >= 10 && info.timeoutMs <= 3_600_000, 'INVALID_START');
    this.store.transaction(() => {
      this.recover(); const { task, attempt } = this.fenced(identity, id, proof);
      requireValue(!task.submission.targetWorkerId || task.submission.profileFingerprint === info.profileFingerprint, 'PROFILE_BINDING_CHANGED', 409);
      if (task.status === 'running') {
        requireValue(attempt.profileFingerprint === info.profileFingerprint && attempt.adapterName === info.adapterName && attempt.adapterVersion === info.adapterVersion &&
          attempt.deadline === attempt.startedAt! + info.timeoutMs, 'START_CONFLICT', 409); return;
      }
      this.move(task, 'running'); attempt.status = 'running'; attempt.startedAt = this.now(); attempt.deadline = this.now() + info.timeoutMs;
      attempt.profileFingerprint = info.profileFingerprint; attempt.adapterName = info.adapterName; attempt.adapterVersion = info.adapterVersion;
      this.store.putAttempt(attempt); this.store.put(task);
    });
  }
  heartbeat(identity: Identity, id: string, proof: LeaseProof): void {
    this.store.transaction(() => {
      this.recover(); const { task, attempt } = this.fenced(identity, id, proof);
      requireValue(task.status === 'leased' || task.status === 'running', 'STALE_LEASE', 409);
      attempt.leaseUntil = this.now() + this.leaseMs; this.store.putAttempt(attempt);
    });
  }
  complete(identity: Identity, id: string, proof: LeaseProof, input: unknown): TaskView {
    let result;
    try { result = validateAgentResult(input); } catch { requireValue(false, 'INVALID_RESULT'); }
    const digest = sha256(JSON.stringify(result));
    const staged: FileReference[] = [];
    try {
      return this.store.transaction(() => {
        this.recover(); const { task, attempt } = this.fenced(identity, id, proof);
        if (attempt.completionDigest) { requireValue(attempt.completionDigest === digest, 'RESULT_CONFLICT', 409); return this.view(task); }
        requireValue(task.status === 'running', 'STALE_LEASE', 409);
        for (const artifact of result.artifacts) {
          const bytes = Buffer.from(artifact.dataBase64, 'base64');
          requireValue(bytes.length <= 1024 * 1024 && sha256(bytes) === artifact.sha256, 'ARTIFACT_INTEGRITY');
          staged.push(this.blobs.put(bytes, artifact));
        }
        const { artifacts: _artifacts, ...text } = result; void _artifacts;
        this.move(task, result.status); attempt.status = result.status; attempt.finishedAt = this.now(); attempt.completionDigest = digest;
        task.result = { ...text, artifacts: staged, taskId: id, attemptId: attempt.attemptId,
          profileId: task.submission.profileId, profileVersion: task.submission.profileVersion, workerId: attempt.workerId,
          adapterName: attempt.adapterName!, adapterVersion: attempt.adapterVersion!, startedAt: attempt.startedAt, finishedAt: this.now() };
        this.store.putAttempt(attempt); this.store.put(task); return this.view(task);
      });
    } catch (error) { for (const file of staged) this.blobs.remove(file); throw error; }
  }
  file(owner: string, id: string, fileId: string, worker?: string): Buffer {
    return this.store.transaction(() => {
      this.recover(); const task = this.owned(id, owner);
      if (worker !== undefined) {
        const attempt = this.store.attempts(id).find(a => a.attemptId === task.activeAttemptId);
        requireValue(attempt?.workerId === worker && (task.status === 'leased' || task.status === 'running'), 'FILE_FORBIDDEN', 403);
      }
      const files = worker ? task.inputs : [...task.inputs, ...(task.result?.artifacts ?? [])];
      const reference = files.find(file => file.fileId === fileId);
      requireValue(reference, 'FILE_NOT_FOUND', 404); return this.blobs.read(reference);
    });
  }
  /** Unknown outcomes require explicit operator review; deletion never changes execution state. */
  deleteTasks(owner: string, ids: readonly string[], options: { allowMissing?: boolean; reviewedUnknown?: boolean } = {}): string[] {
    requireValue(typeof owner === 'string' && ids.length > 0 && ids.length <= 10_000 &&
      ids.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) && new Set(ids).size === ids.length, 'INVALID_TASK_DELETE');
    const deleted = this.store.transaction(() => {
      this.recover();
      const tasks = ids.flatMap(id => {
        const task = this.store.get(id);
        if (!task && options.allowMissing) return [];
        requireValue(task && task.ownerId === owner, 'TASK_NOT_FOUND', 404);
        return [task];
      });
      for (const task of tasks) {
        requireValue(task.status !== 'execution_unknown' || options.reviewedUnknown === true, 'TASK_EXECUTION_UNKNOWN_REQUIRES_REVIEW', 409);
        requireValue(['succeeded', 'failed', 'timed_out', 'canceled', 'execution_unknown'].includes(task.status), 'TASK_NOT_TERMINAL', 409);
      }
      this.store.deleteTasks(ids);
      return ids.slice();
    });
    this.recoverBlobCleanup();
    return deleted;
  }
  /** Idempotent file cleanup resumes from the journal after interruption. */
  recoverBlobCleanup(): void {
    for (const reference of this.store.pendingBlobCleanup()) {
      this.blobs.remove(reference);
      this.store.transaction(() => this.store.finishBlobCleanup(reference.fileId));
    }
  }
  worker(identity: Identity): WorkerPort {
    return {
      claim: async profiles => this.claim(identity, profiles), start: async (id, proof, info) => this.start(identity, id, proof, info),
      heartbeat: async (id, proof) => this.heartbeat(identity, id, proof), complete: async (id, proof, result) => this.complete(identity, id, proof, result),
      file: async (id, fileId) => this.file(identity.ownerId, id, fileId, identity.deviceId),
    };
  }
  close(): void { this.store.close(); }
}
export function openCore(root: string, mode: Mode = 'local', now?: () => number, leaseMs?: number): TaskCore {
  privateDirectory(root);
  return new TaskCore(new SqliteTaskStore(join(root, 'tasks.sqlite'), mode), new PrivateBlobStore(join(root, 'blobs')), mode, now, leaseMs);
}
