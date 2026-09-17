import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, resolveConflict, saveNote, convertIssue } from '../src/application/commands';
import { newMetadata, serializeNoteBody, snapshotToDocument } from '../src/domain/codec';
import type { Connection, Label, NoteDocument, RawIssueSnapshot } from '../src/domain/types';
import { TebikaeDB } from '../src/storage/db';
import { SyncEngine, type SyncClient } from '../src/sync/engine';

const connection: Connection = {
  scopeId: 'github.com:1:2',
  viewerId: 1,
  login: 'owner',
  repoId: 2,
  owner: 'owner',
  repo: 'notes',
  lastConnectedAt: '2026-09-01T00:00:00Z',
};
const doc = (): NoteDocument => ({
  title: 'Title',
  markdown: 'Original',
  meta: newMetadata(),
  archived: false,
  labelIds: [],
});
const raw = (document: NoteDocument, id = 1): RawIssueSnapshot => ({
  id,
  nodeId: `I_${id}`,
  number: id,
  url: `https://github.com/owner/notes/issues/${id}`,
  title: document.title,
  body: serializeNoteBody(document.meta, document.markdown),
  state: document.archived ? 'closed' : 'open',
  stateReason: null,
  labels: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-16T00:00:00Z',
});
const error = (code: string) => Object.assign(new Error(code), { failure: { code } });

class FakeClient implements SyncClient {
  pollIntervalMs = 60_000;
  issues: RawIssueSnapshot[] = [];
  labels: Label[] = [];
  creates = 0;
  patches: unknown[] = [];
  failCreateAfterWrite = false;
  failLabel = false;
  failPage = false;
  requestedSince?: string;
  onPatch?: () => Promise<void>;
  async getAnchor(): Promise<string | undefined> {
    return this.issues[0]?.updatedAt;
  }
  async *listIssues(_connection: Connection, options?: { since?: string }) {
    this.requestedSince = options?.since;
    yield this.issues.slice(0, 100);
    if (this.failPage) throw error('SERVER_ERROR');
    if (this.issues.length > 100) yield this.issues.slice(100);
  }
  async getIssue(_connection: Connection, number: number) {
    const issue = this.issues.find((item) => item.number === number);
    if (!issue) throw error('NOT_FOUND_OR_INACCESSIBLE');
    return structuredClone(issue);
  }
  async createIssue(_connection: Connection, payload: { title: string; body: string; labels?: string[] }) {
    this.creates++;
    const issue = {
      ...raw(doc(), this.issues.length + 1),
      title: payload.title,
      body: payload.body,
      labels: this.labels.filter((label) => payload.labels?.includes(label.name)),
    };
    this.issues.push(issue);
    if (this.failCreateAfterWrite) throw error('NETWORK_UNCERTAIN');
    return structuredClone(issue);
  }
  async updateIssue(
    _connection: Connection,
    number: number,
    payload: { title?: string; body?: string; state?: 'open' | 'closed' },
  ) {
    this.patches.push(payload);
    const issue = this.issues.find((item) => item.number === number)!;
    Object.assign(issue, payload);
    const response = structuredClone(issue);
    await this.onPatch?.();
    return response;
  }
  async listLabels() {
    return this.labels;
  }
  async createLabel(_connection: Connection, input: { name: string; color?: string }) {
    const label = {
      id: this.labels.length + 1,
      name: input.name,
      color: input.color || 'aaaaaa',
      description: null,
    };
    this.labels.push(label);
    return label;
  }
  async addLabels(_connection: Connection, number: number, names: string[]) {
    if (this.failLabel) throw error('FORBIDDEN');
    const issue = this.issues.find((item) => item.number === number)!;
    issue.labels.push(
      ...this.labels.filter(
        (label) => names.includes(label.name) && !issue.labels.some((current) => current.id === label.id),
      ),
    );
  }
  async removeLabel(_connection: Connection, number: number, name: string) {
    const issue = this.issues.find((item) => item.number === number)!;
    issue.labels = issue.labels.filter((label) => label.name !== name);
  }
}

let database: TebikaeDB;
let client: FakeClient;
let engine: SyncEngine;
beforeEach(() => {
  database = new TebikaeDB(`sync-test-${crypto.randomUUID()}`);
  client = new FakeClient();
  engine = new SyncEngine(database, client, connection);
});
afterEach(async () => {
  engine.stop();
  vi.useRealTimers();
  await database.delete();
});
const firstNote = async () => (await database.notes.toArray())[0]!;

describe('durable synchronization', () => {
  it('creates an archived draft once and closes the acknowledged Issue', async () => {
    const document = { ...doc(), archived: true };
    const draft = await createNote(connection.scopeId, document, database);
    await engine.flush(true);
    const saved = (await database.notes.get([connection.scopeId, draft.localId]))!;
    expect(client.creates).toBe(1);
    expect(client.patches).toEqual([{ state: 'closed', state_reason: 'completed' }]);
    expect(saved.current.archived).toBe(true);
    expect(saved.base?.state).toBe('closed');
    expect(saved.syncStatus).toBe('synced');
    expect(await database.outbox.count()).toBe(0);
  });

  it('preserves archive intent after recovering a lost create response', async () => {
    const draft = await createNote(connection.scopeId, { ...doc(), archived: true }, database);
    client.failCreateAfterWrite = true;
    await engine.flush(true);
    expect(client.issues[0]!.state).toBe('open');
    engine.stop();
    engine = new SyncEngine(database, client, connection);
    await engine.pull(true);
    expect((await database.notes.get([connection.scopeId, draft.localId]))!.current.archived).toBe(true);
    await engine.flush(true);
    expect(client.creates).toBe(1);
    expect(client.issues[0]!.state).toBe('closed');
    expect(await database.outbox.count()).toBe(0);
  });

  it.each([false, true])(
    'retries only the close step after its response is lost (applied: %s)',
    async (applied) => {
      const draft = await createNote(connection.scopeId, { ...doc(), archived: true }, database);
      const update = client.updateIssue.bind(client);
      const spy = vi.spyOn(client, 'updateIssue').mockImplementationOnce(async (...args) => {
        if (applied) await update(...args);
        throw error('NETWORK_UNCERTAIN');
      });
      await engine.flush(true);
      const saved = (await database.notes.get([connection.scopeId, draft.localId]))!;
      expect(saved.issueNumber).toBe(1);
      expect(saved.current.archived).toBe(true);
      expect((await database.outbox.get([connection.scopeId, draft.localId]))!.kind).toBe('update');
      spy.mockRestore();
      await engine.retry(draft.localId);
      expect(client.creates).toBe(1);
      expect(client.issues[0]!.state).toBe('closed');
      expect(await database.outbox.count()).toBe(0);
    },
  );

  it.each([
    { archived: true, state: 'open' as const },
    { archived: true, state: 'closed' as const },
    { archived: false, state: 'open' as const },
  ])('keeps remote edits after a recovered create ($archived, $state)', async ({ archived, state }) => {
    const document = { ...doc(), archived };
    const draft = await createNote(connection.scopeId, document, database);
    client.failCreateAfterWrite = true;
    await engine.flush(true);
    engine.stop();
    client.issues[0] = {
      ...client.issues[0]!,
      title: 'Edited on GitHub',
      body: serializeNoteBody({ ...document.meta, extension: { remote: true } }, 'Remote body'),
      state,
    };
    engine = new SyncEngine(database, client, connection);
    await engine.pull(true);
    await engine.flush(true);
    const saved = (await database.notes.get([connection.scopeId, draft.localId]))!;
    expect(snapshotToDocument(client.issues[0]!)).toMatchObject({
      title: 'Edited on GitHub',
      markdown: 'Remote body',
      archived,
      meta: { extension: { remote: true } },
    });
    expect(saved.current).toEqual(snapshotToDocument(client.issues[0]!));
    expect(saved.syncStatus).toBe('synced');
    expect(client.creates).toBe(1);
    expect(client.patches).toEqual(
      archived && state === 'open' ? [{ state: 'closed', state_reason: 'completed' }] : [],
    );
    expect(await database.outbox.count()).toBe(0);
  });

  it('merges later local changes and remote labels after a recovered create across another restart', async () => {
    client.labels = [1, 2, 3, 4].map((id) => ({
      id,
      name: `Label ${id}`,
      color: 'aaaaaa',
      description: null,
    }));
    const document = { ...doc(), archived: true, labelIds: [1, 2] };
    const draft = await createNote(connection.scopeId, document, database);
    client.failCreateAfterWrite = true;
    await engine.flush(true);
    engine.stop();
    await saveNote(
      connection.scopeId,
      draft.localId,
      {
        ...document,
        meta: { ...document.meta, color: 'blue' },
        labelIds: [2, 4],
      },
      database,
    );
    client.issues[0] = {
      ...client.issues[0]!,
      title: 'Remote title',
      body: serializeNoteBody({ ...document.meta, pinned: true }, 'Remote body'),
      labels: [client.labels[0]!, client.labels[2]!],
    };
    engine = new SyncEngine(database, client, connection);
    await engine.pull(true);
    expect((await firstNote()).current).toMatchObject({
      title: 'Remote title',
      markdown: 'Remote body',
      archived: true,
      meta: { color: 'blue', pinned: true },
      labelIds: [3, 4],
    });
    expect(await database.outbox.get([connection.scopeId, draft.localId])).toMatchObject({
      kind: 'update',
      status: 'pending',
    });
    engine.stop();
    client.issues[0]!.title = 'Edited again before closing';
    engine = new SyncEngine(database, client, connection);
    await engine.flush(true);
    const saved = (await firstNote()).current;
    expect(saved).toMatchObject({
      title: 'Edited again before closing',
      markdown: 'Remote body',
      archived: true,
      meta: { color: 'blue', pinned: true },
    });
    expect(saved.labelIds.sort()).toEqual([3, 4]);
    expect(client.creates).toBe(1);
    expect(client.patches).toHaveLength(1);
    expect(client.patches[0]).not.toHaveProperty('title');
    expect(await database.outbox.count()).toBe(0);
  });

  it.each(['title', 'markdown'] as const)(
    'pauses competing %s edits after a recovered create',
    async (field) => {
      const document = { ...doc(), archived: true };
      const draft = await createNote(connection.scopeId, document, database);
      client.failCreateAfterWrite = true;
      await engine.flush(true);
      engine.stop();
      const local = { ...document, [field]: 'Later local edit' };
      await saveNote(connection.scopeId, draft.localId, local, database);
      const remote = raw({ ...document, [field]: 'Later remote edit', archived: false });
      client.issues[0] = remote;
      engine = new SyncEngine(database, client, connection);
      await engine.pull(true);
      await engine.flush(true);
      const saved = await firstNote();
      expect(saved).toMatchObject({
        issueId: remote.id,
        issueNumber: remote.number,
        syncStatus: 'conflict',
        conflictFields: [field],
      });
      expect(saved.current[field]).toBe('Later local edit');
      expect(saved.lastSeenRemote).toEqual(remote);
      expect(client.issues[0]).toEqual(remote);
      expect(client.creates).toBe(1);
      expect(client.patches).toEqual([]);
      expect(
        (await database.recovery.toArray()).some(
          (item) => item.snapshot[field] === 'Later local edit' && !item.resolved,
        ),
      ).toBe(true);
      await resolveConflict(connection.scopeId, draft.localId, 'remote', database);
      await engine.flush(true);
      expect((await firstNote()).current[field]).toBe('Later remote edit');
      expect(await database.outbox.count()).toBe(0);
      expect(client.creates).toBe(1);
    },
  );

  it('respects a later local unarchive after a recovered create', async () => {
    const document = { ...doc(), archived: true };
    const draft = await createNote(connection.scopeId, document, database);
    client.failCreateAfterWrite = true;
    await engine.flush(true);
    engine.stop();
    await saveNote(connection.scopeId, draft.localId, { ...document, archived: false }, database);
    client.issues[0]!.title = 'Remote edit';
    engine = new SyncEngine(database, client, connection);
    await engine.pull(true);
    await engine.flush(true);
    expect((await firstNote()).current).toMatchObject({ title: 'Remote edit', archived: false });
    expect(client.issues[0]!.state).toBe('open');
    expect(client.creates).toBe(1);
    expect(client.patches).toEqual([]);
    expect(await database.outbox.count()).toBe(0);
  });

  it('retains newer local input while the initial archive step is in flight', async () => {
    const draft = await createNote(connection.scopeId, { ...doc(), archived: true }, database);
    client.onPatch = async () => {
      const latest = (await database.notes.get([connection.scopeId, draft.localId]))!;
      await saveNote(
        connection.scopeId,
        draft.localId,
        { ...latest.current, markdown: 'Newer input', archived: false },
        database,
      );
    };
    await engine.flush(true);
    const saved = (await database.notes.get([connection.scopeId, draft.localId]))!;
    expect(saved.current).toMatchObject({ markdown: 'Newer input', archived: false });
    expect(saved.syncStatus).toBe('pending');
    client.onPatch = undefined;
    await engine.flush(true);
    expect(client.creates).toBe(1);
    expect(client.issues[0]!.state).toBe('open');
    expect(await database.outbox.count()).toBe(0);
  });

  it('recovers a lost POST response by UUID across every page without another POST', async () => {
    client.issues = Array.from({ length: 110 }, (_, index) => raw(doc(), index + 1));
    const draft = await createNote(connection.scopeId, doc(), database);
    client.failCreateAfterWrite = true;
    await engine.flush(true);
    expect((await database.notes.get([connection.scopeId, draft.localId]))?.syncStatus).toBe('uncertain');
    await engine.flush(true);
    expect(client.creates).toBe(1);
    engine.stop();
    engine = new SyncEngine(database, client, connection);
    await engine.pull(true);
    expect((await database.notes.get([connection.scopeId, draft.localId]))?.issueNumber).toBe(111);
    await engine.flush(true);
    expect(client.creates).toBe(1);
    expect(await database.outbox.count()).toBe(0);
  });

  it('keeps a newer input revision when the old PATCH response arrives', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(connection.scopeId, note.localId, { ...note.current, markdown: 'Sent version' }, database);
    client.onPatch = async () => {
      const latest = (await database.notes.get([connection.scopeId, note.localId]))!;
      await saveNote(
        connection.scopeId,
        note.localId,
        { ...latest.current, markdown: 'Still typing' },
        database,
      );
    };
    await engine.flush(true);
    const latest = await firstNote();
    expect(latest.current.markdown).toBe('Still typing');
    expect(snapshotToDocument(latest.base!)?.markdown).toBe('Sent version');
    expect(latest.syncStatus).toBe('pending');
    expect(await database.outbox.count()).toBe(1);
  });

  it('merges local color with remote Markdown and preserves remotely added labels', async () => {
    client.labels = [{ id: 9, name: 'remote', color: 'ffffff', description: null }];
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(
      connection.scopeId,
      note.localId,
      { ...note.current, meta: { ...note.current.meta, color: 'yellow' } },
      database,
    );
    client.issues[0] = {
      ...raw({ ...note.current, markdown: 'GitHub changed this' }),
      labels: client.labels,
    };
    await engine.flush(true);
    const result = await firstNote();
    expect(result.current).toMatchObject({
      markdown: 'GitHub changed this',
      meta: { color: 'yellow' },
      labelIds: [9],
    });
    expect(client.patches[0]).not.toHaveProperty('labels');
  });

  it('pauses competing Markdown edits and saves a recovery snapshot', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(connection.scopeId, note.localId, { ...note.current, markdown: 'Local' }, database);
    client.issues[0] = raw({ ...note.current, markdown: 'Remote' });
    await engine.flush(true);
    expect((await firstNote()).syncStatus).toBe('conflict');
    expect(client.patches).toHaveLength(0);
    expect(await database.recovery.count()).toBe(1);
    await resolveConflict(connection.scopeId, note.localId, 'local', database);
    client.issues[0] = raw({ ...note.current, markdown: 'Remote changed again' });
    await engine.flush(true);
    expect((await firstNote()).syncStatus).toBe('conflict');
    expect(client.patches).toHaveLength(0);
  });

  it('confirms a successful body step while failed labels remain pending', async () => {
    client.labels = [{ id: 7, name: 'work', color: 'eeeeee', description: null }];
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(
      connection.scopeId,
      note.localId,
      { ...note.current, markdown: 'Body saved', labelIds: [7] },
      database,
    );
    client.failLabel = true;
    await engine.flush(true);
    const partial = await firstNote();
    expect(snapshotToDocument(partial.base!)?.markdown).toBe('Body saved');
    expect(partial.current.labelIds).toEqual([7]);
    expect(await database.outbox.count()).toBe(1);
    client.failLabel = false;
    await engine.retry(note.localId);
    expect(client.patches).toHaveLength(1);
    expect((await firstNote()).syncStatus).toBe('synced');
    expect((await firstNote()).current.labelIds).toEqual([7]);
  });

  it('preserves a label added after preflight while applying a content PATCH', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(connection.scopeId, note.localId, { ...note.current, markdown: 'Body updated' }, database);
    const extra = { id: 8, name: 'external', color: '000000', description: null };
    client.labels = [extra];
    const originalUpdate = client.updateIssue.bind(client);
    client.updateIssue = async (...args) => {
      const remote = await originalUpdate(...args);
      client.issues[0]!.labels.push(extra);
      return { ...remote, labels: [extra] };
    };
    await engine.flush(true);
    expect(client.issues[0]?.labels).toEqual([extra]);
    expect((await firstNote()).current.labelIds).toEqual([8]);
  });

  it('keeps the cursor on a failed page and overlaps the prior anchor by 60 seconds', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const state = await database.syncState.get(connection.scopeId);
    client.failPage = true;
    await expect(engine.pull()).rejects.toThrow();
    expect((await database.syncState.get(connection.scopeId))?.cursor).toBe(state?.cursor);
    expect(client.requestedSince).toBe('2026-09-15T23:59:00.000Z');
    expect((await database.syncState.get(connection.scopeId))?.loading).toBe(false);
  });

  it('marks missing remote notes unavailable without deleting local content', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    client.issues = [];
    await engine.pull(true);
    expect((await firstNote()).remoteUnavailable).toBe(true);
    expect((await firstNote()).current.markdown).toBe('Original');
  });

  it('pauses every duplicate UUID and makes selected copies independent', async () => {
    const document = doc();
    client.issues = [raw(document, 1), raw(document, 2)];
    await engine.pull();
    expect((await database.notes.toArray()).every((note) => note.duplicate)).toBe(true);
    const original = await firstNote();
    await engine.resolveDuplicate(original.localId);
    await engine.flush(true);
    expect(new Set(client.issues.map((issue) => snapshotToDocument(issue)?.meta.id)).size).toBe(2);
    expect((await database.notes.toArray()).every((note) => !note.duplicate)).toBe(true);
  });

  it('keeps fresh remote content while resolving duplicate identities', async () => {
    const document = doc();
    client.issues = [raw(document, 1), raw(document, 2)];
    await engine.pull();
    const original = (await database.notes.toArray()).find((note) => note.issueNumber === 1)!;
    client.issues[1] = raw({ ...document, markdown: 'Remote edit after duplicate detection' }, 2);
    await engine.resolveDuplicate(original.localId);
    await engine.flush(true);
    expect(snapshotToDocument(client.issues[1]!)?.markdown).toBe('Remote edit after duplicate detection');
  });

  it('keeps duplicate content conflicts resolvable without undoing the UUID split', async () => {
    const document = doc();
    client.issues = [raw(document, 1), raw(document, 2)];
    await engine.pull();
    const notes = await database.notes.toArray();
    const original = notes.find((note) => note.issueNumber === 1)!;
    const copy = notes.find((note) => note.issueNumber === 2)!;
    await database.notes.update([connection.scopeId, copy.localId], {
      current: { ...copy.current, markdown: 'Local pending body' },
    });
    client.issues[1] = raw({ ...document, markdown: 'Remote changed body' }, 2);
    await engine.resolveDuplicate(original.localId);
    const split = (await database.notes.get([connection.scopeId, copy.localId]))!;
    expect(split.duplicate).toBe(false);
    expect(split.syncStatus).toBe('conflict');
    expect(split.current.meta.id).not.toBe(document.meta.id);
    await resolveConflict(connection.scopeId, copy.localId, 'remote', database);
    await engine.flush(true);
    const result = snapshotToDocument(client.issues[1]!)!;
    expect(result.markdown).toBe('Remote changed body');
    expect(result.meta.id).toBe(split.current.meta.id);
    expect(new Set(client.issues.map((issue) => snapshotToDocument(issue)?.meta.id)).size).toBe(2);
  });

  it('runs a manual save before background pulls that are still queued', async () => {
    const events: string[] = [];
    let unblock!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      reached = resolve;
    });
    client.getAnchor = async () => {
      events.push('read');
      if (events.length === 1) {
        reached();
        await waiting;
      }
      return undefined;
    };
    const originalCreate = client.createIssue.bind(client);
    client.createIssue = async (...args) => {
      events.push('write');
      return originalCreate(...args);
    };
    const firstPull = engine.pull();
    await firstStarted;
    const queuedPull = engine.pull();
    await createNote(connection.scopeId, doc(), database);
    const manualSave = engine.flush(true);
    unblock();
    await Promise.all([firstPull, queuedPull, manualSave]);
    expect(events).toEqual(['read', 'write', 'read']);
  });

  it('spaces automatic note writes by at least 15 seconds and resumes the remaining intent', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    const writes: number[] = [];
    let secondStarted!: () => void;
    const second = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const originalCreate = client.createIssue.bind(client);
    client.createIssue = async (...args) => {
      writes.push(Date.now());
      const result = await originalCreate(...args);
      if (writes.length === 2) secondStarted();
      return result;
    };
    await createNote(connection.scopeId, doc(), database);
    await createNote(connection.scopeId, doc(), database);
    await engine.pull();
    await engine.flush();
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await second;
    expect(writes[1]! - writes[0]!).toBeGreaterThanOrEqual(15_000);
    await engine.pull();
  });

  it('honors longer API polling intervals while visibility resumes after 15 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    client.pollIntervalMs = 120_000;
    let calls = 0;
    let secondStarted!: () => void;
    let thirdStarted!: () => void;
    const second = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    const third = new Promise<void>((resolve) => {
      thirdStarted = resolve;
    });
    client.getAnchor = async () => {
      calls++;
      if (calls === 2) secondStarted();
      if (calls === 3) thirdStarted();
      return undefined;
    };
    await engine.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    await second;
    await engine.flush(true);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(16_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await third;
    await engine.flush(true);
    expect(calls).toBe(3);
  });

  it('allows read-only connections to pull while refusing outbox and label writes', async () => {
    engine.stop();
    engine = new SyncEngine(database, client, { ...connection, readOnly: true });
    await createNote(connection.scopeId, doc(), database);
    await engine.start();
    await engine.flush(true);
    expect((await database.syncState.get(connection.scopeId))?.initialLoadComplete).toBe(true);
    expect(client.creates).toBe(0);
    expect(await database.outbox.count()).toBe(1);
    await expect(engine.createLabel('Forbidden')).rejects.toThrow('READ_ONLY');
    expect(client.labels).toHaveLength(0);
  });

  it('converts only after a latest read, preserving raw Markdown and archive state', async () => {
    client.issues = [{ ...raw(doc()), body: 'Original unmanaged\r\n\r\n  content\n', state: 'closed' }];
    await engine.pull();
    client.issues[0]!.body = 'Changed on GitHub\r\n\r\n  content\n';
    const note = await convertIssue(connection, 1, client, database);
    await engine.flush(true);
    expect((await database.notes.get([connection.scopeId, note.localId]))?.current.markdown).toBe(
      'Changed on GitHub\r\n\r\n  content\n',
    );
    expect(client.issues[0]?.state).toBe('closed');
  });

  it('keeps an open editor baseline so a later edit still detects external changes', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    engine.setEditing(note.localId, true);
    client.issues[0] = raw({ ...note.current, markdown: 'Remote while editor open' });
    await engine.pull();
    expect((await firstNote()).current.markdown).toBe('Original');
    await saveNote(
      connection.scopeId,
      note.localId,
      { ...note.current, markdown: 'User began typing' },
      database,
    );
    await engine.flush(true);
    expect((await firstNote()).syncStatus).toBe('conflict');
  });

  it('discards late responses after the connection stops', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    await saveNote(connection.scopeId, note.localId, { ...note.current, markdown: 'New local' }, database);
    client.onPatch = async () => {
      engine.stop();
    };
    await engine.flush(true);
    expect((await firstNote()).current.markdown).toBe('New local');
    expect(snapshotToDocument((await firstNote()).base!)?.markdown).toBe('Original');
    expect((await database.outbox.toArray())[0]?.status).toBe('sending');
  });

  it('reconciles interrupted PATCH as success before considering a new write', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    const desired = { ...note.current, markdown: 'Confirmed remotely' };
    await saveNote(connection.scopeId, note.localId, desired, database);
    await database.outbox.update([connection.scopeId, note.localId], {
      status: 'uncertain',
      attemptSnapshot: desired,
      attemptRevision: 1,
      attemptStartedAt: new Date().toISOString(),
      attemptBase: note.base!,
    });
    client.issues[0] = raw(desired);
    await engine.flush(true);
    expect(client.patches).toHaveLength(0);
    expect((await firstNote()).syncStatus).toBe('synced');
  });

  it('preserves attempted-write reconciliation when explicitly retrying newer local input', async () => {
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    const attempted = { ...note.current, markdown: 'Applied B' };
    await saveNote(connection.scopeId, note.localId, attempted, database);
    await database.outbox.update([connection.scopeId, note.localId], {
      status: 'uncertain',
      attemptSnapshot: attempted,
      attemptLocalSnapshot: attempted,
      attemptRevision: 1,
      attemptStartedAt: new Date().toISOString(),
      attemptBase: note.base!,
    });
    client.issues[0] = raw(attempted);
    await saveNote(connection.scopeId, note.localId, { ...attempted, markdown: 'Newer C' }, database);
    await engine.retry(note.localId);
    expect((await firstNote()).syncStatus).toBe('pending');
    expect((await firstNote()).current.markdown).toBe('Newer C');
    expect(snapshotToDocument((await firstNote()).base!)?.markdown).toBe('Applied B');
    await engine.flush(true);
    expect((await firstNote()).syncStatus).toBe('synced');
    expect(snapshotToDocument(client.issues[0]!)?.markdown).toBe('Newer C');
  });

  it('keeps unrelated remote labels while recovering a partly completed uncertain write', async () => {
    client.labels = [
      { id: 7, name: 'wanted', color: 'eeeeee', description: null },
      { id: 8, name: 'external', color: 'eeeeee', description: null },
    ];
    client.issues = [raw(doc())];
    await engine.pull();
    const note = await firstNote();
    const desired = { ...note.current, markdown: 'Saved body', labelIds: [7] };
    await saveNote(connection.scopeId, note.localId, desired, database);
    await database.outbox.update([connection.scopeId, note.localId], {
      status: 'uncertain',
      attemptSnapshot: desired,
      attemptRevision: 1,
      attemptStartedAt: new Date().toISOString(),
      attemptBase: note.base!,
    });
    client.issues[0] = { ...raw(desired), labels: [client.labels[1]!] };
    await engine.flush(true);
    expect((await firstNote()).current.labelIds.sort()).toEqual([7, 8]);
    expect(client.issues[0]?.labels.map((label) => label.id).sort()).toEqual([7, 8]);
  });

  it('sends no write if persistence of its frozen attempt fails', async () => {
    const note = await createNote(connection.scopeId, doc(), database);
    await engine.pull();
    vi.spyOn(database.outbox, 'put').mockRejectedValueOnce(new DOMException('Full', 'QuotaExceededError'));
    await engine.flush(true);
    expect(client.creates).toBe(0);
    expect((await database.notes.get([connection.scopeId, note.localId]))?.current.markdown).toBe('Original');
  });
});
