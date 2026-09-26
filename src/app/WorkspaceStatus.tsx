import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Menu, MenuButtonItem, MenuContent, MenuLabel, MenuTrigger, cn } from '../ui';

export interface WorkspaceNotice {
  id: string;
  severity: 'error' | 'warning' | 'progress' | 'info';
  message: string;
  action?: { label: string; run(): void };
}
const priorities = { error: 3, warning: 2, progress: 1, info: 0 };

/** Trigger tint for the most severe notice ('normal' when there is none). */
const triggerTone = {
  normal: 'text-accent',
  error: 'border-danger bg-danger-soft text-danger hover:bg-danger-soft data-[state=open]:bg-danger-soft',
  warning:
    'border-warning/60 bg-warning-soft text-fg hover:bg-warning-soft data-[state=open]:bg-warning-soft',
  progress: 'bg-accent-soft text-accent hover:bg-accent-soft data-[state=open]:bg-accent-soft',
  info: 'bg-accent-soft text-accent hover:bg-accent-soft data-[state=open]:bg-accent-soft',
} as const;

const entryTone = {
  error: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft',
  progress: 'bg-hover',
  info: 'bg-hover',
} as const;

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
    <Menu>
      <MenuTrigger>
        <Button
          variant="ghost"
          className={cn(
            'workspace-status',
            `status-${severity}`,
            'min-w-13 gap-1.5 px-2.5 tabular-nums',
            triggerTone[severity],
          )}
          aria-label={summary}
          title={summary}
          data-loading={notices.some((notice) => notice.id === 'loading')}
        >
          <Icon
            size={17}
            className={severity === 'progress' ? 'animate-spin motion-reduce:animate-none' : undefined}
          />
          <span>{sorted.length}</span>
          <span className="sr-only" role="status" aria-live="polite">
            {sorted[0]?.message || t('workspaceStatus.ready')}
          </span>
        </Button>
      </MenuTrigger>
      <MenuContent
        panel
        className="workspace-status-menu w-[min(350px,calc(100vw-24px))] max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto p-3.5 leading-relaxed"
        align="end"
        sideOffset={8}
        collisionPadding={12}
      >
        <MenuLabel className="workspace-status-heading p-0 text-sm font-semibold text-fg">
          {t('workspaceStatus.title')}
        </MenuLabel>
        {count !== undefined && (
          <p className="workspace-status-count mt-0.5 mb-3 text-xs text-muted">
            {t('home.count', { count })}
          </p>
        )}
        {!sorted.length && (
          <p className="workspace-status-ready flex items-center gap-2 text-accent">
            <CircleCheck size={16} />
            {t('workspaceStatus.ready')}
          </p>
        )}
        {sorted.map((notice) => (
          <div
            key={notice.id}
            className={cn(
              'workspace-status-entry',
              `status-${notice.severity}`,
              'mt-2 rounded-lg p-2.5 [overflow-wrap:anywhere]',
              entryTone[notice.severity],
            )}
          >
            <p className="m-0">{notice.message}</p>
            {notice.action && (
              <MenuButtonItem className="workspace-status-action mt-2" onSelect={notice.action.run}>
                {notice.action.label}
              </MenuButtonItem>
            )}
          </div>
        ))}
      </MenuContent>
    </Menu>
  );
}
