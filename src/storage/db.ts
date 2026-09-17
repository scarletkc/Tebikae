import Dexie, { type Table } from 'dexie';
import type {
  Connection,
  DeletedIssue,
  HttpCacheEntry,
  Label,
  LocalNote,
  OutboxEntry,
  Recovery,
  SyncState,
  UnmanagedIssue,
} from '../domain/types';

export type StoredLabel = Label & { scopeId: string };

/** Notebook tables exclude credentials; the encrypted session has a separate database. */
export class TebikaeDB extends Dexie {
  connections!: Table<Connection, string>;
  notes!: Table<LocalNote, [string, string]>;
  unmanagedIssues!: Table<UnmanagedIssue, [string, number]>;
  labels!: Table<StoredLabel, [string, number]>;
  outbox!: Table<OutboxEntry, [string, string]>;
  recovery!: Table<Recovery, number>;
  syncState!: Table<SyncState, string>;
  httpCache!: Table<HttpCacheEntry, [string, string, string, string]>;
  deletedIssues!: Table<DeletedIssue, [string, number]>;

  constructor(name = 'tebikae') {
    super(name);
    this.version(1).stores({
      connections: 'scopeId',
      notes: '[scopeId+localId],scopeId,[scopeId+issueId],[scopeId+issueNumber]',
      unmanagedIssues: '[scopeId+issueId],scopeId',
      labels: '[scopeId+id],scopeId',
      outbox: '[scopeId+localId],scopeId',
      recovery: '++id,scopeId,[scopeId+localId]',
      syncState: 'scopeId',
      httpCache: '[scopeId+url+accept+apiVersion],scopeId',
    });
    this.version(2).stores({
      deletedIssues: '[scopeId+issueId],scopeId',
    });
  }
}

export const db = new TebikaeDB();

/** Called inside the same transaction as the operation it protects. */
export async function saveRecovery(database: TebikaeDB, note: LocalNote, reason: string, resolved = false) {
  await database.recovery.add({
    scopeId: note.scopeId,
    localId: note.localId,
    createdAt: new Date().toISOString(),
    reason,
    snapshot: structuredClone(note.current),
    resolved,
  });
  const records = await database.recovery
    .where('[scopeId+localId]')
    .equals([note.scopeId, note.localId])
    .sortBy('id');
  const removable = records.filter((record) => record.resolved);
  // Unresolved conflicts and uncertain writes are never trimmed automatically.
  const excess = Math.max(0, records.length - 10);
  await database.recovery.bulkDelete(
    removable.slice(0, excess).flatMap((record) => (record.id === undefined ? [] : [record.id])),
  );
}

/** A refresh after dispatch cannot establish whether GitHub executed the write. */
export async function recoverInterruptedWrites(database: TebikaeDB, scopeId: string) {
  await database.transaction('rw', database.notes, database.outbox, async () => {
    await database.notes
      .where('scopeId')
      .equals(scopeId)
      .filter((note) => Boolean(note.purgeStartedAt))
      .modify({ syncStatus: 'uncertain' });
    const entries = await database.outbox.where('scopeId').equals(scopeId).toArray();
    for (const entry of entries) {
      if (entry.status !== 'sending') continue;
      await database.outbox.update([scopeId, entry.localId], { status: 'uncertain' });
      await database.notes.update([scopeId, entry.localId], { syncStatus: 'uncertain' });
    }
  });
}
