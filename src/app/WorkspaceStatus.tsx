import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './workspace-status.css';

export interface WorkspaceNotice {
  id: string;
  severity: 'error' | 'warning' | 'progress' | 'info';
  message: string;
  action?: { label: string; run(): void };
}
const priorities = { error: 3, warning: 2, progress: 1, info: 0 };
export default function WorkspaceStatus({ notices, count }: { notices: WorkspaceNotice[]; count?: number }) {
  const { t } = useTranslation();
  const unique = new Map<string, WorkspaceNotice>();
  for (const notice of notices) unique.set(`${notice.severity}:${notice.message}`, notice);
  const sorted = [...unique.values()].sort((a, b) => priorities[b.severity] - priorities[a.severity]);
  const severity = sorted[0]?.severity || 'normal';
  const Icon =
    severity === 'error'
      ? CircleAlert
      : severity === 'warning'
        ? TriangleAlert
        : severity === 'progress'
          ? LoaderCircle
          : severity === 'info'
            ? Info
            : CircleCheck;
  const summary = `${t('workspaceStatus.title')}: ${t('workspaceStatus.notifications', { count: sorted.length })}${count === undefined ? '' : `, ${t('home.count', { count })}`}`;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={`button workspace-status status-${severity}`}
          aria-label={summary}
          title={summary}
          data-loading={notices.some((notice) => notice.id === 'loading')}
        >
          <Icon size={17} className={severity === 'progress' ? 'spin' : undefined} />
          <span>{sorted.length}</span>
          <span className="sr-only" role="status" aria-live="polite">
            {sorted[0]?.message || t('workspaceStatus.ready')}
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="workspace-status-menu"
          align="end"
          sideOffset={8}
          collisionPadding={12}
        >
          <DropdownMenu.Label className="workspace-status-heading">
            {t('workspaceStatus.title')}
          </DropdownMenu.Label>
          {count !== undefined && <p className="workspace-status-count">{t('home.count', { count })}</p>}
          {!sorted.length && (
            <p className="workspace-status-ready">
              <CircleCheck size={16} />
              {t('workspaceStatus.ready')}
            </p>
          )}
          {sorted.map((notice) => (
            <div key={notice.id} className={`workspace-status-entry status-${notice.severity}`}>
              <p>{notice.message}</p>
              {notice.action && (
                <DropdownMenu.Item className="workspace-status-action" onSelect={notice.action.run}>
                  {notice.action.label}
                </DropdownMenu.Item>
              )}
            </div>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
