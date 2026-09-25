import type { TFunction } from 'i18next';
import type { WorkspaceNotice } from '../../app/WorkspaceStatus';
import { summarizeNoteStatuses } from '../../app/note-status';
import type { LocalNote, SyncState } from '../../domain/types';
import type { useSession } from '../../app/session';

type Session = ReturnType<typeof useSession>;

/** Collects every workspace-level status (errors, offline, read-only, sync, loading) for the status menu. */
export function workspaceNotices({
  t,
  session,
  notice,
  clearNotice,
  online,
  sync,
  busy,
  filterError,
  notes,
  reconnect,
  review,
  report,
}: {
  t: TFunction;
  session: Session;
  notice: string;
  clearNotice(): void;
  online: boolean;
  sync: SyncState | undefined;
  busy: boolean;
  filterError: boolean;
  notes: LocalNote[];
  reconnect(): void;
  review(notes: LocalNote[]): void;
  report(error: unknown): void;
}): WorkspaceNotice[] {
  const statusNotices: WorkspaceNotice[] = [];
  const reconnectAction = { label: t('action.connect'), run: reconnect };
  if (notice)
    statusNotices.push({
      id: 'notice',
      severity: 'error',
      message: notice,
      action: { label: t('action.close'), run: clearNotice },
    });
  if (session.notice)
    statusNotices.push({
      id: 'session',
      severity: 'error',
      message: t(`error.${session.notice}`),
      action: reconnectAction,
    });
  if (!online) statusNotices.push({ id: 'offline', severity: 'warning', message: t('home.offline') });
  else if (!session.connected)
    statusNotices.push({
      id: 'disconnected',
      severity: 'warning',
      message: t('home.disconnected'),
      action: reconnectAction,
    });
  if (!session.writable)
    statusNotices.push({
      id: 'readonly',
      severity: 'warning',
      message: t(session.lockState === 'unsupported' ? 'home.unsupportedLock' : 'home.readonly'),
      action:
        session.lockState === 'busy'
          ? { label: t('action.takeLock'), run: () => void session.takeLock().catch(report) }
          : undefined,
    });
  if (sync?.error)
    statusNotices.push({
      id: 'sync',
      severity: 'error',
      message: `${t(`error.${sync.error.code}`)}${sync.error.retryAt ? ` ${t('error.retryAt', { time: new Date(sync.error.retryAt).toLocaleString() })}` : ''}`,
      action: sync.error.code === 'AUTH_REQUIRED' ? reconnectAction : undefined,
    });
  if (sync?.loading || (!sync?.initialPageLoaded && !sync?.initialLoadComplete && session.connected))
    statusNotices.push({
      id: 'loading',
      severity: 'progress',
      message: `${t('home.loading')} ${sync?.loadedCount || 0}`,
    });
  else if (busy)
    statusNotices.push({ id: 'busy', severity: 'progress', message: t('workspaceStatus.working') });
  if (filterError)
    statusNotices.push({ id: 'filter', severity: 'error', message: t('error.VALIDATION_FAILED') });
  for (const group of summarizeNoteStatuses(notes)) {
    statusNotices.push({
      id: `notes-${group.status}`,
      severity: group.severity,
      message: `${t('workspaceStatus.notes', { count: group.count, status: t(`status.${group.status}`) })}${group.retryAt ? ` ${t('error.retryAt', { time: new Date(group.retryAt).toLocaleString() })}` : ''}`,
      action:
        group.recovery === 'connect'
          ? reconnectAction
          : group.recovery === 'review'
            ? { label: t('workspaceStatus.reviewNotes'), run: () => review(group.notes) }
            : undefined,
    });
  }
  return statusNotices;
}
