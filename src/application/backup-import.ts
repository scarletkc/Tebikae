import {
  BackupImportError,
  backupNoteFingerprint,
  type BackupNote,
  type ParsedBackup,
} from '../domain/backup-import';
import { safeJsonClone, validateDocument } from '../domain/codec';
import type { Label, LocalNote, OutboxEntry } from '../domain/types';
import { db, type TebikaeDB } from '../storage/db';

export interface ImportRow extends BackupNote {
  fingerprint: string;
  duplicate: boolean;
  missingLabels: string[];
}
export interface ImportPreview {
  scopeId: string;
  repository?: string;
  rows: ImportRow[];
  invalid: ParsedBackup['invalid'];
}
function indexLabels(labels: Label[]) {
  const byName = new Map<string, number | null>();
  for (const label of labels) byName.set(label.name, byName.has(label.name) ? null : label.id);
  return byName;
}
function mapLabels(note: BackupNote, byName: ReadonlyMap<string, number | null>) {
  const ids: number[] = [],
    missing: string[] = [];
  for (const name of note.labelNames) {
    const id = byName.get(name);
    if (id !== undefined && id !== null) ids.push(id);
    else missing.push(name);
  }
  return { ids: [...new Set(ids)], missing };
}

export async function previewBackupImport(
  scopeId: string,
  backup: ParsedBackup,
  database: TebikaeDB = db,
): Promise<ImportPreview> {
  const snapshot = await database.transaction('r', database.notes, database.labels, async () => ({
    notes: await database.notes.where('scopeId').equals(scopeId).toArray(),
    labels: await database.labels.where('scopeId').equals(scopeId).toArray(),
  }));
  const known = new Set(
    snapshot.notes.flatMap((note) => (note.importFingerprint ? [note.importFingerprint] : [])),
  );
  const rows: ImportRow[] = [];
  const labelsByName = indexLabels(snapshot.labels);
  for (const note of backup.notes) {
    const fingerprint = await backupNoteFingerprint(note);
    const duplicate = known.has(fingerprint);
    known.add(fingerprint);
    rows.push({ ...note, fingerprint, duplicate, missingLabels: mapLabels(note, labelsByName).missing });
  }
  return { scopeId, repository: backup.repository, rows, invalid: backup.invalid };
}

/** Import new local identities only. Notes and sync intents either all commit or all roll back. */
export async function importBackupNotes(
  preview: ImportPreview,
  selected: number[],
  checkWritable: () => void,
  database: TebikaeDB = db,
): Promise<{ imported: number; skipped: number }> {
  checkWritable();
  const indices = new Set(selected);
  const rows = preview.rows.filter((row) => indices.has(row.index));
  if (!rows.length || rows.length !== indices.size) throw new BackupImportError('selection');
  // Hash and validate before opening IndexedDB's transaction (Web Crypto is asynchronous).
  for (const row of rows) {
    validateDocument(row.document);
    if ((await backupNoteFingerprint(row)) !== row.fingerprint) throw new BackupImportError('selection');
  }
  return database.transaction('rw', database.notes, database.outbox, database.labels, async () => {
    checkWritable();
    const existing = await database.notes.where('scopeId').equals(preview.scopeId).toArray();
    const labelsByName = indexLabels(
      await database.labels.where('scopeId').equals(preview.scopeId).toArray(),
    );
    const fingerprints = new Set(
      existing.flatMap((note) => (note.importFingerprint ? [note.importFingerprint] : [])),
    );
    const notes: LocalNote[] = [],
      intents: OutboxEntry[] = [];
    let skipped = 0;
    const stamp = new Date().toISOString();
    for (const row of rows) {
      if (fingerprints.has(row.fingerprint)) {
        skipped++;
        continue;
      }
      // Reject a stale label preview rather than silently changing what the user accepted.
      const mapped = mapLabels(row, labelsByName);
      if (JSON.stringify(mapped.missing) !== JSON.stringify(row.missingLabels))
        throw new BackupImportError('selection');
      const current = safeJsonClone(row.document);
      if (!current.title.trim()) current.title = 'Untitled note';
      current.meta.id = crypto.randomUUID();
      current.labelIds = mapped.ids;
      const localId = crypto.randomUUID();
      notes.push({
        scopeId: preview.scopeId,
        localId,
        current,
        base: null,
        lastSeenRemote: null,
        localRevision: 1,
        localCreatedAt: stamp,
        localModifiedAt: stamp,
        syncStatus: 'local-draft',
        importFingerprint: row.fingerprint,
      });
      intents.push({
        scopeId: preview.scopeId,
        localId,
        operationId: crypto.randomUUID(),
        kind: 'create',
        status: 'pending',
      });
      fingerprints.add(row.fingerprint);
    }
    await database.notes.bulkAdd(notes);
    await database.outbox.bulkAdd(intents);
    checkWritable();
    return { imported: notes.length, skipped };
  });
}
