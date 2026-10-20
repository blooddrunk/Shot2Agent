import type { SubmissionMetadata, LeaseProof } from '../../../packages/contracts/src/index.ts';
import type { StartInfo, WorkerPort } from '../../../packages/core/src/core.ts';
import { parseTaskView, requireValue } from '../../../packages/core/src/model.ts';
import type { Claim, TaskView } from '../../../packages/core/src/model.ts';
export class RemoteClient implements WorkerPort {
  private url: string; private token: string;
  constructor(url: string, token: string) {
    this.url = url; this.token = token;
    const parsed = new URL(url);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' ||
      (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)))) throw new Error('HTTPS_REQUIRED');
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(path, this.url), { ...init, redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { ...init.headers, Authorization: `Bearer ${this.token}` } });
    if (!response.ok) throw new Error(`RELAY_${response.status}`);
    return response;
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    return (await this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<T>;
  }
  async submit(key: string, metadata: SubmissionMetadata, images: Buffer[]): Promise<TaskView> {
    const body = new FormData(); body.append('metadata', JSON.stringify(metadata));
    images.forEach((bytes, i) => body.append(`image-${i}`, new Blob([new Uint8Array(bytes)], { type: metadata.images[i].contentType }), metadata.images[i].fileName));
    return parseTaskView(await (await this.request('/v1/tasks', { method: 'POST', headers: { 'Idempotency-Key': key }, body })).json());
  }
  async get(id: string): Promise<TaskView> {
    const task = parseTaskView(await (await this.request(`/v1/tasks/${encodeURIComponent(id)}`)).json());
    requireValue(task.submission.taskId === id, 'INVALID_RELAY_RESPONSE'); return task;
  }
  async list(): Promise<{ tasks: TaskView[]; nextCursor?: string }> {
    const page = await (await this.request('/v1/tasks')).json() as { tasks?: unknown[]; nextCursor?: string };
    requireValue(page && Array.isArray(page.tasks) && (page.nextCursor === undefined || typeof page.nextCursor === 'string'), 'INVALID_RELAY_RESPONSE');
    return { tasks: page.tasks.map(parseTaskView), ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
  }
  async claim(profiles: { id: string; version: string }[]): Promise<Claim | null> {
    const value = await this.post<Claim | null>('/v1/worker/claim', { profiles });
    if (value === null) return null;
    const task = parseTaskView(value.task);
    requireValue(task.status === 'leased' && value.proof && typeof value.proof.attemptId === 'string' &&
      typeof value.proof.token === 'string' && /^[0-9a-f-]{36}$/.test(value.proof.token) &&
      task.activeAttemptId === value.proof.attemptId && Number.isSafeInteger(value.leaseUntil), 'INVALID_RELAY_RESPONSE');
    return { task, proof: value.proof, leaseUntil: value.leaseUntil };
  }
  async start(id: string, proof: LeaseProof, info: StartInfo): Promise<void> { await this.post(`/v1/worker/tasks/${encodeURIComponent(id)}/start`, { proof, info }); }
  async heartbeat(id: string, proof: LeaseProof): Promise<void> { await this.post(`/v1/worker/tasks/${encodeURIComponent(id)}/heartbeat`, { proof }); }
  async complete(id: string, proof: LeaseProof, result: unknown): Promise<TaskView> {
    const task = parseTaskView(await this.post(`/v1/worker/tasks/${encodeURIComponent(id)}/complete`, { proof, result }));
    requireValue(task.submission.taskId === id && task.activeAttemptId === proof.attemptId, 'INVALID_RELAY_RESPONSE'); return task;
  }
  async file(id: string, fileId: string): Promise<Buffer> {
    return Buffer.from(await (await this.request(`/v1/tasks/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`)).arrayBuffer());
  }
}
