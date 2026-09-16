// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createNote } from '../src/application/commands';
import {
  createMarkdownArchive,
  prepareMarkdownExport,
  summarizeMarkdownExport,
  type MarkdownExportSnapshot,
} from '../src/application/markdown-export';
import { newMetadata } from '../src/domain/codec';
import type { LocalNote } from '../src/domain/types';
import { TebikaeDB } from '../src/storage/db';

const note = (title: string, localId = crypto.randomUUID() as string): LocalNote => ({
  scopeId: 'scope-a',
  localId,
  current: { title, markdown: '正文\r\n\n- [ ] task\n', meta: newMetadata(), archived: false, labelIds: [] },
  base: null,
  lastSeenRemote: null,
  localRevision: 1,
  localCreatedAt: '2026-09-01T00:00:00Z',
  localModifiedAt: '2026-09-16T00:00:00Z',
  syncStatus: 'local-draft',
});
const snapshot = (notes: LocalNote[]): MarkdownExportSnapshot => ({
  exportedAt: '2026-09-16T12:00:00Z',
  repository: 'owner/notebook',
  notes,
  labels: [],
});
async function unpack(input: MarkdownExportSnapshot, includeTrash = false) {
  const { blob, filename } = await createMarkdownArchive(input, includeTrash);
  expect(blob.type).toBe('application/zip');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const text = Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, strFromU8(bytes)]));
  return { filename, text, manifest: JSON.parse(text['manifest.json']!) };
}

describe('Markdown archive', () => {
  it('exports current local Markdown and descriptive metadata without mutating the snapshot', async () => {
    const draft = note('中文 😀');
    draft.current.labelIds = [11];
    draft.current.meta.pinned = true;
    const input = snapshot([draft]);
    input.labels = [{ id: 11, name: 'Ideas', color: 'abcdef', description: null }];
    const before = structuredClone(input);
    const { filename, text, manifest } = await unpack(input);
    expect(filename).toBe('Tebikae-notebook-2026-09-16.zip');
    expect(text['notes/中文 😀.md']).toBe('# 中文 😀\n\nLabels: Ideas\n\n' + draft.current.markdown);
    expect(manifest).toMatchObject({
      format: 'tebikae-markdown-export',
      schemaVersion: 1,
      repository: 'owner/notebook',
      coverage: {
        loadedNotesOnly: true,
        includesTrash: false,
        includesOrdinaryIssues: false,
        includesRecoveryCopies: false,
      },
      notes: [
        {
          path: 'notes/中文 😀.md',
          localId: draft.localId,
          syncStatus: 'local-draft',
          metadata: { pinned: true },
        },
      ],
    });
    expect(input).toEqual(before);
  });

  it('previews folders and excludes trash by default while preserving archive state in trash', async () => {
    const active = note('active'),
      archived = note('archived'),
      trash = note('trash');
    active.syncStatus = 'synced';
    archived.current.archived = true;
    trash.current.archived = true;
    trash.current.meta.trashedAt = '2026-09-15T00:00:00Z';
    const input = snapshot([active, archived, trash]);
    expect(summarizeMarkdownExport(input, false)).toEqual({
      notes: 1,
      archive: 1,
      trash: 0,
      unsynced: 1,
      total: 2,
    });
    expect(summarizeMarkdownExport(input, true)).toEqual({
      notes: 1,
      archive: 1,
      trash: 1,
      unsynced: 2,
      total: 3,
    });
    expect(Object.keys((await unpack(input)).text).sort()).toEqual([
      'archive/archived.md',
      'manifest.json',
      'notes/active.md',
    ]);
    const { text, manifest } = await unpack(input, true);
    expect(text['trash/trash.md']).toContain(trash.current.markdown);
    expect(manifest.notes.find((entry: { title: string }) => entry.title === 'trash')).toMatchObject({
      archived: true,
    });
  });

  it('keeps every duplicate title and UUID, including case and Unicode normalization collisions', async () => {
    const titles = ['Same', 'same', 'Same (2)', 'é', 'e\u0301'];
    const notes = titles.map((title, index) => note(title, String(index)));
    for (const item of notes) item.current.meta.id = notes[0]!.current.meta.id;
    const { text, manifest } = await unpack(snapshot(notes));
    expect(Object.keys(text)).toHaveLength(6);
    const paths = manifest.notes.map((entry: { path: string }) => entry.path.toLowerCase());
    expect(new Set(paths).size).toBe(5);
    expect(manifest.notes.map((entry: { localId: string }) => entry.localId)).toEqual([
      '0',
      '1',
      '2',
      '3',
      '4',
    ]);
    expect((await unpack(snapshot([...notes].reverse()))).text).toEqual(text);
  });

  it.each([
    ['Σ', 'σ', 'ς'],
    ['ß', 'SS', 'ẞ'],
    ['µ', 'Μ', 'μ'],
    ['ſ', 'S', 's'],
    ['ﬀ', 'FF', 'ff'],
    ['é', 'É', 'e\u0301'],
  ])('keeps Unicode-equivalent filenames distinct for %s, %s, and %s', async (...titles) => {
    const notes = titles.map((title, index) => note(title, String(index)));
    const { text, manifest } = await unpack(snapshot(notes));
    expect(manifest.notes.map((item: { path: string }) => item.path)).toEqual([
      `notes/${titles[0]!.normalize('NFC')}.md`,
      `notes/${titles[1]!.normalize('NFC')} (2).md`,
      `notes/${titles[2]!.normalize('NFC')} (3).md`,
    ]);
    for (const item of manifest.notes as Array<{ path: string; title: string }>)
      expect(text[item.path]).toContain(`# ${item.title}\n`);
    expect((await unpack(snapshot([...notes].reverse()))).text).toEqual(text);
  });

  it.each(['COM¹', 'COM²', 'COM³', 'LPT¹', 'LPT²', 'LPT³'])(
    'escapes reserved device name %s with or without extensions',
    async (device) => {
      const titles = [device, `${device.toLowerCase()}.txt`, `${device}.tar.gz`];
      const { text, manifest } = await unpack(
        snapshot(titles.map((title, index) => note(title, String(index)))),
      );
      expect(manifest.notes.map((item: { path: string }) => item.path)).toEqual(
        titles.map((title) => `notes/_${title}.md`),
      );
      expect(Object.keys(text)).toHaveLength(4);
    },
  );

  it('keeps ordinary COM and LPT prefixes unchanged', async () => {
    const titles = ['COM10', 'LPT0', 'COM¹notes'];
    const { text } = await unpack(snapshot(titles.map((title) => note(title))));
    for (const title of titles) expect(text[`notes/${title}.md`]).toBeDefined();
  });

  it.each([
    '../../escape',
    'a\\b:*?<>|"',
    'CON',
    'nul.txt',
    'LPT1',
    '... ',
    '',
    '\u0000\u007f',
    '😀'.repeat(120),
  ])('produces a portable filename for %j', async (title) => {
    const { text } = await unpack(snapshot([note(title)]));
    const path = Object.keys(text).find((name) => name !== 'manifest.json')!;
    const [folder, filename, extra] = path.split('/');
    expect(folder).toBe('notes');
    expect(extra).toBeUndefined();
    expect(filename).not.toMatch(/[<>:"\\|?*]/u);
    expect(filename).not.toMatch(/^(con|nul|lpt1)(\.|$)/iu);
    expect(filename).not.toContain('\uFFFD');
    expect(new TextEncoder().encode(filename).length).toBeLessThan(240);
    expect(filename).toMatch(/\.md$/u);
  });

  it('retains a source link and cached label names while exporting the local version of a conflict', async () => {
    const item = note('Conflict');
    item.syncStatus = 'conflict';
    item.current.labelIds = [11, 12];
    item.base = {
      id: 1,
      nodeId: 'I_1',
      number: 1,
      title: 'Old title',
      body: 'Old body',
      url: 'https://github.com/owner/notebook/issues/1',
      state: 'open',
      stateReason: null,
      labels: [{ id: 11, name: 'Cached label', color: 'abcdef', description: null }],
      createdAt: item.localCreatedAt,
      updatedAt: '2026-09-10T00:00:00Z',
    };
    const { text, manifest } = await unpack(snapshot([item]));
    expect(text['notes/Conflict.md']).toContain('Labels: Cached label, 12');
    expect(text['notes/Conflict.md']).toContain(`Source: ${item.base.url}`);
    expect(text['notes/Conflict.md']).toContain(item.current.markdown);
    expect(text['notes/Conflict.md']).not.toContain('Old body');
    expect(manifest.notes[0].updatedAt).toBe(item.localModifiedAt);
  });

  it('produces an explicit empty manifest for an empty notebook', async () => {
    const { text, manifest } = await unpack(snapshot([]));
    expect(Object.keys(text)).toEqual(['manifest.json']);
    expect(manifest.notes).toEqual([]);
  });
});

describe('repository snapshot', () => {
  let database: TebikaeDB;
  beforeEach(() => {
    database = new TebikaeDB(`markdown-export-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    await database.delete();
  });

  it('isolates repositories and leaves notes and pending operations unchanged', async () => {
    const first = await createNote('scope-a', note('This notebook').current, database);
    await createNote('scope-b', note('Other notebook secret').current, database);
    await database.labels.bulkPut([
      { scopeId: 'scope-a', id: 1, name: 'Local label', color: 'abcdef', description: null },
      { scopeId: 'scope-b', id: 2, name: 'Other label secret', color: 'abcdef', description: null },
    ]);
    await database.connections.put({
      scopeId: 'scope-a',
      viewerId: 1,
      login: 'owner',
      repoId: 2,
      owner: 'owner',
      repo: 'notes',
      lastConnectedAt: '',
    });
    await database.httpCache.put({
      scopeId: 'scope-a',
      url: 'secret',
      accept: 'x',
      apiVersion: 'x',
      etag: 'x',
      response: 'private-cache-secret',
      link: null,
    });
    const notesBefore = await database.notes.toArray();
    const outboxBefore = await database.outbox.toArray();
    const prepared = await prepareMarkdownExport('scope-a', database);
    expect(prepared.notes.map((item) => item.localId)).toEqual([first.localId]);
    expect(prepared.repository).toBe('owner/notes');
    const result = JSON.stringify((await unpack(prepared)).text);
    expect(result).not.toContain('Other notebook secret');
    expect(result).not.toContain('Other label secret');
    expect(result).not.toContain('private-cache-secret');
    expect(await database.notes.toArray()).toEqual(notesBefore);
    expect(await database.outbox.toArray()).toEqual(outboxBefore);
    await database.notes.update(['scope-a', first.localId], { 'current.markdown': 'Edited after preview' });
    expect((await unpack(prepared)).text['notes/This notebook.md']).not.toContain('Edited after preview');
  });
});
