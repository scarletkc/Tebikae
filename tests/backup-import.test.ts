// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backupNoteFingerprint,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_NOTES,
  parseBackup,
} from '../src/domain/backup-import';
import { importBackupNotes, previewBackupImport } from '../src/application/backup-import';
import { createNote, exportScope } from '../src/application/commands';
import { newMetadata } from '../src/domain/codec';
import type { NoteDocument } from '../src/domain/types';
import { TebikaeDB } from '../src/storage/db';

const document = (patch: Partial<NoteDocument> = {}): NoteDocument => ({
  title: 'Restored note',
  markdown: '原始正文\r\n\n- [ ] task\n',
  archived: false,
  labelIds: [],
  meta: newMetadata(),
  ...patch,
});
const backup = (documents = [document()], extra: Record<string, unknown> = {}) => ({
  format: 'issue-notes-export',
  schemaVersion: 1,
  notes: documents.map((current) => ({ current })),
  labels: [],
  source: { repository: 'source/notebook' },
  ...extra,
});
const parse = (value: unknown) => parseBackup(JSON.stringify(value));

describe('backup validation', () => {
  it.each([
    ['{}', 'format'],
    ['[1]', 'format'],
    ['{"format":"other"}', 'format'],
    ['null', 'format'],
    ['{broken', 'json'],
    [JSON.stringify(backup([], { schemaVersion: 2 })), 'version'],
    [
      JSON.stringify(
        backup([], {
          labels: [
            { id: 1, name: 'a' },
            { id: 1, name: 'b' },
          ],
        }),
      ),
      'format',
    ],
  ])('rejects invalid backup %s', (text, code) => {
    expect(() => parseBackup(text)).toThrow(expect.objectContaining({ code }));
  });

  it('bounds input bytes and record count before building a preview', () => {
    expect(() => parseBackup(' '.repeat(IMPORT_MAX_BYTES + 1))).toThrow(
      expect.objectContaining({ code: 'size' }),
    );
    expect(() =>
      parse(backup([], { notes: Array.from({ length: IMPORT_MAX_NOTES + 1 }, () => null) })),
    ).toThrow(expect.objectContaining({ code: 'count' }));
  });

  it('preserves valid records and reports invalid ones separately', () => {
    const good = document();
    const parsed = parse(
      backup([
        good,
        document({ title: 'x'.repeat(121) }),
        document({ markdown: 'x'.repeat(40001) }),
        document({ meta: { ...newMetadata(), schemaVersion: 2 } as unknown as NoteDocument['meta'] }),
      ]),
    );
    expect(parsed.notes[0]?.document).toEqual(good);
    expect(parsed.invalid.map((item) => item.reason)).toEqual(['title', 'markdown', 'meta']);
    expect(parsed.invalid.map((item) => item.index)).toEqual([1, 2, 3]);
  });

  it('does not infer missing booleans or accept hostile label types', () => {
    const parsed = parse(
      backup([], {
        notes: [
          { current: { ...document(), archived: 'false' } },
          { current: { ...document(), labelIds: [-1] } },
          { current: { ...document(), markdown: null } },
          null,
        ],
      }),
    );
    expect(parsed.notes).toEqual([]);
    expect(parsed.invalid).toHaveLength(4);
  });

  it('uses notes exactly once and ignores aliases, remote identities, and pending attempts', () => {
    const doc = document();
    const parsed = parseBackup(
      '\uFEFF' +
        JSON.stringify(
          backup([doc], {
            drafts: [{ current: doc }],
            conflicts: [{ current: doc }],
            recovery: [{ snapshot: doc }],
            attempts: [{ kind: 'create', status: 'sending' }],
            credentials: 'never restore this',
          }),
        ),
    );
    expect(parsed.notes).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain('never restore this');
  });

  it('preserves prototype-named extension data and hashes metadata independently of key order', async () => {
    const doc = document();
    const extra = JSON.parse('{"__proto__":{"custom":true},"constructor":{"name":"extension"}}') as Record<
      string,
      unknown
    >;
    doc.meta = { ...doc.meta, ...extra, extension: { z: 1, a: 2 } };
    const first = parse(backup([doc])).notes[0]!;
    const reordered = { ...doc, meta: { ...doc.meta, extension: { a: 2, z: 1 } } };
    expect(first.document.meta.__proto__).toEqual({ custom: true });
    expect(Object.getPrototypeOf(first.document.meta)).toBeNull();
    expect(await backupNoteFingerprint(first)).toBe(
      await backupNoteFingerprint(parse(backup([reordered])).notes[0]!),
    );
  });

  it('fingerprints label names independently of source repository IDs', async () => {
    const doc = document({ labelIds: [1] });
    const first = parse(backup([doc], { labels: [{ id: 1, name: 'Work' }] })).notes[0]!;
    const second = parse(backup([{ ...doc, labelIds: [99] }], { labels: [{ id: 99, name: 'Work' }] }))
      .notes[0]!;
    expect(await backupNoteFingerprint(first)).toBe(await backupNoteFingerprint(second));
    expect(parse(backup([doc])).notes[0]!.unknownLabelIds).toEqual([1]);
  });
});

describe('transactional backup import', () => {
  let database: TebikaeDB;
  beforeEach(() => {
    database = new TebikaeDB(`backup-import-${crypto.randomUUID()}`);
  });
  afterEach(async () => {
    await database.delete();
  });
  const writable = () => {};

  it('round-trips a real export into independent local notes and fresh sync intents', async () => {
    const doc = document({ archived: true, labelIds: [7] });
    const original = await createNote('source', doc, database);
    await database.labels.bulkPut([
      { scopeId: 'source', id: 7, name: 'Work', color: 'aaaaaa', description: null },
      { scopeId: 'target', id: 52, name: 'Work', color: 'bbbbbb', description: null },
    ]);
    const exported = await exportScope('source', database);
    const preview = await previewBackupImport('target', parse(exported), database);
    expect(await importBackupNotes(preview, [0], writable, database)).toEqual({ imported: 1, skipped: 0 });
    const restored = (await database.notes.where('scopeId').equals('target').toArray())[0]!;
    expect(restored.current.markdown).toBe(doc.markdown);
    expect(restored.current.archived).toBe(true);
    expect(restored.current.labelIds).toEqual([52]);
    expect(restored.current.meta.id).not.toBe(doc.meta.id);
    expect(restored.localId).not.toBe(original.localId);
    expect(restored.issueId).toBeUndefined();
    expect(restored.base).toBeNull();
    expect(restored.syncStatus).toBe('local-draft');
    expect(await database.outbox.get(['target', restored.localId])).toMatchObject({
      kind: 'create',
      status: 'pending',
    });
    expect(await database.notes.get(['source', original.localId])).toEqual(original);
  });

  it('deduplicates records within a file and rechecks repeat imports inside the transaction', async () => {
    const doc = document();
    const parsed = parse(backup([doc, doc]));
    const first = await previewBackupImport('target', parsed, database);
    const stale = await previewBackupImport('target', parsed, database);
    expect(first.rows.map((row) => row.duplicate)).toEqual([false, true]);
    expect(await importBackupNotes(first, [0, 1], writable, database)).toEqual({ imported: 1, skipped: 1 });
    expect(await importBackupNotes(stale, [0], writable, database)).toEqual({ imported: 0, skipped: 1 });
    expect((await previewBackupImport('target', parsed, database)).rows.every((row) => row.duplicate)).toBe(
      true,
    );
    expect(await database.outbox.count()).toBe(1);
  });

  it('serializes concurrent imports without duplicate creates', async () => {
    const preview = await previewBackupImport('target', parse(backup()), database);
    const results = await Promise.all([
      importBackupNotes(preview, [0], writable, database),
      importBackupNotes(preview, [0], writable, database),
    ]);
    expect(results.reduce((total, item) => total + item.imported, 0)).toBe(1);
    expect(await database.notes.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
  });

  it('allows changed versions as new copies and keeps deduplication scoped to the destination', async () => {
    const doc = document();
    const original = parse(backup([doc]));
    await importBackupNotes(await previewBackupImport('a', original, database), [0], writable, database);
    const changed = parse(backup([{ ...doc, markdown: 'Changed backup' }]));
    await importBackupNotes(await previewBackupImport('a', changed, database), [0], writable, database);
    await importBackupNotes(await previewBackupImport('b', original, database), [0], writable, database);
    expect(await database.notes.count()).toBe(3);
  });

  it('omits unmatched labels and aborts if that decision changes after preview', async () => {
    const parsed = parse(backup([document({ labelIds: [1, 2] })], { labels: [{ id: 1, name: 'Missing' }] }));
    const preview = await previewBackupImport('a', parsed, database);
    expect(preview.rows[0]!.missingLabels).toEqual(['Missing']);
    expect(preview.rows[0]!.unknownLabelIds).toEqual([2]);
    await database.labels.put({ scopeId: 'a', id: 90, name: 'Missing', color: 'ffffff', description: null });
    await expect(importBackupNotes(preview, [0], writable, database)).rejects.toMatchObject({
      code: 'selection',
    });
    expect(await database.notes.count()).toBe(0);
  });

  it('rolls back every note if persisting the sync intents fails', async () => {
    const preview = await previewBackupImport('a', parse(backup([document(), document()])), database);
    vi.spyOn(database.outbox, 'bulkAdd').mockRejectedValueOnce(new Error('QuotaExceeded'));
    await expect(importBackupNotes(preview, [0, 1], writable, database)).rejects.toThrow('QuotaExceeded');
    expect(await database.notes.count()).toBe(0);
    expect(await database.outbox.count()).toBe(0);
  });

  it('treats ambiguous label names as unmatched and keeps exact unique matches', async () => {
    const parsed = parse(
      backup([document({ labelIds: [1, 2] })], {
        labels: [
          { id: 1, name: 'Work' },
          { id: 2, name: 'Unique' },
        ],
      }),
    );
    await database.labels.bulkPut([
      { scopeId: 'a', id: 7, name: 'Work', color: 'ffffff', description: null },
      { scopeId: 'a', id: 8, name: 'Work', color: 'ffffff', description: null },
      { scopeId: 'a', id: 9, name: 'Unique', color: 'ffffff', description: null },
      { scopeId: 'a', id: 10, name: 'work', color: 'ffffff', description: null },
    ]);
    const preview = await previewBackupImport('a', parsed, database);
    expect(preview.rows[0]!.missingLabels).toEqual(['Work']);
    await importBackupNotes(preview, [0], writable, database);
    expect((await database.notes.toArray())[0]!.current.labelIds).toEqual([9]);
  });

  it('rolls back when editing access is lost before commit', async () => {
    const preview = await previewBackupImport('a', parse(backup()), database);
    const guard = vi
      .fn()
      .mockImplementationOnce(writable)
      .mockImplementationOnce(writable)
      .mockImplementation(() => {
        throw new Error('read-only');
      });
    await expect(importBackupNotes(preview, [0], guard, database)).rejects.toThrow('read-only');
    expect(await database.notes.count()).toBe(0);
  });

  it('rejects stale/tampered previews and invalid selections before any writes', async () => {
    const preview = await previewBackupImport('a', parse(backup()), database);
    await expect(importBackupNotes(preview, [], writable, database)).rejects.toMatchObject({
      code: 'selection',
    });
    await expect(importBackupNotes(preview, [999], writable, database)).rejects.toMatchObject({
      code: 'selection',
    });
    preview.rows[0]!.document.markdown = 'Changed after preview';
    await expect(importBackupNotes(preview, [0], writable, database)).rejects.toMatchObject({
      code: 'selection',
    });
    expect(await database.notes.count()).toBe(0);
  });

  it('restores selected trash and supplies a syncable title for an empty-title draft', async () => {
    const doc = document({ title: '', archived: true });
    doc.meta.trashedAt = '2026-09-01T00:00:00Z';
    const preview = await previewBackupImport('a', parse(backup([doc, document()])), database);
    await importBackupNotes(preview, [0], writable, database);
    const restored = (await database.notes.toArray())[0]!;
    expect(restored.current.title).toBe('Untitled note');
    expect(restored.current.meta.trashedAt).toBe(doc.meta.trashedAt);
    expect(restored.current.archived).toBe(true);
    expect(await database.notes.count()).toBe(1);
  });
});
