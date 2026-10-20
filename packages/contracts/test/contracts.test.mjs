import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMAGE_LIMITS,
  TASK_STATES,
  canTransitionTask,
  isTaskState,
  isTerminalTaskState,
  validateSubmissionMetadata,
} from '../src/index.ts';

const image = (overrides = {}) => ({
  fileName: 'screenshot.png',
  contentType: 'image/png',
  byteSize: 512,
  sha256: 'ab'.repeat(32),
  ...overrides,
});
const draft = (overrides = {}) => ({
  taskId: '4bed1ccc-c7c8-4fcf-a3ff-b37406c8dc16',
  profileId: 'image-qa',
  profileVersion: 'v1',
  images: [image()],
  ...overrides,
});

const remoteStates = [
  'queued', 'leased', 'running', 'succeeded', 'failed',
  'timed_out', 'canceled', 'execution_unknown',
];

test('all declared states are unique and valid', () => {
  assert.deepEqual(TASK_STATES, remoteStates);
  assert.equal(new Set(TASK_STATES).size, TASK_STATES.length);
  for (const state of TASK_STATES) assert.equal(isTaskState(state), true);
  for (const local of ['awaiting_confirmation', 'pending_upload', null, undefined, 'not-a-state']) {
    assert.equal(isTaskState(local), false);
  }
});

test('valid transitions exclude replay of terminal task states', () => {
  assert.equal(canTransitionTask('queued', 'leased'), true);
  assert.equal(canTransitionTask('leased', 'queued'), true);
  assert.equal(canTransitionTask('leased', 'running'), true);
  assert.equal(canTransitionTask('running', 'execution_unknown'), true);
  assert.equal(canTransitionTask('running', 'succeeded'), true);
  assert.equal(canTransitionTask('queued', 'running'), false);
  assert.equal(canTransitionTask('succeeded', 'queued'), false);
  assert.equal(canTransitionTask('failed', 'leased'), false);
  assert.equal(canTransitionTask('execution_unknown', 'running'), false);
  assert.equal(canTransitionTask('queued', 'queued'), false);
  assert.equal(canTransitionTask('bogus', 'queued'), false);
});

test('only finished or uncertain states are terminal', () => {
  assert.equal(isTerminalTaskState('running'), false);
  assert.equal(isTerminalTaskState('leased'), false);
  for (const state of ['succeeded', 'failed', 'canceled', 'timed_out', 'execution_unknown']) {
    assert.equal(isTerminalTaskState(state), true);
  }
});

test('valid one-image and ordered batch metadata can be normalized', () => {
  const one = validateSubmissionMetadata(draft({ unwanted: 'discard' }));
  assert.equal(one.ok, true);
  assert.equal(one.value.unwanted, undefined);
  const many = validateSubmissionMetadata(draft({
    images: [image({ fileName: '1.png' }), image({ fileName: '2.png', sha256: 'AB'.repeat(32) })],
    taskInstructions: 'Transcribe both screenshots in order.',
  }));
  assert.equal(many.ok, true);
  assert.deepEqual(many.value.images.map((x) => x.fileName), ['1.png', '2.png']);
  assert.equal(many.value.images[1].sha256, 'ab'.repeat(32));
});

test('rejects missing images, invalid IDs and too-large instructions', () => {
  for (const invalid of [
    null,
    [],
    draft({ taskId: 'predictable-key' }),
    draft({ profileId: '../escape' }),
    draft({ profileVersion: '../v1' }),
    draft({ images: [] }),
    draft({ images: Array.from({ length: IMAGE_LIMITS.maxImages + 1 }, () => image()) }),
    draft({ taskInstructions: 'x'.repeat(IMAGE_LIMITS.maxInstructionsLength + 1) }),
  ]) assert.equal(validateSubmissionMetadata(invalid).ok, false);
});

test('rejects unsupported, dangerous or misleading image metadata', () => {
  for (const bad of [
    { fileName: '../steal.png' },
    { fileName: '..' },
    { fileName: 'dir\\steal.png' },
    { fileName: 'a\n.png' },
    { contentType: 'image/svg+xml' },
    { byteSize: 0 },
    { byteSize: Number.NaN },
    { byteSize: Number.MAX_SAFE_INTEGER + 1 },
    { byteSize: IMAGE_LIMITS.maxImageBytes + 1 },
    { sha256: 'wrong' },
  ]) {
    const parsed = validateSubmissionMetadata(draft({ images: [image(bad)] }));
    assert.equal(parsed.ok, false, JSON.stringify(bad));
  }
});

test('rejects oversized aggregate even when individual images are allowed', () => {
  const bytes = 16 * 1024 * 1024;
  const parsed = validateSubmissionMetadata(draft({ images: Array.from({ length: 4 }, () => image({ byteSize: bytes })) }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.errors.join(';'), /total image size exceeds limit/);
});

test('does not mistake metadata checks for image content authentication', () => {
  // Metadata validation succeeds; the future relay MUST still verify real
  // uploaded bytes and their hash before durably accepting a task.
  const parsed = validateSubmissionMetadata(draft({ images: [image({ sha256: '00'.repeat(32) })] }));
  assert.equal(parsed.ok, true);
});
