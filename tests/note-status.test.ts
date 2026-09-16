import { describe, expect, it } from 'vitest';
import { summarizeNoteStatuses } from '../src/app/note-status';
import type { LocalNote, SyncStatus } from '../src/domain/types';

function note(syncStatus: SyncStatus, localId = syncStatus): LocalNote {
  return {
    scopeId: 'test',
    localId,
    current: {
      title: 'Draft',
      markdown: 'Local content',
      archived: false,
      labelIds: [],
      meta: {
        schemaVersion: 1,
        id: localId,
        kind: 'markdown',
        color: 'default',
        pinned: false,
        trashedAt: null,
      },
    },
    base: null,
    lastSeenRemote: null,
    localRevision: 1,
    localCreatedAt: '2026-09-16T00:00:00Z',
    localModifiedAt: '2026-09-16T00:00:00Z',
    syncStatus,
  };
}

describe('note status summary', () => {
  const expected: Record<Exclude<SyncStatus, 'synced'>, [string, string | undefined]> = {
    'local-draft': ['info', 'review'],
    pending: ['info', 'review'],
    syncing: ['progress', undefined],
    offline: ['warning', 'review'],
    'auth-required': ['error', 'connect'],
    'rate-limited': ['warning', 'review'],
    conflict: ['error', 'review'],
    uncertain: ['warning', 'review'],
    error: ['error', 'review'],
  };
  for (const status of Object.keys(expected) as Array<keyof typeof expected>) {
    it(`includes ${status} with severity and safe recovery`, () => {
      const source = note(status);
      const summary = summarizeNoteStatuses([source, note('synced')]);
      expect(summary[0]?.recovery).toBe(expected[status][1]);
      expect(summary).toEqual([
        expect.objectContaining({
          status,
          count: 1,
          severity: expected[status][0],
          notes: [source],
        }),
      ]);
    });
  }
  it('only reports no notifications when there are no unsynced notes', () => {
    expect(summarizeNoteStatuses([])).toEqual([]);
    expect(summarizeNoteStatuses([note('synced')])).toEqual([]);
  });
  it('groups rate limits and exposes the latest valid retry time without mutating notes', () => {
    const notes = [note('rate-limited'), note('rate-limited'), note('rate-limited')];
    notes[0]!.error = { code: 'RATE_LIMITED', retryAt: '2026-09-16T12:00:00Z' };
    notes[1]!.error = { code: 'RATE_LIMITED', retryAt: '2026-09-16T13:00:00Z' };
    notes[2]!.error = { code: 'RATE_LIMITED', retryAt: 'invalid' };
    const original = structuredClone(notes);
    expect(summarizeNoteStatuses(notes)[0]).toMatchObject({ count: 3, retryAt: '2026-09-16T13:00:00.000Z' });
    expect(notes).toEqual(original);
  });
});
