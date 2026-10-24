import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import type { TaskCore, StartInfo } from '../../../packages/core/src/core.ts';
import { CoreError, requireValue } from '../../../packages/core/src/model.ts';
import type { Identity } from '../../../packages/core/src/model.ts';
import type { LeaseProof } from '../../../packages/contracts/src/index.ts';
import { IMAGE_LIMITS, validateSubmissionMetadata } from '../../../packages/contracts/src/index.ts';
import { capabilities } from './capabilities.ts';
import type { Presence } from './capabilities.ts';
export interface Device extends Identity { token: string; role: 'capture' | 'viewer' | 'worker' | 'desktop' }
export function validateDevices(devices: readonly Device[]): void {
  requireValue(Array.isArray(devices) && devices.length > 0 && devices.length <= 100 && devices.every(d => d && typeof d.token === 'string' && /^[\x21-\x7e]{32,256}$/.test(d.token) &&
    ['capture', 'viewer', 'worker', 'desktop'].includes(d.role) && /^[a-zA-Z0-9_-]{1,64}$/.test(d.ownerId) && /^[a-zA-Z0-9_-]{1,64}$/.test(d.deviceId)) &&
    new Set(devices.map(d => d.token)).size === devices.length, 'INVALID_DEVICE_CONFIG');
}
const record = (value: unknown): Record<string, unknown> => {
  requireValue(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_BODY');
  return value as Record<string, unknown>;
};
export async function createRelay(core: TaskCore, devices: readonly Device[], registry?: () => readonly Device[]) {
  requireValue(core.mode === 'remote', 'REMOTE_CORE_REQUIRED');
  validateDevices(devices);
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024, requestTimeout: 30_000 });
  await app.register(multipart, { limits: { files: IMAGE_LIMITS.maxImages, fields: 1, parts: IMAGE_LIMITS.maxImages + 1,
    fileSize: IMAGE_LIMITS.maxImageBytes, fieldSize: 64 * 1024, headerPairs: 100 } });
  const identities = new WeakMap<FastifyRequest, Device>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (request.url === '/healthz') return;
    const auth = request.headers.authorization;
    requireValue(typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length <= 512, 'UNAUTHORIZED', 401);
    const supplied = Buffer.from(auth.slice(7));
    const current = registry ? registry() : devices;
    const device = current.find(d => { const expected = Buffer.from(d.token); return supplied.length === expected.length && timingSafeEqual(supplied, expected); });
    requireValue(device, 'UNAUTHORIZED', 401); identities.set(request, device);
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error as { statusCode?: number; code?: string };
    const status = error instanceof CoreError ? error.statusCode : known.statusCode && known.statusCode >= 400 && known.statusCode < 500 ? known.statusCode : 500;
    reply.code(status).send({ error: error instanceof CoreError ? error.code : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST' });
  });
  function identity(request: FastifyRequest, role: 'read' | 'capture' | 'worker'): Device {
    const device = identities.get(request)!;
    requireValue(device.role === 'desktop' || (role === 'read' ? device.role !== 'worker' : device.role === role), 'FORBIDDEN', 403);
    return device;
  }
  const presences = (owner: string): Presence[] => core.store.metadata(`worker:${owner}:`).map(row => JSON.parse(row.value));
  const requireSpace = (extra: number, newTask = false) => {
    const tasks = core.store.tasks();
    requireValue((!newTask || tasks.length < 10_000) && tasks.reduce((n, t) => n + [...t.inputs, ...(t.result?.artifacts ?? [])].reduce((m, f) => m + f.byteSize, 0), 0) + extra <= 2 * 1024 * 1024 * 1024, 'RELAY_STORAGE_FULL', 507);
  };
  app.get('/healthz', async () => ({ ok: true, protocol: 1 }));
  app.get('/v1/session', async request => { const d = identities.get(request)!; return { ownerId: d.ownerId, deviceId: d.deviceId, role: d.role }; });
  app.get('/v1/workers', async request => presences(identity(request, 'read').ownerId));
  app.post('/v1/worker/presence', async request => {
    const d = identity(request, 'worker'); const b = record(request.body);
    requireValue(typeof b.label === 'string' && b.label.length > 0 && b.label.length <= 80 && ![...b.label].some(c => c.charCodeAt(0) < 32) && typeof b.accepting === 'boolean', 'INVALID_PRESENCE');
    const presence: Presence = { deviceId: d.deviceId, label: b.label, profiles: capabilities(b.profiles), accepting: b.accepting, lastSeen: Date.now() };
    core.store.putMetadata(`worker:${d.ownerId}:${d.deviceId}`, JSON.stringify(presence)); return presence;
  });
  app.post('/v1/tasks', async (request, reply) => {
    const device = identity(request, 'capture');
    const key = request.headers['idempotency-key'];
    requireValue(typeof key === 'string', 'INVALID_IDEMPOTENCY_KEY');
    let metadata: unknown; const buffers: Buffer[] = []; let total = 0;
    try {
    for await (const part of request.parts()) {
      if (part.type === 'field') {
        requireValue(metadata === undefined && buffers.length === 0 && part.fieldname === 'metadata' && !part.valueTruncated && typeof part.value === 'string', 'INVALID_MULTIPART');
        try { metadata = JSON.parse(part.value); } catch { throw new CoreError('INVALID_METADATA'); }
        const parsed = validateSubmissionMetadata(metadata); requireValue(parsed.ok, 'INVALID_SUBMISSION'); metadata = parsed.value;
      } else {
        const parsed = validateSubmissionMetadata(metadata); requireValue(parsed.ok, 'METADATA_FIRST');
        const expected = parsed.value.images[buffers.length];
        requireValue(expected && part.fieldname === `image-${buffers.length}` && part.mimetype === expected.contentType, 'INVALID_MULTIPART');
        total += expected.byteSize; requireValue(total <= IMAGE_LIMITS.maxTotalBytes, 'UPLOAD_TOO_LARGE', 413);
        const bytes = await part.toBuffer(); requireValue(!part.file.truncated, 'UPLOAD_TOO_LARGE', 413); requireValue(bytes.length === expected.byteSize, 'IMAGE_INTEGRITY'); buffers.push(bytes);
      }
    }
    } catch (error) {
      if (error instanceof CoreError) throw error;
      throw new CoreError('INVALID_MULTIPART', (error as { statusCode?: number }).statusCode === 413 ? 413 : 400);
    }
    const parsed = validateSubmissionMetadata(metadata); requireValue(parsed.ok, 'INVALID_SUBMISSION');
    const m = parsed.value;
    requireValue(device.role !== 'desktop' || m.targetWorkerId, 'TARGET_REQUIRED');
    if (m.targetWorkerId && !core.store.get(m.taskId)) {
      const target = presences(device.ownerId).find(p => p.deviceId === m.targetWorkerId);
      requireValue(target?.profiles.some(p => p.id === m.profileId && p.version === m.profileVersion && p.fingerprint === m.profileFingerprint && p.provider === m.provider), 'UNAPPROVED_TARGET', 409);
    }
    if (!core.store.get(m.taskId)) requireSpace(buffers.reduce((n, b) => n + b.length, 0), true);
    const task = await core.submit(device, key, m, buffers); reply.code(201); return task;
  });
  app.get('/v1/tasks', async request => {
    const device = identity(request, 'read'); const query = request.query as Record<string, unknown>;
    requireValue(query.cursor === undefined || typeof query.cursor === 'string', 'INVALID_CURSOR');
    return core.list(device.ownerId, query.cursor as string | undefined, query.limit === undefined ? 50 : Number(query.limit));
  });
  app.get<{ Params: { id: string } }>('/v1/tasks/:id', async request => core.get(identity(request, 'read').ownerId, request.params.id));
  app.get<{ Params: { id: string; fileId: string } }>('/v1/tasks/:id/files/:fileId', async (request, reply) => {
    const device = identities.get(request)!;
    const bytes = core.file(device.ownerId, request.params.id, request.params.fileId, device.role === 'worker' ? device.deviceId : undefined);
    reply.header('X-Content-Type-Options', 'nosniff').header('Content-Disposition', 'attachment').type('application/octet-stream'); return bytes;
  });
  app.post('/v1/worker/claim', async request => {
    const device = identity(request, 'worker'); const body = record(request.body);
    if (device.role === 'desktop') {
      const presence = presences(device.ownerId).find(p => p.deviceId === device.deviceId);
      requireValue(presence?.accepting && Date.now() - presence.lastSeen < 60_000, 'WORKER_PAUSED', 409);
      requireValue(Array.isArray(body.profiles) && body.profiles.every(p => presence.profiles.some(c => c.id === p.id && c.version === p.version)), 'UNAPPROVED_PROFILE', 403);
    }
    return core.claim(device, body.profiles as { id: string; version: string }[]);
  });
  for (const action of ['start', 'heartbeat', 'complete', 'fail'] as const) {
    app.post<{ Params: { id: string } }>(`/v1/worker/tasks/:id/${action}`, async request => {
      const device = identity(request, 'worker'); const body = record(request.body); const proof = body.proof as LeaseProof;
      if (action === 'start') { core.start(device, request.params.id, proof, body.info as StartInfo); return { ok: true }; }
      if (action === 'heartbeat') { core.heartbeat(device, request.params.id, proof); return { ok: true }; }
      if (action === 'fail') requireValue(record(body.result).status !== 'succeeded', 'INVALID_FAILURE');
      requireSpace(8 * 1024 * 1024);
      return core.complete(device, request.params.id, proof, body.result);
    });
  }
  await app.ready(); return app;
}
