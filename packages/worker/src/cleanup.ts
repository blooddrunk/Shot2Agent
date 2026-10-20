import { rm } from 'node:fs/promises';
/** Only call after owned process handles close. Retry transient Windows file locks, with a bound. */
export async function removeOwnedDirectory(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
