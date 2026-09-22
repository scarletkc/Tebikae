import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { GitHubClient } from '../src/adapters/github/client';
import { createNote, saveNote } from '../src/application/commands';
import { newMetadata, serializeNoteBody } from '../src/domain/codec';
import type { Connection, NoteDocument } from '../src/domain/types';
import { TebikaeDB } from '../src/storage/db';
import { SyncEngine } from '../src/sync/engine';

const server = setupServer();
const connection: Connection = {
  scopeId: 'github.com:1:2',
  viewerId: 1,
  login: 'owner',
  repoId: 2,
  owner: 'owner',
  repo: 'notes',
  lastConnectedAt: '2026-09-01T00:00:00Z',
};
const api = 'https://api.github.com/repos/owner/notes';
const document = (): NoteDocument => ({
  title: 'Network test',
  markdown: 'Body',
  meta: newMetadata(),
  archived: false,
  labelIds: [],
});
function issue(doc: NoteDocument) {
  return {
    id: 1,
    node_id: 'I_1',
    number: 1,
    html_url: 'https://github.com/owner/notes/issues/1',
    title: doc.title,
    body: serializeNoteBody(doc.meta, doc.markdown),
    state: 'open',
    state_reason: null,
    labels: [],
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-16T00:00:00Z',
  };
}
let database: TebikaeDB;
let engine: SyncEngine;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => {
  database = new TebikaeDB(`network-test-${crypto.randomUUID()}`);
  engine = new SyncEngine(
    database,
    new GitHubClient(() => ({ token: 'test-only-token', generation: 1 }), { writeIntervalMs: 0 }),
    connection,
  );
  server.use(http.get(`${api}/labels`, () => HttpResponse.json([])));
});
afterEach(async () => {
  engine.stop();
  await database.delete();
  server.resetHandlers();
});

describe('adapter + outbox failure integration', () => {
  it('recovers a POST executed before its HTTP response was lost without posting twice', async () => {
    const remote: ReturnType<typeof issue>[] = [];
    let posts = 0;
    server.use(
      http.get(`${api}/issues`, () => HttpResponse.json(remote)),
      http.post(`${api}/issues`, async ({ request }) => {
        const payload = (await request.json()) as { title: string; body: string };
        posts++;
        remote.push({ ...issue(document()), ...payload });
        return HttpResponse.error();
      }),
    );
    const note = await createNote(connection.scopeId, document(), database);
    await engine.flush(true);
    expect((await database.notes.get([connection.scopeId, note.localId]))?.syncStatus).toBe('uncertain');
    await engine.flush(true);
    expect(posts).toBe(1);
    engine.stop();
    engine = new SyncEngine(
      database,
      new GitHubClient(() => ({ token: 'test-only-token', generation: 2 }), { writeIntervalMs: 0 }),
      connection,
    );
    await engine.start();
    expect((await database.notes.get([connection.scopeId, note.localId]))?.syncStatus).toBe('synced');
    expect(posts).toBe(1);
  });

  it('freezes a possibly applied PATCH and detects a third version before retrying', async () => {
    let remote = issue(document());
    let patches = 0;
    server.use(
      http.get(`${api}/issues`, () => HttpResponse.json([remote])),
      http.get(`${api}/issues/1`, () => HttpResponse.json(remote)),
      http.patch(`${api}/issues/1`, async ({ request }) => {
        patches++;
        remote = { ...remote, ...((await request.json()) as object) };
        return HttpResponse.error();
      }),
    );
    await engine.pull();
    const note = (await database.notes.toArray())[0]!;
    await saveNote(connection.scopeId, note.localId, { ...note.current, markdown: 'Local write' }, database);
    await engine.flush(true);
    expect((await database.notes.toArray())[0]?.syncStatus).toBe('uncertain');
    remote.body = serializeNoteBody(note.current.meta, 'A third version on GitHub');
    await engine.flush(true);
    expect((await database.notes.toArray())[0]?.syncStatus).toBe('uncertain');
    expect(patches).toBe(1);
    // A general flush honors backoff; explicitly retrying this note reconciles immediately.
    await engine.retry(note.localId);
    expect((await database.notes.toArray())[0]?.syncStatus).toBe('conflict');
    expect((await database.notes.toArray())[0]?.current.markdown).toBe('Local write');
    expect(patches).toBe(1);
  });

  it('persists local input while the API rejects writes with a rate limit', async () => {
    let posts = 0;
    server.use(
      http.get(`${api}/issues`, () => HttpResponse.json([])),
      http.post(`${api}/issues`, () => {
        posts++;
        return HttpResponse.json(
          { message: 'Rate limited' },
          { status: 429, headers: { 'Retry-After': '120' } },
        );
      }),
    );
    const note = await createNote(connection.scopeId, document(), database);
    await engine.flush(true);
    expect((await database.notes.toArray())[0]?.syncStatus).toBe('rate-limited');
    await saveNote(
      connection.scopeId,
      note.localId,
      { ...note.current, markdown: 'More offline-safe typing' },
      database,
    );
    await engine.flush(true);
    expect((await database.notes.toArray())[0]?.current.markdown).toBe('More offline-safe typing');
    expect(posts).toBe(1);
  });
});
