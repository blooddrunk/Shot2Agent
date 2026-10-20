import { constants, closeSync, fsyncSync, openSync, readFileSync, unlinkSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import type { FileReference, ImageMetadata } from '../../contracts/src/index.ts';
import { requireValue } from './model.ts';
import { privateDirectory } from './store.ts';
export const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
export interface BlobStore {
  put(bytes: Uint8Array, metadata: Pick<FileReference, 'fileName' | 'contentType'>): FileReference;
  read(reference: FileReference): Buffer;
  remove(reference: FileReference): void;
}
/** Names are generated IDs, never client paths. Unreferenced files after a crash are inert. */
export class PrivateBlobStore implements BlobStore {
  private root: string;
  constructor(root: string) { this.root = root; privateDirectory(root); }
  private path(id: string): string {
    requireValue(/^[0-9a-f-]{36}$/.test(id), 'INVALID_FILE_ID');
    return join(this.root, id);
  }
  put(bytes: Uint8Array, metadata: Pick<FileReference, 'fileName' | 'contentType'>): FileReference {
    const fileId = randomUUID();
    const fd = openSync(this.path(fileId), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try { writeFileSync(fd, bytes); fsyncSync(fd); }
    catch (error) { closeSync(fd); unlinkSync(this.path(fileId)); throw error; }
    closeSync(fd);
    // Persist the directory entry before SQLite acknowledges the referencing task.
    if (process.platform !== 'win32') {
      const dir = openSync(this.root, constants.O_RDONLY);
      try { fsyncSync(dir); }
      catch (error) { unlinkSync(this.path(fileId)); throw error; }
      finally { closeSync(dir); }
    }
    return { fileId, ...metadata, byteSize: bytes.length, sha256: sha256(bytes) };
  }
  read(reference: FileReference): Buffer {
    const path = this.path(reference.fileId);
    requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_FILE');
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try { bytes = readFileSync(fd); } finally { closeSync(fd); }
    requireValue(bytes.length === reference.byteSize && sha256(bytes) === reference.sha256, 'BLOB_INTEGRITY', 409);
    return bytes;
  }
  remove(reference: FileReference): void { unlinkSync(this.path(reference.fileId)); }
}
export async function verifyImage(bytes: Buffer, metadata: ImageMetadata): Promise<void> {
  requireValue(bytes.length === metadata.byteSize && sha256(bytes) === metadata.sha256, 'IMAGE_INTEGRITY');
  try {
    const decoder = sharp(bytes, { failOn: 'warning', limitInputPixels: 16_000_000, animated: true });
    const info = await decoder.metadata();
    requireValue(`image/${info.format}` === metadata.contentType && info.width && info.height && (info.pages ?? 1) === 1, 'IMAGE_FORMAT');
    // Header checks alone do not establish a decodable image.
    await decoder.stats();
  } catch { requireValue(false, 'INVALID_IMAGE'); }
}
