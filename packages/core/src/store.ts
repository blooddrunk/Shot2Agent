import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Attempt, Mode, Task } from './model.ts';
import { requireValue } from './model.ts';
import type { FileReference } from '../../contracts/src/index.ts';
export interface TaskStore {
  transaction<T>(operation: () => T): T;
  tasks(): Task[];
  get(id: string): Task | undefined;
  put(task: Task): void;
  attempts(taskId: string): Attempt[];
  putAttempt(attempt: Attempt): void;
  metadata(prefix: string): { key: string; value: string }[];
  putMetadata(key: string, value: string): void;
  deleteTasks(ids: readonly string[]): void;
  pendingBlobCleanup(): FileReference[];
  finishBlobCleanup(fileId: string): void;
  close(): void;
}
export function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  requireValue(lstatSync(path).isDirectory() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_STORAGE');
  if (process.platform !== 'win32') chmodSync(path, 0o700);
}
/** Versioned SQLite migration. Every domain mutation runs under BEGIN IMMEDIATE. */
export class SqliteTaskStore implements TaskStore {
  private db: DatabaseSync;
  constructor(path: string, mode: Mode) {
    privateDirectory(dirname(path));
    try { requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_DATABASE'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    this.db = new DatabaseSync(path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    try {
      this.transaction(() => {
        const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
        requireValue(version <= 2, 'NEWER_DATABASE_SCHEMA');
        if (version === 0) this.db.exec(`
          CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE tasks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, idem TEXT NOT NULL, record TEXT NOT NULL, UNIQUE(owner, idem));
          CREATE TABLE attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), record TEXT NOT NULL);
          CREATE INDEX attempt_task ON attempts(task_id);
          PRAGMA user_version=1;
        `);
        if (version < 2) this.db.exec(`
          CREATE TABLE blob_cleanup (file_id TEXT PRIMARY KEY, record TEXT NOT NULL);
          PRAGMA user_version=2;
        `);
        this.db.prepare('INSERT OR IGNORE INTO settings VALUES (?, ?)').run('mode', mode);
        requireValue(this.db.prepare('SELECT value FROM settings WHERE key=?').get('mode')?.value === mode, 'MODE_STORAGE_MISMATCH', 409);
      });
    } catch (error) { this.db.close(); throw error; }
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  tasks(): Task[] { return this.db.prepare('SELECT record FROM tasks ORDER BY rowid').all().map(row => JSON.parse(row.record as string)); }
  get(id: string): Task | undefined {
    const row = this.db.prepare('SELECT record FROM tasks WHERE id=?').get(id);
    return row ? JSON.parse(row.record as string) : undefined;
  }
  put(task: Task): void {
    this.db.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record')
      .run(task.submission.taskId, task.ownerId, task.idempotencyKey, JSON.stringify(task));
  }
  attempts(taskId: string): Attempt[] {
    return this.db.prepare('SELECT record FROM attempts WHERE task_id=? ORDER BY rowid').all(taskId).map(row => JSON.parse(row.record as string));
  }
  putAttempt(attempt: Attempt): void {
    this.db.prepare('INSERT INTO attempts VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET record=excluded.record')
      .run(attempt.attemptId, attempt.taskId, JSON.stringify(attempt));
  }
  metadata(prefix: string): { key: string; value: string }[] {
    return this.db.prepare('SELECT key,value FROM settings WHERE substr(key,1,?)=?').all(prefix.length, prefix) as { key: string; value: string }[];
  }
  putMetadata(key: string, value: string): void {
    this.db.prepare('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  /** Must be called in a store transaction. The journal lets file removal resume after a crash. */
  deleteTasks(ids: readonly string[]): void {
    const enqueue = this.db.prepare('INSERT OR IGNORE INTO blob_cleanup VALUES (?, ?)');
    const deleteAttempts = this.db.prepare('DELETE FROM attempts WHERE task_id=?');
    const deleteTask = this.db.prepare('DELETE FROM tasks WHERE id=?');
    for (const id of ids) {
      const task = this.get(id);
      if (!task) continue;
      for (const file of [...task.inputs, ...(task.result?.artifacts ?? [])]) enqueue.run(file.fileId, JSON.stringify(file));
      deleteAttempts.run(id);
      deleteTask.run(id);
    }
  }
  pendingBlobCleanup(): FileReference[] {
    return this.db.prepare('SELECT record FROM blob_cleanup ORDER BY rowid').all().map(row => JSON.parse(row.record as string));
  }
  finishBlobCleanup(fileId: string): void { this.db.prepare('DELETE FROM blob_cleanup WHERE file_id=?').run(fileId); }
  close(): void { this.db.close(); }
}
