import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import { sha256 } from '../../../packages/core/src/blobs.ts';
import { FAKE_PROFILE } from '../../../packages/worker/src/fake.ts';
export async function syntheticSubmission(count = 1, taskId = randomUUID()) {
  if (count !== 1 && count !== 5) throw new Error('Synthetic CLI accepts 1 or 5 images');
  const images: Buffer[] = [];
  for (let i = 0; i < count; i++) images.push(await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: i * 40, g: 80, b: 120 } } }).png().toBuffer());
  return { metadata: { taskId, profileId: FAKE_PROFILE.id, profileVersion: FAKE_PROFILE.version,
    images: images.map((bytes, i) => ({ fileName: `${i + 1}.png`, contentType: 'image/png' as const, byteSize: bytes.length, sha256: sha256(bytes) })) }, images };
}
