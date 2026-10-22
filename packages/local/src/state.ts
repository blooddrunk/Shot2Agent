import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { requireValue } from '../../core/src/model.ts';
import { privateDirectory } from '../../core/src/store.ts';
export interface Baseline { session: string; sequence: string }
export type DeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'disabled' | 'manual' | 'blocked_by_clipboard_change' | 'interrupted';
export interface Receipt { status: DeliveryStatus; attempts: number; code?: string;
  smartGuard?: boolean; payload?: 'text' | 'files';
  classification?: 'transient' | 'permanent' | 'conflict' | 'ambiguous'; stopReason?: string;
  history?: { attempt: number; at: number; elapsedMs: number; code: string; classification: string }[] }
export class LocalState {
  private db: DatabaseSync;
  private workerToken = randomUUID();
  readonly root: string;
  constructor(root: string) {
    this.root = root;
    privateDirectory(root); const path = join(root, 'local.sqlite');
    try { requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_DATABASE'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    this.db = new DatabaseSync(path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS local_worker (slot INTEGER PRIMARY KEY, pid INTEGER NOT NULL, token TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS captures (task TEXT PRIMARY KEY, hash TEXT NOT NULL, at INTEGER NOT NULL, baseline TEXT);
      CREATE TABLE IF NOT EXISTS provenance (task TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery (task TEXT NOT NULL, channel TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(task,channel));
      CREATE TABLE IF NOT EXISTS task_deletion (task TEXT PRIMARY KEY);`);
  }
  capture(task: string, hash: string, baseline?: Baseline, provenance?: object, force = false): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!force && this.duplicate(hash)) { this.db.exec('COMMIT'); return false; }
      this.db.prepare('INSERT INTO captures VALUES (?,?,?,?)').run(task, hash, Date.now(), baseline ? JSON.stringify(baseline) : null);
      if (provenance) this.db.prepare('INSERT INTO provenance VALUES (?,?)').run(task, JSON.stringify(provenance));
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  forgetCapture(task: string): void { this.db.prepare('DELETE FROM captures WHERE task=?').run(task); this.db.prepare('DELETE FROM provenance WHERE task=?').run(task); }
  provenance(task: string): unknown {
    const row = this.db.prepare('SELECT record FROM provenance WHERE task=?').get(task); return row ? JSON.parse(row.record as string) : undefined;
  }
  duplicate(hash: string): boolean { return !!this.db.prepare('SELECT task FROM captures WHERE hash=? AND at>?').get(hash, Date.now() - 5000); }
  baseline(task: string): Baseline | undefined {
    const row = this.db.prepare('SELECT baseline FROM captures WHERE task=?').get(task); return row?.baseline ? JSON.parse(row.baseline as string) : undefined;
  }
  get(task: string, channel: string): Receipt | undefined {
    const row = this.db.prepare('SELECT record FROM delivery WHERE task=? AND channel=?').get(task, channel);
    return row ? JSON.parse(row.record as string) : undefined;
  }
  put(task: string, channel: string, receipt: Receipt): void {
    this.db.prepare('INSERT INTO delivery VALUES (?,?,?) ON CONFLICT(task,channel) DO UPDATE SET record=excluded.record').run(task, channel, JSON.stringify(receipt));
  }
  /** Record user intent before touching the task database or private blobs. */
  beginTaskDeletion(tasks: readonly string[]): void {
    requireValue(tasks.length > 0 && tasks.every(task => /^[0-9a-f-]{36}$/.test(task)) && new Set(tasks).size === tasks.length, 'INVALID_TASK_DELETE');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const insert = this.db.prepare('INSERT OR IGNORE INTO task_deletion VALUES (?)');
      for (const task of tasks) insert.run(task);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  pendingTaskDeletions(): string[] { return this.db.prepare('SELECT task FROM task_deletion ORDER BY rowid').all().map(row => row.task as string); }
  /** Removes capture baselines, provenance and channel receipts after core/blob cleanup. */
  finishTaskDeletion(tasks: readonly string[]): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const task of tasks) {
        this.db.prepare('DELETE FROM captures WHERE task=?').run(task);
        this.db.prepare('DELETE FROM provenance WHERE task=?').run(task);
        this.db.prepare('DELETE FROM delivery WHERE task=?').run(task);
        this.db.prepare('DELETE FROM task_deletion WHERE task=?').run(task);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  /** Atomic reservation prevents two receivers from both writing the clipboard. */
  reserve(task: string, channel: string, retry: boolean): Receipt | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.get(task, channel);
      if (previous && (!retry || previous.status === 'succeeded' || previous.status === 'pending')) { this.db.exec('COMMIT'); return undefined; }
      const receipt: Receipt = { status: 'pending', attempts: (previous?.attempts ?? 0) + 1, history: previous?.history,
        smartGuard: channel === 'clipboard' && previous ? previous.smartGuard ?? !!this.baseline(task) : undefined };
      this.put(task, channel, receipt); this.db.exec('COMMIT'); return receipt;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  acquireWorker(): void {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT pid,token FROM local_worker WHERE slot=1').get();
      if (old && old.token !== this.workerToken) {
        let alive = true;
        try { process.kill(Number(old.pid), 0); } catch (e) { alive = (e as NodeJS.ErrnoException).code !== 'ESRCH'; }
        requireValue(!alive, 'LOCAL_WORKER_ALREADY_RUNNING');
      }
      if (!old || old.token !== this.workerToken) {
        for (const row of this.db.prepare('SELECT task,channel,record FROM delivery').all()) {
          const record = JSON.parse(row.record as string) as Receipt;
          if (record.status === 'pending') this.put(row.task as string, row.channel as string,
            { ...record, status: 'interrupted', code: 'DELIVERY_INTERRUPTED', classification: 'ambiguous', stopReason: 'restart_no_replay' });
        }
      }
      this.db.prepare('INSERT INTO local_worker VALUES (1,?,?) ON CONFLICT(slot) DO UPDATE SET pid=excluded.pid,token=excluded.token').run(process.pid, this.workerToken);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close(): void { this.db.prepare('DELETE FROM local_worker WHERE token=?').run(this.workerToken); this.db.close(); }
}
