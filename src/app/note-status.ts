import type { LocalNote, SyncStatus } from '../domain/types';
import type { WorkspaceNotice } from './WorkspaceStatus';

type UnsyncedStatus = Exclude<SyncStatus, 'synced'>;
type StatusConfig = {
  severity: WorkspaceNotice['severity'];
  recovery?: 'connect' | 'review';
};

const statusConfig: Record<UnsyncedStatus, StatusConfig> = {
  'local-draft': { severity: 'info', recovery: 'review' },
  pending: { severity: 'info', recovery: 'review' },
  syncing: { severity: 'progress' },
  offline: { severity: 'warning', recovery: 'review' },
  'auth-required': { severity: 'error', recovery: 'connect' },
  'rate-limited': { severity: 'warning', recovery: 'review' },
  conflict: { severity: 'error', recovery: 'review' },
  uncertain: { severity: 'warning', recovery: 'review' },
  error: { severity: 'error', recovery: 'review' },
};

export function summarizeNoteStatuses(notes: readonly LocalNote[]) {
  const groups = new Map<UnsyncedStatus, LocalNote[]>();
  for (const note of notes) {
    if (note.syncStatus === 'synced') continue;
    const group = groups.get(note.syncStatus) ?? [];
    group.push(note);
    groups.set(note.syncStatus, group);
  }
  return [...groups].map(([status, group]) => {
    const retryTimes = group.map((note) => Date.parse(note.error?.retryAt ?? '')).filter(Number.isFinite);
    return {
      status,
      ...statusConfig[status],
      notes: group,
      count: group.length,
      retryAt:
        status === 'rate-limited' && retryTimes.length
          ? new Date(Math.max(...retryTimes)).toISOString()
          : undefined,
    };
  });
}
