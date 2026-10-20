import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import multipart from '@fastify/multipart';
import { timingSafeEqual } from 'node:crypto';
import type { TaskCore, StartInfo } from '../../../packages/core/src/core.ts';
import { CoreError, requireValue } from '../../../packages/core/src/model.ts';
import type { Identity } from '../../../packages/core/src/model.ts';
import type { LeaseProof } from '../../../packages/contracts/src/index.ts';
import { IMAGE_LIMITS, validateSubmissionMetadata } from '../../../packages/contracts/src/index.ts';
export interface Device extends Identity { token: string; role: 'capture' | 'viewer' | 'worker' }
const record = (value: unknown): Record<string, unknown> => {
  requireValue(typeof value === 'object' && value !== null && !Array.isArray(value), 'INVALID_BODY');
  return value as Record<string, unknown>;
};
export async function createRelay(core: TaskCore, devices: readonly Device[]) {
  requireValue(core.mode === 'remote', 'REMOTE_CORE_REQUIRED');
  requireValue(devices.length > 0 && devices.every(d => typeof d.token === 'string' && d.token.length >= 32 &&
    ['capture', 'viewer', 'worker'].includes(d.role) && /^[a-zA-Z0-9_-]{1,64}$/.test(d.ownerId) && /^[a-zA-Z0-9_-]{1,64}$/.test(d.deviceId)) &&
    new Set(devices.map(d => d.token)).size === devices.length, 'INVALID_DEVICE_CONFIG');
  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024, requestTimeout: 30_000 });
  await app.register(multipart, { limits: { files: IMAGE_LIMITS.maxImages, fields: 1, parts: IMAGE_LIMITS.maxImages + 1,
    fileSize: IMAGE_LIMITS.maxImageBytes, fieldSize: 64 * 1024, headerPairs: 100 } });
  const identities = new WeakMap<FastifyRequest, Device>();
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const auth = request.headers.authorization;
    requireValue(typeof auth === 'string' && auth.startsWith('Bearer ') && auth.length <= 512, 'UNAUTHORIZED', 401);
    const supplied = Buffer.from(auth.slice(7));
    const device = devices.find(d => { const expected = Buffer.from(d.token); return supplied.length === expected.length && timingSafeEqual(supplied, expected); });
    requireValue(device, 'UNAUTHORIZED', 401); identities.set(request, device);
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error as { statusCode?: number; code?: string };
    const status = error instanceof CoreError ? error.statusCode : known.statusCode && known.statusCode >= 400 && known.statusCode < 500 ? known.statusCode : 500;
    reply.code(status).send({ error: error instanceof CoreError ? error.code : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST' });
  });
  function identity(request: FastifyRequest, role: 'read' | 'capture' | 'worker'): Device {
    const device = identities.get(request)!;
    requireValue(role === 'read' ? device.role !== 'worker' : device.role === role, 'FORBIDDEN', 403);
    return device;
  }
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
    const task = await core.submit(device, key, metadata, buffers); reply.code(201); return task;
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
    return core.claim(device, body.profiles as { id: string; version: string }[]);
  });
  for (const action of ['start', 'heartbeat', 'complete', 'fail'] as const) {
    app.post<{ Params: { id: string } }>(`/v1/worker/tasks/:id/${action}`, async request => {
      const device = identity(request, 'worker'); const body = record(request.body); const proof = body.proof as LeaseProof;
      if (action === 'start') { core.start(device, request.params.id, proof, body.info as StartInfo); return { ok: true }; }
      if (action === 'heartbeat') { core.heartbeat(device, request.params.id, proof); return { ok: true }; }
      if (action === 'fail') requireValue(record(body.result).status !== 'succeeded', 'INVALID_FAILURE');
      return core.complete(device, request.params.id, proof, body.result);
    });
  }
  await app.ready(); return app;
}
