import { describe, expect, it } from 'vitest';
import {
  classify,
  newMetadata,
  parseNoteBody,
  serializeNoteBody,
  snapshotToDocument,
  validateDocument,
} from '../src/domain/codec';
import { defaultFilters, filterNotes, labelCounts, sidebarLabels } from '../src/domain/filters';
import {
  checkVisualSupport,
  isSimpleChecklist,
  parseChecklist,
  toggleChecklistItem,
} from '../src/domain/markdown';
import { mergeThreeWay } from '../src/domain/merge';
import type { Label, LocalNote, NoteDocument, RawIssueSnapshot } from '../src/domain/types';
import { safeHref, parseRepository } from '../src/security/urls';

const fixedMeta = { ...newMetadata(), id: '16f66da6-2d3a-4f05-a21b-144808bd63b9' };
const document = (patch: Partial<NoteDocument> = {}): NoteDocument => ({
  title: 'Title',
  markdown: 'Original body',
  archived: false,
  labelIds: [],
  meta: { ...fixedMeta },
  ...patch,
});
const label = (id: number, name = `Label ${id}`): Label => ({ id, name, color: 'abcdef', description: null });
const snapshot = (doc = document(), patch: Partial<RawIssueSnapshot> = {}): RawIssueSnapshot => ({
  id: 101,
  nodeId: 'I_101',
  number: 1,
  url: 'https://github.com/owner/repo/issues/1',
  title: doc.title,
  body: serializeNoteBody(doc.meta, doc.markdown),
  state: doc.archived ? 'closed' : 'open',
  stateReason: null,
  labels: doc.labelIds.map((id) => label(id)),
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-09-15T08:00:00Z',
  ...patch,
});
const note = (id: string, doc = document(), patch: Partial<LocalNote> = {}): LocalNote => ({
  scopeId: 'github.com:1:2',
  localId: id,
  current: doc,
  base: snapshot(doc),
  lastSeenRemote: null,
  localRevision: 1,
  localCreatedAt: '2026-09-01T08:00:00Z',
  localModifiedAt: '2026-09-16T08:00:00Z',
  syncStatus: 'synced',
  ...patch,
});

describe('metadata protocol', () => {
  it('retains the exact user Markdown when changing metadata only', () => {
    const raw = '\n# Heading\r\n\r\n*  odd   spacing\r\n\r\n```html\r\n<!-- example -->\r\n```\r\n';
    const parsed = parseNoteBody(serializeNoteBody(fixedMeta, raw));
    expect(parsed.status).toBe('managed');
    if (parsed.status !== 'managed') throw Error('Expected metadata');
    const updated = parseNoteBody(serializeNoteBody({ ...parsed.meta, color: 'green' }, parsed.markdown));
    expect(updated.markdown).toBe(raw);
  });
  it('preserves unknown keys safely, including prototype names and nested objects', () => {
    const extra = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"prototype":{"bad":true}},"custom":{"nested":[1,"safe"]}}',
    ) as Record<string, unknown>;
    const parsed = parseNoteBody(serializeNoteBody({ ...fixedMeta, ...extra }, 'x'));
    if (parsed.status !== 'managed') throw Error('Expected metadata');
    expect(Object.getPrototypeOf(parsed.meta)).toBeNull();
    expect(parsed.meta.__proto__).toEqual({ polluted: true });
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(parseNoteBody(serializeNoteBody(parsed.meta, parsed.markdown))).toEqual(parsed);
  });
  it('escapes comment delimiters in extension strings', () => {
    const body = serializeNoteBody({ ...fixedMeta, extension: '--><script>alert(1)</script><!--' }, 'safe');
    expect(body.match(/-->/gu)).toHaveLength(1);
    expect(body).toContain('\\u003e');
    const parsed = parseNoteBody(body);
    expect(parsed.status === 'managed' && parsed.meta.extension).toBe('--><script>alert(1)</script><!--');
  });
  it('handles deeply nested extension JSON without recursive prototype copying', () => {
    const nested = '['.repeat(2500) + '0' + ']'.repeat(2500);
    const json = JSON.stringify(fixedMeta).slice(0, -1) + `,"extension":${nested}}`;
    const parsed = parseNoteBody(`<!-- issue-notes\n${json}\n-->\n\nbody`);
    expect(parsed.status).toBe('managed');
    expect(parsed.markdown).toBe('body');
  });
  it.each([
    'plain note',
    '```md\n<!-- issue-notes\n{}\n-->\n```',
    '\n<!-- issue-notes\n{}\n-->',
    '<!-- issue-notes-more\n{}\n-->',
  ])('does not adopt a marker outside the exact opening position: %s', (body) => {
    expect(parseNoteBody(body)).toEqual({ status: 'unmanaged', markdown: body });
  });
  it.each([
    '<!-- issue-notes\n{bad}\n-->',
    '<!-- issue-notes\n{}\n-->',
    '<!-- issue-notes\n{"schemaVersion":1}',
    '<!-- issue-notes\n[]\n-->',
    '<!-- issue-notes {} -->',
    '<!-- issue-notes\t{}\n-->',
    '<!-- issue-notes{}-->',
    '<!-- issue-notes-->',
  ])('retains invalid metadata verbatim: %s', (body) => {
    expect(parseNoteBody(body)).toMatchObject({ status: 'invalid', markdown: body });
  });
  it('preserves future versions as read-only and refuses excessive metadata', () => {
    const future = '<!-- issue-notes\n{"schemaVersion":2,"anything":true}\n-->\n\nbody';
    expect(parseNoteBody(future)).toMatchObject({ status: 'unsupported', markdown: future });
    expect(() => serializeNoteBody({ ...fixedMeta, big: '中'.repeat(3000) }, '')).toThrow();
    const excessive = `<!-- issue-notes\n${JSON.stringify({ ...fixedMeta, big: 'x'.repeat(8192) })}\n-->`;
    expect(parseNoteBody(excessive)).toMatchObject({ status: 'invalid', markdown: excessive });
  });
  it('counts Unicode code points, not UTF-16 units', () => {
    expect(() =>
      validateDocument(document({ title: '😀'.repeat(120), markdown: '😀'.repeat(40000) })),
    ).not.toThrow();
    expect(() => validateDocument(document({ title: '😀'.repeat(121) }))).toThrow();
    expect(() => validateDocument(document({ markdown: '😀'.repeat(40001) }))).toThrow();
  });
  it('gives trash precedence and restores the archived state unchanged', () => {
    const archived = document({ archived: true, meta: { ...fixedMeta, trashedAt: '2026-09-16T00:00:00Z' } });
    expect(classify(archived)).toBe('trash');
    expect(classify({ ...archived, meta: { ...archived.meta, trashedAt: null } })).toBe('archive');
    expect(snapshotToDocument(snapshot(document()))).toEqual(document());
    expect(snapshotToDocument(snapshot(document(), { body: 'ordinary issue' }))).toBeNull();
  });
});

describe('field-based three-way merge', () => {
  it('merges local color with remote body and keeps remote unknown fields', () => {
    const base = snapshot();
    const local = document({ meta: { ...fixedMeta, color: 'blue', extension: 'stale' } });
    const remote = snapshot(
      document({ markdown: 'Remote body', meta: { ...fixedMeta, extension: { next: 2 } } }),
    );
    const result = mergeThreeWay(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.document.markdown).toBe('Remote body');
    expect(result.document.meta).toMatchObject({ color: 'blue', extension: { next: 2 } });
  });
  it('conflicts on divergent text, accepts identical edits and ignores comment timestamps', () => {
    expect(
      mergeThreeWay(snapshot(), document({ markdown: 'local' }), snapshot(document({ markdown: 'remote' })))
        .conflicts,
    ).toEqual(['markdown']);
    expect(
      mergeThreeWay(snapshot(), document({ markdown: 'same' }), snapshot(document({ markdown: 'same' })))
        .conflicts,
    ).toEqual([]);
    expect(
      mergeThreeWay(snapshot(), document(), snapshot(document(), { updatedAt: '2026-09-16T11:00:00Z' }))
        .conflicts,
    ).toEqual([]);
  });
  it('preserves external labels while applying only explicit local add/remove intent', () => {
    const merged = mergeThreeWay(
      snapshot(document({ labelIds: [1, 2] })),
      document({ labelIds: [2, 3] }),
      snapshot(document({ labelIds: [1, 2, 4] })),
    );
    expect(merged.document.labelIds.sort()).toEqual([2, 3, 4]);
    expect(merged.conflicts).toEqual([]);
  });
  it('halts when remote metadata becomes invalid or unsupported', () => {
    expect(
      mergeThreeWay(
        snapshot(),
        document(),
        snapshot(document(), { body: '<!-- issue-notes\n{"schemaVersion":2}\n-->' }),
      ).conflicts,
    ).toEqual(['protocol']);
  });
  it('permits explicit duplicate resolution by changing only the local UUID', () => {
    const local = document({ meta: newMetadata() });
    const result = mergeThreeWay(snapshot(), local, snapshot());
    expect(result.conflicts).toEqual([]);
    expect(result.document.meta.id).toBe(local.meta.id);
  });
});

describe('shared note filtering', () => {
  const labels = [label(1, 'Travel'), label(2, 'Ideas')];
  const notes = [
    note('a', document({ title: '中文 Tokyo', labelIds: [1, 2], meta: { ...fixedMeta, color: 'blue' } })),
    note('b', document({ labelIds: [2] })),
    note('c', document({ archived: true })),
    note('d', document({ meta: { ...fixedMeta, trashedAt: '2026-09-16T00:00:00Z' } })),
  ];
  it('ANDs attributes, supports all/any labels, and keeps search words local', () => {
    expect(
      filterNotes(
        notes,
        { ...defaultFilters, query: '中文 travel', labelIds: [1, 2], colors: ['blue'] },
        labels,
      ).map((x) => x.localId),
    ).toEqual(['a']);
    expect(
      filterNotes(notes, { ...defaultFilters, labelIds: [1, 2], labelMatch: 'any' }, labels),
    ).toHaveLength(2);
    expect(
      filterNotes(notes, { ...defaultFilters, unlabeledOnly: true, labelIds: [2], view: 'all' }, labels).map(
        (x) => x.localId,
      ),
    ).toEqual(['c']);
    expect(filterNotes(notes, { ...defaultFilters, query: fixedMeta.id }, labels)).toEqual([]);
  });
  it('counts labels ignoring selected labels but honoring other properties and view', () => {
    expect(labelCounts(notes, { ...defaultFilters, labelIds: [1] }, labels)).toEqual({ 1: 1, 2: 2 });
    expect(labelCounts(notes, { ...defaultFilters, colors: ['blue'] }, labels)).toEqual({ 1: 1, 2: 1 });
    expect(filterNotes(notes, { ...defaultFilters, view: 'all' })).toHaveLength(3);
  });
  it('uses device-local inclusive end dates and local dirty modification time', () => {
    const at = (day: number, hour: number) => new Date(2026, 8, day, hour).toISOString();
    const dated = [
      note('late', document(), { syncStatus: 'pending', localModifiedAt: at(16, 23) }),
      note('next', document(), { syncStatus: 'pending', localModifiedAt: at(17, 0) }),
    ];
    expect(
      filterNotes(dated, { ...defaultFilters, updatedFrom: '2026-09-16', updatedTo: '2026-09-16' }).map(
        (x) => x.localId,
      ),
    ).toEqual(['late']);
    expect(() =>
      filterNotes(dated, { ...defaultFilters, createdFrom: '2026-09-17', createdTo: '2026-09-16' }),
    ).toThrow();
    expect(() => filterNotes(dated, { ...defaultFilters, createdFrom: '2026-02-30' })).toThrow();
  });
  it('pins only in the notes view and uses issue number for equal timestamps', () => {
    const data = [
      note('a', document({ title: 'A' }), { issueNumber: 1 }),
      note('b', document({ title: 'B', meta: { ...fixedMeta, pinned: true } }), { issueNumber: 2 }),
    ];
    expect(filterNotes(data, { ...defaultFilters, sort: 'title' }).map((x) => x.localId)).toEqual(['b', 'a']);
    expect(
      filterNotes(data, { ...defaultFilters, view: 'all', sort: 'title' }).map((x) => x.localId),
    ).toEqual(['a', 'b']);
    expect(filterNotes(data, { ...defaultFilters, view: 'all' }).map((x) => x.localId)).toEqual(['b', 'a']);
  });
});

describe('sidebar labels', () => {
  const repoLabels = [label(1, 'bug'), label(2, 'Ideas'), label(3, 'Archive only'), label(4, 'Trash only')];
  const sidebarNotes = [
    note('used', document({ labelIds: [2] })),
    note('archived', document({ labelIds: [3], archived: true })),
    note('trashed', document({ labelIds: [4], meta: { ...fixedMeta, trashedAt: '2026-09-16T10:00:00Z' } })),
  ];
  it('lists only labels used by at least one non-trashed note', () => {
    expect(sidebarLabels(sidebarNotes, repoLabels).map((item) => item.id)).toEqual([2, 3]);
  });
  it('hides repository labels that no Tebikae note uses, regardless of their names', () => {
    expect(sidebarLabels([], repoLabels)).toEqual([]);
    expect(sidebarLabels(sidebarNotes, repoLabels).some((item) => item.name === 'bug')).toBe(false);
  });
  it('hides labels used only by trashed notes but keeps labels used by archived notes', () => {
    const visible = sidebarLabels(sidebarNotes, repoLabels).map((item) => item.id);
    expect(visible).not.toContain(4);
    expect(visible).toContain(3);
  });
  it('shows a label again once its only trashed note is restored', () => {
    const restored = [...sidebarNotes, note('restored', document({ labelIds: [4] }))];
    expect(sidebarLabels(restored, repoLabels).map((item) => item.id)).toEqual([2, 3, 4]);
  });
  it('keeps the full label set available to filters, search, and editors', () => {
    expect(sidebarLabels(sidebarNotes, repoLabels)).not.toBe(repoLabels);
    expect(repoLabels).toHaveLength(4);
    expect(
      filterNotes(sidebarNotes, { ...defaultFilters, view: 'trash', labelIds: [4] }, repoLabels).map(
        (item) => item.localId,
      ),
    ).toEqual(['trashed']);
    expect(
      filterNotes(sidebarNotes, { ...defaultFilters, view: 'trash', query: 'Trash only' }, repoLabels),
    ).toHaveLength(1);
  });
});

describe('Markdown AST operations and URL policy', () => {
  it('toggles by current AST source position, preserving repeated labels, nested tasks, and code samples', () => {
    const body = '- [ ] same\n  - [x] same\n\n```md\n- [ ] same\n```\n\n- [ ] same\n';
    expect(parseChecklist(body).map((item) => item.checked)).toEqual([false, true, false]);
    expect(toggleChecklistItem(body, 1)).toBe(body.replace('  - [x]', '  - [ ]'));
    expect(toggleChecklistItem(body, 2)).toBe(body.slice(0, -13) + body.slice(-13).replace('[ ]', '[x]'));
    expect(toggleChecklistItem(body, 99)).toBe(body);
  });
  it('recognizes simple nested tasks and changes mixed documents to Markdown', () => {
    expect(isSimpleChecklist('- [ ] a\n  - [x] b\n')).toBe(true);
    expect(isSimpleChecklist('# Heading\n\n- [ ] a')).toBe(false);
    expect(isSimpleChecklist('- plain bullet')).toBe(false);
  });
  it('blocks HTML and extensions while allowing their code examples', () => {
    expect(checkVisualSupport('<script>alert(1)</script>').supported).toBe(false);
    expect(checkVisualSupport('formula $a + b$').supported).toBe(false);
    expect(checkVisualSupport('[^footnote]\n\n[^footnote]: text').supported).toBe(false);
    expect(checkVisualSupport('```html\n<script>alert(1)</script>\n```\n\n`$x$`').supported).toBe(true);
    expect(checkVisualSupport('```ts title="example.ts"\nconst x = 1;\n```').supported).toBe(false);
    expect(checkVisualSupport('---\ntitle: Sample\n---\n\nBody').supported).toBe(false);
    expect(
      checkVisualSupport('| a | b |\n| - | - |\n| c | d |\n\n![alt](https://example.com/a.png)').supported,
    ).toBe(true);
  });
  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,xxx',
    '//attacker.com/path',
    'https://user:password@example.com',
    'java\nscript:alert(1)',
  ])('blocks unsafe URLs %s', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });
  it('accepts safe external URLs and parses only GitHub repository input', () => {
    expect(safeHref('https://example.com/path')).toBe('https://example.com/path');
    expect(safeHref('mailto:user@example.com')).toBe('mailto:user@example.com');
    expect(parseRepository('https://github.com/scarletkc/Tebikae-dev')).toEqual({
      owner: 'scarletkc',
      repo: 'Tebikae-dev',
    });
    expect(() => parseRepository('https://github.com.attacker.com/owner/repo')).toThrow();
    expect(() => parseRepository('https://github.com/owner/repo?token=secret')).toThrow();
  });
});
