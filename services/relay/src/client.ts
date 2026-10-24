import type { SubmissionMetadata, LeaseProof } from '../../../packages/contracts/src/index.ts';
import type { StartInfo, WorkerPort } from '../../../packages/core/src/core.ts';
import { parseTaskView, requireValue } from '../../../packages/core/src/model.ts';
import type { Claim, TaskView } from '../../../packages/core/src/model.ts';
import { capabilities } from './capabilities.ts';
import type { Capability, Presence } from './capabilities.ts';
export function validateRelayUrl(url: string): void {
  let parsed: URL; try { parsed = new URL(url); } catch { throw new Error('HTTPS_REQUIRED'); }
  requireValue(!parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/' &&
    (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname))), 'HTTPS_REQUIRED');
}
/** Headless Linux deployment only; public/desktop validation never consumes this option. */
export function validateWorkerRelayUrl(url: string, trustedInternalOrigin?: string): void {
  if (!trustedInternalOrigin) { validateRelayUrl(url); return; }
  let parsed: URL; try { parsed = new URL(url); } catch { throw new Error('INVALID_INTERNAL_RELAY'); }
  requireValue(process.platform === 'linux' && url === trustedInternalOrigin && parsed.href === trustedInternalOrigin &&
    parsed.protocol === 'http:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/' &&
    (parsed.hostname === 'relay' || /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname) || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)), 'INVALID_INTERNAL_RELAY');
}
async function bounded(response: Response, max: number): Promise<Buffer> {
  const reader = response.body?.getReader(); requireValue(reader, 'INVALID_RELAY_RESPONSE');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; requireValue(size <= max, 'RELAY_RESPONSE_TOO_LARGE'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks);
}
export class RemoteClient implements WorkerPort {
  private url: string; private token: string;
  private signal?: AbortSignal;
  constructor(url: string, token: string, signal?: AbortSignal, workerTransport?: { trustedInternalOrigin: string }) {
    this.url = url; this.token = token;
    validateWorkerRelayUrl(url, workerTransport?.trustedInternalOrigin); this.signal = signal;
  }
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const timeout = AbortSignal.timeout(15_000);
    let response: Response;
    const options = { ...init, redirect: 'error' as const, signal: this.signal ? AbortSignal.any([this.signal, timeout]) : timeout,
      headers: { ...init.headers, Authorization: `Bearer ${this.token}` } };
    try { response = await fetch(new URL(path, this.url), options); }
    catch (e) {
      if (init.method && init.method !== 'GET') throw e;
      response = await fetch(new URL(path, this.url), options);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`RELAY_${response.status}`); }
    return response;
  }
  private async json<T>(response: Response): Promise<T> { return JSON.parse((await bounded(response, 8 * 1024 * 1024)).toString('utf8')) as T; }
  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(await this.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  }
  async session(): Promise<{ ownerId: string; deviceId: string; role: string }> {
    const s = await this.json<{ ownerId: string; deviceId: string; role: string }>(await this.request('/v1/session'));
    requireValue(s && /^[a-zA-Z0-9_-]{1,64}$/.test(s.ownerId) && /^[a-zA-Z0-9_-]{1,64}$/.test(s.deviceId) && ['desktop', 'worker', 'capture', 'viewer'].includes(s.role), 'INVALID_RELAY_RESPONSE'); return s;
  }
  async workers(): Promise<Presence[]> {
    const rows = await this.json<Presence[]>(await this.request('/v1/workers'));
    requireValue(Array.isArray(rows) && rows.length <= 100, 'INVALID_RELAY_RESPONSE');
    return rows.map(p => { requireValue(p && /^[a-zA-Z0-9_-]{1,64}$/.test(p.deviceId) && typeof p.label === 'string' && p.label.length <= 80 && typeof p.accepting === 'boolean' && Number.isSafeInteger(p.lastSeen), 'INVALID_RELAY_RESPONSE'); return { deviceId: p.deviceId, label: p.label, accepting: p.accepting, lastSeen: p.lastSeen, profiles: capabilities(p.profiles) }; });
  }
  async presence(label: string, profiles: Capability[], accepting: boolean): Promise<void> { await this.post('/v1/worker/presence', { label, profiles, accepting }); }
  async submit(key: string, metadata: SubmissionMetadata, images: Buffer[]): Promise<TaskView> {
    const body = new FormData(); body.append('metadata', JSON.stringify(metadata));
    images.forEach((bytes, i) => body.append(`image-${i}`, new Blob([new Uint8Array(bytes)], { type: metadata.images[i].contentType }), metadata.images[i].fileName));
    return parseTaskView(await this.json(await this.request('/v1/tasks', { method: 'POST', headers: { 'Idempotency-Key': key }, body })));
  }
  async get(id: string): Promise<TaskView> {
    const task = parseTaskView(await this.json(await this.request(`/v1/tasks/${encodeURIComponent(id)}`)));
    requireValue(task.submission.taskId === id, 'INVALID_RELAY_RESPONSE'); return task;
  }
  async list(cursor?: string): Promise<{ tasks: TaskView[]; nextCursor?: string }> {
    const page = await this.json<{ tasks?: unknown[]; nextCursor?: string }>(await this.request(`/v1/tasks${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`));
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
    let value: unknown;
    for (let attempt = 0; ; attempt++) {
      try { value = await this.post(`/v1/worker/tasks/${encodeURIComponent(id)}/complete`, { proof, result }); break; }
      catch (error) { if (attempt === 2 || (error instanceof Error && /^RELAY_4/.test(error.message)) || this.signal?.aborted) throw error; }
    }
    const task = parseTaskView(value);
    requireValue(task.submission.taskId === id && task.activeAttemptId === proof.attemptId, 'INVALID_RELAY_RESPONSE'); return task;
  }
  async file(id: string, fileId: string, maxBytes = 20 * 1024 * 1024): Promise<Buffer> {
    return bounded(await this.request(`/v1/tasks/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`), maxBytes);
  }
}
