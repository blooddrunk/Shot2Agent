import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { requireValue } from '../../core/src/model.ts';
import { privateDirectory } from '../../core/src/store.ts';
export interface Baseline { session: string; sequence: string }
export type DeliveryStatus = 'pending' | 'succeeded' | 'failed' | 'disabled' | 'manual' | 'blocked_by_clipboard_change' | 'interrupted';
export interface Receipt { status: DeliveryStatus; attempts: number; code?: string }
export class LocalState {
  private db: DatabaseSync;
  constructor(root: string) {
    privateDirectory(root); const path = join(root, 'local.sqlite');
    try { requireValue(lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), 'UNSAFE_DATABASE'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    this.db = new DatabaseSync(path);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS captures (task TEXT PRIMARY KEY, hash TEXT NOT NULL, at INTEGER NOT NULL, baseline TEXT);
      CREATE TABLE IF NOT EXISTS provenance (task TEXT PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS delivery (task TEXT NOT NULL, channel TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY(task,channel));`);
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
  /** Atomic reservation prevents two receivers from both writing the clipboard. */
  reserve(task: string, channel: string, retry: boolean): Receipt | undefined {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previous = this.get(task, channel);
      if (previous && (!retry || previous.status === 'succeeded')) { this.db.exec('COMMIT'); return undefined; }
      const receipt: Receipt = { status: 'pending', attempts: (previous?.attempts ?? 0) + 1 };
      this.put(task, channel, receipt); this.db.exec('COMMIT'); return receipt;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  close(): void { this.db.close(); }
}
