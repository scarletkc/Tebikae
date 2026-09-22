import {
  newMetadata,
  parseNoteBody,
  serializeNoteBody,
  snapshotToDocument,
  validateDocument,
} from '../domain/codec';
import { mergeThreeWay } from '../domain/merge';
import type { Connection, LocalNote, NoteDocument, RawIssueSnapshot } from '../domain/types';
import { db, saveRecovery, type TebikaeDB } from '../storage/db';

export async function createNote(scopeId: string, document: NoteDocument, database = db): Promise<LocalNote> {
  validateDocument(document);
  const now = new Date().toISOString();
  const note: LocalNote = {
    scopeId,
    localId: crypto.randomUUID(),
    current: structuredClone(document),
    base: null,
    lastSeenRemote: null,
    localRevision: 1,
    localCreatedAt: now,
    localModifiedAt: now,
    syncStatus: 'local-draft',
  };
  await database.transaction('rw', database.notes, database.outbox, async () => {
    await database.notes.add(note);
    await database.outbox.add({
      scopeId,
      localId: note.localId,
      operationId: crypto.randomUUID(),
      kind: 'create',
      status: 'pending',
    });
  });
  return note;
}

export async function saveNote(
  scopeId: string,
  localId: string,
  document: NoteDocument,
  database = db,
  editorBaseline?: NoteDocument,
): Promise<LocalNote> {
  validateDocument(document);
  return database.transaction('rw', database.notes, database.outbox, database.recovery, async () => {
    const previous = await requireNote(database, scopeId, localId);
    if (JSON.stringify(previous.current) === JSON.stringify(document)) return previous;
    if (
      previous.purgeStartedAt ||
      previous.duplicate ||
      previous.remoteUnavailable ||
      previous.conflictFields?.includes('protocol')
    )
      throw new Error('NOTE_READ_ONLY');
    let desired = document;
    let conflicts: string[] = [];
    if (editorBaseline) {
      // The editor may intentionally retain its cursor/document while a sync
      // incorporates unrelated remote fields. Apply only its actual changes.
      const snapshot = (value: NoteDocument): RawIssueSnapshot => ({
        id: previous.issueId || 0,
        number: previous.issueNumber || 0,
        nodeId: '',
        url: '',
        title: value.title,
        body: serializeNoteBody(value.meta, value.markdown),
        state: value.archived ? 'closed' : 'open',
        stateReason: null,
        labels: value.labelIds.map((id) => ({ id, name: '', color: '', description: null })),
        createdAt: previous.localCreatedAt,
        updatedAt: previous.localModifiedAt,
      });
      const merged = mergeThreeWay(snapshot(editorBaseline), document, snapshot(previous.current));
      desired = merged.document;
      conflicts = merged.conflicts;
      if (conflicts.length) await saveRecovery(database, previous, 'editor-remote-conflict');
    }
    if (!conflicts.length && JSON.stringify(previous.current) === JSON.stringify(desired)) return previous;
    const existing = await database.outbox.get([scopeId, localId]);
    const blocked = existing?.status === 'uncertain' || existing?.status === 'conflict';
    const note: LocalNote = {
      ...previous,
      current: structuredClone(desired),
      localRevision: previous.localRevision + 1,
      localModifiedAt: new Date().toISOString(),
      syncStatus: conflicts.length ? 'conflict' : blocked ? previous.syncStatus : 'pending',
      conflictFields: conflicts.length ? conflicts : previous.conflictFields,
      error: blocked ? previous.error : undefined,
    };
    await database.notes.put(note);
    // Preserve a dispatched attempt even while the user's desired document advances.
    await database.outbox.put(
      existing
        ? {
            ...existing,
            status: conflicts.length
              ? 'conflict'
              : existing.status === 'sending' || blocked
                ? existing.status
                : 'pending',
            // New input must not erase backoff or reconciliation for an in-flight write.
            retryAt: existing.retryAt,
          }
        : {
            scopeId,
            localId,
            operationId: crypto.randomUUID(),
            kind: note.issueId ? 'update' : 'create',
            status: conflicts.length ? 'conflict' : 'pending',
          },
    );
    return note;
  });
}

/** Save an editor's actual delta without replacing unseen synchronized fields. */
export function saveEditedNote(
  scopeId: string,
  localId: string,
  previousEditorDocument: NoteDocument,
  nextEditorDocument: NoteDocument,
  database = db,
): Promise<LocalNote> {
  return saveNote(scopeId, localId, nextEditorDocument, database, previousEditorDocument);
}

interface IssueReader {
  getIssue(connection: Connection, number: number): Promise<RawIssueSnapshot>;
}

/** Conversion starts with a fresh read and preserves the complete original body. */
export async function convertIssue(
  connection: Connection,
  issueId: number,
  client: IssueReader,
  database = db,
): Promise<LocalNote> {
  const record = await database.unmanagedIssues.get([connection.scopeId, issueId]);
  if (!record || record.status !== 'unmanaged') throw new Error('ISSUE_NOT_CONVERTIBLE');
  const latest = await client.getIssue(connection, record.snapshot.number);
  if (parseNoteBody(latest.body).status !== 'unmanaged') throw new Error('ISSUE_CHANGED');
  const now = new Date().toISOString();
  const note: LocalNote = {
    scopeId: connection.scopeId,
    localId: crypto.randomUUID(),
    issueId: latest.id,
    issueNumber: latest.number,
    current: {
      title: latest.title,
      markdown: latest.body,
      meta: newMetadata(),
      archived: latest.state === 'closed',
      labelIds: latest.labels.map((label) => label.id),
    },
    base: latest,
    lastSeenRemote: latest,
    localRevision: 1,
    localCreatedAt: latest.createdAt,
    localModifiedAt: now,
    syncStatus: 'pending',
  };
  validateDocument(note.current);
  await database.transaction('rw', database.notes, database.outbox, database.unmanagedIssues, async () => {
    await database.notes.add(note);
    await database.outbox.add({
      scopeId: connection.scopeId,
      localId: note.localId,
      operationId: crypto.randomUUID(),
      kind: 'update',
      status: 'pending',
    });
    await database.unmanagedIssues.delete([connection.scopeId, issueId]);
  });
  return note;
}

export async function resolveConflict(
  scopeId: string,
  localId: string,
  choice: 'remote' | 'local' | 'copy',
  database = db,
): Promise<LocalNote> {
  return database.transaction('rw', database.notes, database.outbox, database.recovery, async () => {
    const note = await requireNote(database, scopeId, localId);
    const remote = note.lastSeenRemote && snapshotToDocument(note.lastSeenRemote);
    if (!remote || note.duplicate) throw new Error('CONFLICT_NOT_RESOLVABLE');
    await saveRecovery(database, note, 'conflict-resolution');
    if (choice === 'copy')
      await createNote(
        scopeId,
        { ...note.current, meta: { ...note.current.meta, id: crypto.randomUUID() } },
        database,
      );
    // Resolving the content of a duplicate must not undo its explicit UUID split.
    const before = note.base && snapshotToDocument(note.base);
    const keepIdentity = note.current.meta.id !== remote.meta.id && before?.meta.id === remote.meta.id;
    const selectedRemote = keepIdentity
      ? { ...remote, meta: { ...remote.meta, id: note.current.meta.id } }
      : remote;
    const pending = choice === 'local' || keepIdentity;
    // A later preflight compares with this exact seen remote; a changed remote conflicts again.
    const updated: LocalNote = {
      ...note,
      current: choice === 'local' ? note.current : selectedRemote,
      base: note.lastSeenRemote,
      localRevision: note.localRevision + 1,
      syncStatus: pending ? 'pending' : 'synced',
      conflictFields: undefined,
      error: undefined,
      localModifiedAt: new Date().toISOString(),
    };
    await database.notes.put(updated);
    if (pending)
      await database.outbox.put({
        scopeId,
        localId,
        kind: 'update',
        status: 'pending',
        operationId: crypto.randomUUID(),
        forceExpectedRemote: choice === 'local' ? note.lastSeenRemote! : undefined,
      });
    else await database.outbox.delete([scopeId, localId]);
    return updated;
  });
}

export async function discardDraft(scopeId: string, localId: string, database = db) {
  await database.transaction('rw', database.notes, database.outbox, async () => {
    const note = await requireNote(database, scopeId, localId);
    const entry = await database.outbox.get([scopeId, localId]);
    if (note.issueId || entry?.attemptStartedAt) throw new Error('DRAFT_ALREADY_DISPATCHED');
    await database.notes.delete([scopeId, localId]);
    await database.outbox.delete([scopeId, localId]);
  });
}

export async function clearScope(scopeId: string, database = db) {
  await database.transaction('rw', database.tables, async () => {
    for (const table of database.tables) await table.where('scopeId').equals(scopeId).delete();
  });
}

export async function exportScope(scopeId: string, database = db) {
  return database.transaction('r', database.tables, async () => {
    const connection = await database.connections.get(scopeId);
    const state = await database.syncState.get(scopeId);
    const notes = await database.notes.where('scopeId').equals(scopeId).toArray();
    const [unmanagedIssues, labels, attempts, recovery] = await Promise.all([
      database.unmanagedIssues.where('scopeId').equals(scopeId).toArray(),
      database.labels.where('scopeId').equals(scopeId).toArray(),
      database.outbox.where('scopeId').equals(scopeId).toArray(),
      database.recovery.where('scopeId').equals(scopeId).toArray(),
    ]);
    return {
      format: 'issue-notes-export',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      source: {
        provider: 'github.com',
        repositoryId: connection?.repoId,
        repository: connection ? `${connection.owner}/${connection.repo}` : undefined,
      },
      coverage: {
        issueListingComplete: Boolean(
          state?.initialLoadComplete &&
          !state.loading &&
          !state.error &&
          typeof navigator !== 'undefined' &&
          navigator.onLine,
        ),
        includesComments: false,
        includesAttachmentBytes: false,
      },
      notes,
      unmanagedIssues,
      drafts: notes.filter((note) => note.syncStatus !== 'synced'),
      labels,
      conflicts: notes.filter((note) => note.syncStatus === 'conflict'),
      attempts,
      recovery,
    };
  });
}

export function exportMarkdown(
  note: LocalNote,
  labels: Array<{ id: number; name: string }> = [],
): { filename: string; content: string } {
  const title = note.current.title.replace(/[\r\n]/g, ' ');
  const names = labels.filter((label) => note.current.labelIds.includes(label.id)).map((label) => label.name);
  const url = note.base?.url || note.lastSeenRemote?.url;
  const filename =
    Array.from(title, (character) => (character.charCodeAt(0) < 32 ? '_' : character))
      .join('')
      .replace(/[<>:"/\\|?*]/g, '_')
      .replace(/[. ]+$/g, '')
      .slice(0, 100) || 'note';
  return {
    filename: `${filename}.md`,
    content: `# ${title}\n\n${names.length ? `Labels: ${names.join(', ')}\n\n` : ''}${url ? `Source: ${url}\n\n` : ''}${note.current.markdown}`,
  };
}

export async function requireNote(database: TebikaeDB, scopeId: string, localId: string): Promise<LocalNote> {
  const note = await database.notes.get([scopeId, localId]);
  if (!note) throw new Error('NOTE_NOT_FOUND');
  return note;
}
