import { isTaskState, validateAgentResult, validateSubmissionMetadata } from '../../contracts/src/index.ts';
import type { AgentResult, FileReference, SubmissionMetadata, TaskState } from '../../contracts/src/index.ts';
export type Mode = 'local' | 'remote';
export interface Identity { ownerId: string; deviceId: string }
export interface Attempt {
  attemptId: string; taskId: string; workerId: string; token: string;
  status: TaskState; leasedAt: number; leaseUntil: number; startedAt?: number;
  deadline?: number; finishedAt?: number; profileFingerprint?: string;
  adapterName?: string; adapterVersion?: string; completionDigest?: string;
}
export interface StoredResult extends Omit<AgentResult, 'artifacts'> {
  taskId: string; attemptId: string; profileId: string; profileVersion: string;
  workerId: string; adapterName: string; adapterVersion: string;
  startedAt?: number; finishedAt: number; artifacts: FileReference[];
}
export interface Task {
  schemaVersion: 1; mode: Mode; ownerId: string; originDeviceId: string;
  submission: SubmissionMetadata; idempotencyKey: string; digest: string;
  status: TaskState; createdAt: number; updatedAt: number;
  inputs: FileReference[]; activeAttemptId?: string; result?: StoredResult;
}
export interface TaskView extends Omit<Task, 'digest' | 'idempotencyKey'> { attempts: Omit<Attempt, 'token' | 'completionDigest'>[] }
export interface Claim { task: TaskView; proof: { attemptId: string; token: string }; leaseUntil: number }
export class CoreError extends Error {
  code: string; statusCode: number;
  constructor(code: string, statusCode = 400) { super(code); this.code = code; this.statusCode = statusCode; }
}
export function requireValue(condition: unknown, code: string, statusCode = 400): asserts condition {
  if (!condition) throw new CoreError(code, statusCode);
}

/** HTTP consumers validate before handing a response to a Worker/Agent. */
export function parseTaskView(input: unknown): TaskView {
  const task = input as TaskView | null;
  requireValue(task && task.schemaVersion === 1 && ['local', 'remote'].includes(task.mode) &&
    typeof task.ownerId === 'string' && typeof task.originDeviceId === 'string' &&
    Number.isSafeInteger(task.createdAt) && Number.isSafeInteger(task.updatedAt) &&
    isTaskState(task.status) && Array.isArray(task.attempts) && Array.isArray(task.inputs), 'INVALID_RELAY_RESPONSE');
  const parsed = validateSubmissionMetadata(task.submission);
  requireValue(parsed.ok && task.inputs.length === parsed.value.images.length, 'INVALID_RELAY_RESPONSE');
  const validFile = (file: FileReference): boolean => Boolean(file && /^[0-9a-f-]{36}$/.test(file.fileId) &&
    typeof file.fileName === 'string' && typeof file.contentType === 'string' && Number.isSafeInteger(file.byteSize) &&
    file.byteSize >= 0 && /^[a-f0-9]{64}$/.test(file.sha256));
  requireValue(task.inputs.every((file, index) => validFile(file) && file.sha256 === parsed.value.images[index].sha256 &&
    file.byteSize === parsed.value.images[index].byteSize && file.contentType === parsed.value.images[index].contentType), 'INVALID_RELAY_RESPONSE');
  requireValue(task.attempts.every(a => a && typeof a.attemptId === 'string' && a.taskId === parsed.value.taskId &&
    typeof a.workerId === 'string' && isTaskState(a.status) && Number.isSafeInteger(a.leaseUntil)), 'INVALID_RELAY_RESPONSE');
  if (task.result !== undefined) {
    const result = task.result;
    requireValue(result && result.taskId === parsed.value.taskId && typeof result.attemptId === 'string' &&
      result.status === task.status && result.profileId === parsed.value.profileId && result.profileVersion === parsed.value.profileVersion &&
      typeof result.workerId === 'string' && typeof result.adapterName === 'string' && typeof result.adapterVersion === 'string' &&
      Number.isSafeInteger(result.finishedAt) && Array.isArray(result.artifacts) && result.artifacts.every(validFile), 'INVALID_RELAY_RESPONSE');
    try { validateAgentResult({ ...result, artifacts: [] }); } catch { requireValue(false, 'INVALID_RELAY_RESPONSE'); }
  }
  return { ...task, submission: parsed.value };
}
