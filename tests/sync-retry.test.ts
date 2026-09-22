import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNote, saveNote } from '../src/application/commands';
import { newMetadata, serializeNoteBody } from '../src/domain/codec';
import type { ApiFailure, Connection, NoteDocument, RawIssueSnapshot } from '../src/domain/types';
import { TebikaeDB } from '../src/storage/db';
import { SyncEngine, type SyncClient } from '../src/sync/engine';
import { retryDeadline } from '../src/sync/retry-policy';

const connection: Connection = {
  scopeId: 'github.com:1:2',
  viewerId: 1,
  repoId: 2,
  login: 'owner',
  owner: 'owner',
  repo: 'notes',
  lastConnectedAt: '2026-09-22T00:00:00.000Z',
};
const document = (): NoteDocument => ({
  title: 'Draft',
  markdown: 'Original',
  meta: newMetadata(),
  archived: false,
  labelIds: [],
});
const snapshot = (doc: NoteDocument, id = 1): RawIssueSnapshot => ({
  id,
  number: id,
  nodeId: `I_${id}`,
  url: `https://github.com/owner/notes/issues/${id}`,
  title: doc.title,
  body: serializeNoteBody(doc.meta, doc.markdown),
  state: doc.archived ? 'closed' : 'open',
  stateReason: null,
  labels: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-22T00:00:00.000Z',
});
const failure = (code: ApiFailure['code'], retryAt?: string) =>
  Object.assign(new Error(code), { failure: { code, retryAt } });

let db: TebikaeDB;
let engine: SyncEngine;
let issues: RawIssueSnapshot[];
let client: ReturnType<typeof makeClient>;
function makeClient() {
  return {
    getAnchor: vi.fn(async () => new Date().toISOString()),
    listIssues: vi.fn(async function* (_: Connection, options?: { since?: string }) {
      void options;
      yield structuredClone(issues);
    }),
    listLabels: vi.fn(async () => []),
    getIssue: vi.fn(async (_: Connection, number: number) =>
      structuredClone(issues.find((i) => i.number === number)!),
    ),
    createIssue: vi.fn(async (_: Connection, payload: { title: string; body: string }) => {
      const result = { ...snapshot(document(), issues.length + 1), ...payload };
      issues.push(result);
      return structuredClone(result);
    }),
    updateIssue: vi.fn(
      async (
        _: Connection,
        number: number,
        payload: { title?: string; body?: string; state?: 'open' | 'closed' },
      ) => {
        const issue = issues.find((i) => i.number === number)!;
        Object.assign(issue, payload);
        return structuredClone(issue);
      },
    ),
    createLabel: vi.fn(async () => ({ id: 1, name: 'work', color: '000000', description: null })),
    addLabels: vi.fn(async () => []),
    removeLabel: vi.fn(async () => []),
    deleteIssue: vi.fn(async () => {}),
  } satisfies SyncClient;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime('2026-09-22T00:00:00.000Z');
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  db = new TebikaeDB(`retry-${crypto.randomUUID()}`);
  issues = [];
  client = makeClient();
  engine = new SyncEngine(db, client, connection);
});
afterEach(async () => {
  engine.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await db.delete();
});
const firstNote = async () => (await db.notes.toArray())[0]!;
const firstEntry = async () => (await db.outbox.toArray())[0]!;
async function editRemote() {
  issues = [snapshot(document())];
  await engine.pull();
  const note = await firstNote();
  return saveNote(connection.scopeId, note.localId, { ...note.current, title: 'Edited' }, db);
}
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('durable synchronization retry', () => {
  it('stops discovery wakeups after a terminal full-scan failure', async () => {
    await createNote(connection.scopeId, document(), db);
    client.createIssue.mockRejectedValueOnce(failure('NETWORK_UNCERTAIN'));
    await engine.start();
    client.getAnchor.mockRejectedValue(failure('AUTH_REQUIRED'));
    await advance(30_000);
    await vi.waitFor(async () =>
      expect((await db.syncState.get(connection.scopeId))?.error?.code).toBe('AUTH_REQUIRED'),
    );
    await engine.flush(true);
    const reads = client.getAnchor.mock.calls.length;
    await advance(10_000);
    await engine.flush(true);
    expect(client.getAnchor).toHaveBeenCalledTimes(reads);
    expect((await firstEntry()).status).toBe('uncertain');
    expect(client.createIssue).toHaveBeenCalledTimes(1);
  });

  it('preserves a failed full-scan requirement through a restart with a recent cursor', async () => {
    await engine.pull();
    client.listIssues.mockImplementationOnce(async function* () {
      yield [];
      throw failure('SERVER_ERROR');
    });
    await expect(engine.pull(true)).rejects.toThrow('SERVER_ERROR');
    engine.stop();
    engine = new SyncEngine(db, client, connection);
    await engine.start();
    await advance(5_000);
    await vi.waitFor(async () =>
      expect((await db.syncState.get(connection.scopeId))?.pullRetryAt).toBeUndefined(),
    );
    expect(client.listIssues.mock.calls.at(-1)?.[1]?.since).toBeUndefined();
  });

  it('allows read-only discovery of an uncertain create while keeping all writes disabled', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    issues = [snapshot(draft.current)];
    await db.syncState.put({
      scopeId: connection.scopeId,
      initialLoadComplete: true,
      cursor: new Date().toISOString(),
      lastFullScanAt: new Date().toISOString(),
    });
    await db.outbox.update([connection.scopeId, draft.localId], {
      status: 'uncertain',
      attemptSnapshot: draft.current,
      attemptRevision: 1,
      attemptStartedAt: new Date().toISOString(),
      retryAt: new Date(Date.now() + 5_000).toISOString(),
    });
    client.listIssues.mockImplementation(async function* (_, options) {
      yield options?.since ? [] : structuredClone(issues);
    });
    engine.stop();
    engine = new SyncEngine(db, client, { ...connection, readOnly: true });
    await engine.start();
    await advance(5_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'), { timeout: 1_000 });
    expect(client.createIssue).not.toHaveBeenCalled();
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it('schedules newer input remaining after a successful retry acknowledgement', async () => {
    const note = await editRemote();
    client.getIssue.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await engine.start();
    const update = client.updateIssue.getMockImplementation()!;
    client.updateIssue.mockImplementationOnce(async (...args) => {
      const remote = await update(...args);
      await saveNote(connection.scopeId, note.localId, { ...note.current, title: 'Newer input' }, db);
      return remote;
    });
    await advance(5_000);
    await vi.waitFor(async () => expect((await firstNote()).current.title).toBe('Newer input'));
    expect((await firstNote()).syncStatus).toBe('pending');
    await advance(30_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'), { timeout: 1_000 });
    expect(issues[0]!.title).toBe('Newer input');
    expect(client.updateIssue).toHaveBeenCalledTimes(2);
  });

  it('resumes crash-interrupted create discovery against the persisted database', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    issues = [snapshot(draft.current)];
    await db.syncState.put({
      scopeId: connection.scopeId,
      initialLoadComplete: true,
      cursor: new Date().toISOString(),
      lastFullScanAt: new Date().toISOString(),
    });
    await db.outbox.update([connection.scopeId, draft.localId], {
      status: 'sending',
      attemptSnapshot: draft.current,
      attemptRevision: 1,
      attemptStartedAt: new Date().toISOString(),
    });
    // The incremental feed no longer includes the old Issue; discovery must scan all Issues.
    client.listIssues.mockImplementation(async function* (_, options) {
      yield options?.since ? [] : structuredClone(issues);
    });
    await engine.start();
    await advance(50);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(client.createIssue).not.toHaveBeenCalled();
    expect((await firstNote()).issueNumber).toBe(1);
  });

  it('preserves conflicts discovered by an explicit uncertain-create retry', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    const create = client.createIssue.getMockImplementation()!;
    client.createIssue.mockImplementationOnce(async (...args) => {
      await create(...args);
      issues[0]!.title = 'Remote title';
      throw failure('NETWORK_UNCERTAIN');
    });
    await engine.flush(true);
    await saveNote(connection.scopeId, draft.localId, { ...draft.current, title: 'Local title' }, db);
    await engine.retry(draft.localId, true);
    expect(await firstEntry()).toMatchObject({ kind: 'update', status: 'conflict' });
    expect((await firstNote()).current.title).toBe('Local title');
    expect(client.updateIssue).not.toHaveBeenCalled();
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    // A stale retry action must not act as a conflict-resolution choice.
    await engine.retry(draft.localId);
    expect((await firstEntry()).status).toBe('conflict');
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it('does not advance a cursor or confirm missing Issues after an interrupted page scan', async () => {
    await db.syncState.put({
      scopeId: connection.scopeId,
      initialLoadComplete: true,
      cursor: '2026-09-01T00:00:00.000Z',
      lastFullScanAt: '2026-09-01T00:00:00.000Z',
    });
    client.listIssues.mockImplementationOnce(async function* () {
      yield [snapshot(document())];
      throw failure('SERVER_ERROR');
    });
    await expect(engine.start()).rejects.toThrow('SERVER_ERROR');
    expect(await db.syncState.get(connection.scopeId)).toMatchObject({
      cursor: '2026-09-01T00:00:00.000Z',
      lastFullScanAt: '2026-09-01T00:00:00.000Z',
      pullRetryAttempts: 1,
    });
    expect((await firstNote()).remoteUnavailable).not.toBe(true);
  });

  it('defers overdue retries while hidden and resumes them on visibility change', async () => {
    await editRemote();
    client.getIssue.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await engine.start();
    const visibility = vi.spyOn(globalThis.document, 'visibilityState', 'get').mockReturnValue('hidden');
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    await advance(10_000);
    expect(client.getIssue).toHaveBeenCalledTimes(1);
    visibility.mockReturnValue('visible');
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
  });

  it('keeps another notebook scope outside the persisted rate-limit gate', async () => {
    await db.syncState.put({
      scopeId: 'github.com:99:99',
      initialLoadComplete: true,
      rateLimitUntil: '2026-09-22T01:00:00.000Z',
    });
    await createNote(connection.scopeId, document(), db);
    await engine.start();
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect((await firstNote()).syncStatus).toBe('synced');
  });

  it('never schedules writes in a read-only connection', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    await db.outbox.update([connection.scopeId, draft.localId], { retryAt: new Date().toISOString() });
    engine.stop();
    engine = new SyncEngine(db, client, { ...connection, readOnly: true });
    await engine.start();
    await advance(30_000);
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  it('automatically recovers a failed initial pull and then uploads the durable draft', async () => {
    await createNote(connection.scopeId, document(), db);
    client.getAnchor.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await expect(engine.start()).rejects.toThrow('SERVER_ERROR');
    expect(await db.syncState.get(connection.scopeId)).toMatchObject({
      initialLoadComplete: false,
      pullRetryAttempts: 1,
      pullRetryAt: '2026-09-22T00:00:05.000Z',
    });
    expect(client.createIssue).not.toHaveBeenCalled();
    await advance(5_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect((await db.syncState.get(connection.scopeId))?.pullRetryAt).toBeUndefined();
  });

  it('retries preflight reads without freezing a mutation and increases persisted backoff', async () => {
    await editRemote();
    client.getIssue.mockRejectedValue(failure('SERVER_ERROR'));
    await engine.flush(true);
    expect(await firstEntry()).toMatchObject({
      status: 'pending',
      retryAttempts: 1,
      retryAt: '2026-09-22T00:00:05.000Z',
    });
    expect((await firstEntry()).attemptStartedAt).toBeUndefined();
    await engine.flush(true);
    expect(client.getIssue).toHaveBeenCalledTimes(1);
    await advance(5_000);
    await engine.flush(true);
    expect(await firstEntry()).toMatchObject({
      status: 'pending',
      retryAttempts: 2,
      retryAt: '2026-09-22T00:00:15.000Z',
    });
    expect(client.updateIssue).not.toHaveBeenCalled();
    client.getIssue.mockResolvedValue(structuredClone(issues[0]!));
    await engine.start();
    await advance(10_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(client.updateIssue).toHaveBeenCalledTimes(1);
  });

  it('preserves backoff and newer input when restarting after a preflight failure', async () => {
    const note = await editRemote();
    client.getIssue.mockRejectedValueOnce(failure('NETWORK_UNCERTAIN'));
    await engine.flush(true);
    await saveNote(connection.scopeId, note.localId, { ...note.current, title: 'Newer title' }, db);
    const due = (await firstEntry()).retryAt;
    engine.stop();
    engine = new SyncEngine(db, client, connection);
    await engine.start();
    expect((await firstEntry()).retryAt).toBe(due);
    expect(client.getIssue).toHaveBeenCalledTimes(1);
    await advance(5_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(issues[0]!.title).toBe('Newer title');
  });

  it('persists a server cooldown across restart and blocks both manual flushes and label writes', async () => {
    await createNote(connection.scopeId, document(), db);
    await createNote(connection.scopeId, { ...document(), title: 'Second' }, db);
    const deadline = '2026-09-22T00:01:30.000Z';
    client.createIssue.mockRejectedValueOnce(failure('RATE_LIMITED', deadline));
    await engine.flush(true);
    expect((await db.syncState.get(connection.scopeId))?.rateLimitUntil).toBe(deadline);
    engine.stop();
    engine = new SyncEngine(db, client, connection);
    const reads = client.getAnchor.mock.calls.length;
    await engine.start();
    await engine.flush(true);
    await expect(engine.createLabel('work')).rejects.toThrow('RATE_LIMITED');
    expect(client.getAnchor).toHaveBeenCalledTimes(reads);
    expect(client.createLabel).not.toHaveBeenCalled();
    await advance(89_000);
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    await advance(1_000);
    await vi.waitFor(() => expect(client.createIssue).toHaveBeenCalledTimes(2));
    await advance(30_000);
    await vi.waitFor(async () => expect(await db.outbox.count()).toBe(0));
    expect(client.createIssue).toHaveBeenCalledTimes(3);
  });

  it('discovers a lost POST response without creating another Issue', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    const create = client.createIssue.getMockImplementation()!;
    client.createIssue.mockImplementationOnce(async (...args) => {
      await create(...args);
      throw failure('NETWORK_UNCERTAIN');
    });
    await engine.start();
    expect(await firstEntry()).toMatchObject({ status: 'uncertain', kind: 'create' });
    await saveNote(connection.scopeId, draft.localId, { ...draft.current, title: 'After dispatch' }, db);
    await advance(30_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(issues[0]!.title).toBe('After dispatch');
    expect(client.listIssues.mock.calls.at(-1)?.[1]?.since).toBeUndefined();
  });

  it('leaves a missing uncertain create for confirmation after one full discovery scan', async () => {
    await createNote(connection.scopeId, document(), db);
    client.createIssue.mockRejectedValueOnce(failure('NETWORK_UNCERTAIN'));
    await engine.start();
    await advance(30_000);
    await vi.waitFor(async () => expect((await firstEntry()).retryAt).toBeUndefined());
    expect((await firstEntry()).status).toBe('uncertain');
    const scans = client.listIssues.mock.calls.length;
    await advance(20_000);
    expect(client.listIssues).toHaveBeenCalledTimes(scans);
    expect(client.createIssue).toHaveBeenCalledTimes(1);
  });

  it('does not authorize retrying an uncertain POST while the discovery scan is skipped', async () => {
    const draft = await createNote(connection.scopeId, document(), db);
    client.createIssue.mockRejectedValueOnce(failure('NETWORK_UNCERTAIN'));
    await engine.flush(true);
    client.getAnchor.mockRejectedValueOnce(failure('RATE_LIMITED', '2026-09-22T00:01:00.000Z'));
    await expect(engine.pull(true)).rejects.toThrow('RATE_LIMITED');
    await engine.retry(draft.localId, true);
    expect((await firstEntry()).status).toBe('uncertain');
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await advance(60_000);
    await engine.retry(draft.localId, true);
    expect((await firstEntry()).status).toBe('uncertain');
  });

  it('reconciles a successful PATCH with a lost response instead of applying it twice', async () => {
    await editRemote();
    const update = client.updateIssue.getMockImplementation()!;
    client.updateIssue.mockImplementationOnce(async (...args) => {
      await update(...args);
      throw failure('NETWORK_UNCERTAIN');
    });
    await engine.start();
    expect((await firstEntry()).status).toBe('uncertain');
    await advance(30_000);
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
    expect(client.updateIssue).toHaveBeenCalledTimes(1);
  });

  it('retains uncertain-write evidence when reconciliation itself is rate limited', async () => {
    const note = await editRemote();
    client.updateIssue.mockRejectedValueOnce(failure('NETWORK_UNCERTAIN'));
    await engine.flush(true);
    const sent = await firstEntry();
    client.getIssue.mockRejectedValueOnce(failure('RATE_LIMITED', '2026-09-22T00:01:00.000Z'));
    await engine.retry(note.localId);
    expect(await firstEntry()).toMatchObject({ status: 'uncertain', attemptSnapshot: sent.attemptSnapshot });
    issues[0]!.title = 'Changed on GitHub';
    await advance(60_000);
    await engine.flush(true);
    expect((await firstNote()).syncStatus).toBe('conflict');
    expect(client.updateIssue).toHaveBeenCalledTimes(1);
  });

  it.each(['AUTH_REQUIRED', 'FORBIDDEN', 'VALIDATION_FAILED', 'NOT_FOUND_OR_INACCESSIBLE'] as const)(
    'does not automatically retry terminal %s errors',
    async (code) => {
      await editRemote();
      client.getIssue.mockRejectedValueOnce(failure(code));
      await engine.start();
      expect(await firstEntry()).toMatchObject({ status: 'error' });
      expect((await firstEntry()).retryAt).toBeUndefined();
      await advance(30_000);
      expect(client.getIssue).toHaveBeenCalledTimes(1);
    },
  );

  it('stops all scheduled retries on session teardown', async () => {
    await editRemote();
    client.getIssue.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await engine.start();
    engine.stop();
    await advance(120_000);
    expect(client.getIssue).toHaveBeenCalledTimes(1);
    expect(client.updateIssue).not.toHaveBeenCalled();
  });

  it('resumes a due retry after returning online without writing while offline', async () => {
    await editRemote();
    client.getIssue.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await engine.start();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    window.dispatchEvent(new Event('offline'));
    await advance(10_000);
    expect(client.getIssue).toHaveBeenCalledTimes(1);
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(async () => expect((await firstNote()).syncStatus).toBe('synced'));
  });

  it('does not let one failing note prevent a different note from syncing', async () => {
    issues = [snapshot(document(), 1), snapshot(document(), 2)];
    await engine.pull();
    for (const note of await db.notes.toArray()) {
      await saveNote(connection.scopeId, note.localId, { ...note.current, title: 'Changed' }, db);
    }
    client.getIssue.mockRejectedValueOnce(failure('SERVER_ERROR'));
    await engine.flush(true);
    expect(client.getIssue).toHaveBeenCalledTimes(2);
    expect(client.updateIssue).toHaveBeenCalledTimes(1);
    expect(await db.outbox.count()).toBe(1);
  });
});

describe('retry policy', () => {
  it('uses bounded exponential jitter and never retries permanent errors', () => {
    expect(retryDeadline({ code: 'SERVER_ERROR' }, 1, 0, 0)).toBe(new Date(3_750).toISOString());
    expect(retryDeadline({ code: 'SERVER_ERROR' }, 2, 0, 1)).toBe(new Date(12_500).toISOString());
    expect(retryDeadline({ code: 'NETWORK_UNCERTAIN' }, 1_000, 0, 1)).toBe(new Date(300_000).toISOString());
    expect(retryDeadline({ code: 'FORBIDDEN' }, 1)).toBeUndefined();
  });
  it('honors server deadlines and handles absent, invalid, or stale retry hints', () => {
    expect(retryDeadline({ code: 'RATE_LIMITED', retryAt: new Date(600_000).toISOString() }, 99, 0)).toBe(
      new Date(600_000).toISOString(),
    );
    expect(retryDeadline({ code: 'RATE_LIMITED', retryAt: 'invalid' }, 1, 0)).toBe(
      new Date(60_000).toISOString(),
    );
    expect(retryDeadline({ code: 'RATE_LIMITED', retryAt: new Date(1).toISOString() }, 1, 2_000)).toBe(
      new Date(3_000).toISOString(),
    );
  });
});
