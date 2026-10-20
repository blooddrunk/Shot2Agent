/**
 * Prototype protocol contracts. There is no relay/worker implementation yet.
 * Runtime validation of upload bytes, identity, auth and worker leases must be
 * implemented separately at their respective trust boundaries.
 */

export const TASK_STATES = [
  'queued',
  'leased',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'canceled',
  'execution_unknown',
] as const;

export type TaskState = (typeof TASK_STATES)[number];

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'succeeded', 'failed', 'timed_out', 'canceled', 'execution_unknown',
]);

const TRANSITIONS: Readonly<Record<TaskState, readonly TaskState[]>> = {
  queued: ['leased', 'canceled'],
  leased: ['running', 'queued', 'canceled', 'execution_unknown'],
  running: ['succeeded', 'failed', 'timed_out', 'canceled', 'execution_unknown'],
  succeeded: [],
  failed: [],
  timed_out: [],
  canceled: [],
  execution_unknown: [],
};

export function isTaskState(input: unknown): input is TaskState {
  return typeof input === 'string' && TASK_STATES.some((state) => state === input);
}

/** A pure logical state check. The relay must also enforce attempt/lease fencing. */
export function canTransitionTask(from: unknown, to: unknown): boolean {
  return isTaskState(from) && isTaskState(to) && TRANSITIONS[from].includes(to);
}

export function isTerminalTaskState(input: unknown): input is TaskState {
  return isTaskState(input) && TERMINAL_STATES.has(input);
}

export const IMAGE_LIMITS = Object.freeze({
  maxImages: 20,
  maxImageBytes: 20 * 1024 * 1024,
  maxTotalBytes: 60 * 1024 * 1024,
  maxInstructionsLength: 10_000,
});

export const IMAGE_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;
export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export interface ImageMetadata {
  fileName: string;
  contentType: ImageContentType;
  byteSize: number;
  sha256: string;
}

export interface SubmissionMetadata {
  taskId: string;
  profileId: string;
  profileVersion: string;
  images: ImageMetadata[];
  taskInstructions?: string;
}

export type ValidationResult =
  | { ok: true; value: SubmissionMetadata }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCleanFileName(input: unknown): input is string {
  return typeof input === 'string'
    && input.length > 0
    && input.length <= 255
    && input !== '.'
    && input !== '..'
    && !/[\\/\x00-\x1f\x7f]/u.test(input);
}

/**
 * Validates a JSON metadata envelope only. The API must stream and hash the
 * actual image bytes and independently detect file type before accepting them.
 */
export function validateSubmissionMetadata(input: unknown): ValidationResult {
  if (!isRecord(input)) return { ok: false, errors: ['submission must be an object'] };
  const errors: string[] = [];

  if (typeof input.taskId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.taskId)) {
    errors.push('taskId must be a UUID');
  }
  if (typeof input.profileId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(input.profileId)) {
    errors.push('profileId must be a stable lowercase slug');
  }
  if (typeof input.profileVersion !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(input.profileVersion)) {
    errors.push('profileVersion must be a nonempty version token');
  }
  if (input.taskInstructions !== undefined &&
    (typeof input.taskInstructions !== 'string' ||
      input.taskInstructions.length > IMAGE_LIMITS.maxInstructionsLength)) {
    errors.push('taskInstructions must be a bounded string');
  }

  if (!Array.isArray(input.images) ||
    input.images.length < 1 || input.images.length > IMAGE_LIMITS.maxImages) {
    errors.push(`images must contain 1-${IMAGE_LIMITS.maxImages} entries`);
  } else {
    let total = 0;
    input.images.forEach((image: unknown, index: number) => {
      if (!isRecord(image)) {
        errors.push(`images[${index}] must be an object`);
        return;
      }
      if (!isCleanFileName(image.fileName)) errors.push(`images[${index}].fileName is unsafe`);
      if (!IMAGE_CONTENT_TYPES.includes(image.contentType as ImageContentType)) {
        errors.push(`images[${index}].contentType is unsupported`);
      }
      if (typeof image.byteSize !== 'number' || !Number.isSafeInteger(image.byteSize) ||
        image.byteSize <= 0 || image.byteSize > IMAGE_LIMITS.maxImageBytes) {
        errors.push(`images[${index}].byteSize exceeds allowed range`);
      } else {
        total += image.byteSize;
      }
      if (typeof image.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(image.sha256)) {
        errors.push(`images[${index}].sha256 must be 64 hex characters`);
      }
    });
    if (total > IMAGE_LIMITS.maxTotalBytes) errors.push('total image size exceeds limit');
  }

  if (errors.length > 0) return { ok: false, errors };
  // Fields have been narrowed by explicit runtime checks above. Strip unknown
  // client-supplied keys rather than persisting arbitrary objects.
  return {
    ok: true,
    value: {
      taskId: input.taskId as string,
      profileId: input.profileId as string,
      profileVersion: input.profileVersion as string,
      images: (input.images as ImageMetadata[]).map((image) => ({
        fileName: image.fileName,
        contentType: image.contentType,
        byteSize: image.byteSize,
        sha256: image.sha256.toLowerCase(),
      })),
      ...(input.taskInstructions === undefined ? {} : { taskInstructions: input.taskInstructions as string }),
    },
  };
}
