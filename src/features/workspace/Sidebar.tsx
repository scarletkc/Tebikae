import { NavLink } from 'react-router-dom';
import {
  Archive,
  Check,
  ArrowUpRight,
  Copy,
  FolderOpen,
  NotebookPen,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  Tag,
  Tags,
  Trash2,
} from 'lucide-react';
import { Brand, PreferencesControls } from '../../app/ui';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { LabelContextMenu } from '../labels/LabelContextMenu';
import { LabelDot } from '../labels';
import { safeHref } from '../../security/urls';
import { useWorkspace } from './useWorkspaceController';
import { Button, IconButton, NavItem, cn } from '../../ui';

const NAV_ITEMS = [
  ['notes', NotebookPen],
  ['archive', Archive],
  ['trash', Trash2],
] as const;

/** Navigation, labels and workspace controls; rendered in the desktop sidebar and the mobile drawer. */
export default function Sidebar({ collapsed = false }: { collapsed?: boolean }) {
  const ctl = useWorkspace();
  const { t, session, connection, filters, setFilters, notes, labels, counts, busy, online } = ctl;
  const repositoryName = `${connection.owner}/${connection.repo}`;
  const repositoryUrl = safeHref(`https://github.com/${repositoryName}`);
  const collapsedItem = collapsed && 'justify-center gap-0 px-0';
  // Text collapses to sr-only (not `hidden`) so icon-only links keep accessible names.
  const collapsedText = collapsed && 'sr-only';
  return (
    <>
      <div className={cn('sidebar-brand flex h-14 items-center px-2', collapsed && 'justify-center px-0')}>
        <Brand iconOnly={collapsed} />
      </div>
      <nav className="main-nav flex flex-col gap-1">
        {NAV_ITEMS.map(([name, Icon]) => {
          const items: MenuAction[] = [
            {
              label: t('action.open'),
              icon: FolderOpen,
              run: () => {
                ctl.resetNavigationState();
                ctl.navigate(`/${name}`);
              },
            },
            ...(name === 'notes'
              ? [
                  {
                    label: t('action.new'),
                    icon: Plus,
                    separator: true,
                    disabled: !session.writable,
                    run: () => ctl.newNote(),
                  },
                ]
              : []),
            ...(name === 'trash'
              ? [
                  {
                    label: t('action.clearTrash'),
                    icon: Trash2,
                    separator: true,
                    danger: true,
                    disabled:
                      !notes.some((note) => note.current.meta.trashedAt !== null) ||
                      !session.writable ||
                      !session.engine ||
                      !online ||
                      busy,
                    run: () => void ctl.clearTrash(),
                  },
                ]
              : []),
          ];
          return (
            <ContextMenu key={name} contextName={`navigation-${name}`} items={items}>
              {/* NavLink adds the `active` class and aria-current="page" on the current page. */}
              <NavItem asChild className={cn(collapsedItem)}>
                <NavLink
                  to={`/${name}`}
                  onClick={() => {
                    ctl.resetNavigationState();
                  }}
                >
                  <Icon size={19} />
                  <span className={cn('min-w-0 truncate', collapsedText)}>{t(`nav.${name}`)}</span>
                  {name === 'notes' && (
                    <span className={cn('nav-count ms-auto text-xs text-muted tabular-nums', collapsedText)}>
                      {notes.filter((n) => !n.current.archived && !n.current.meta.trashedAt).length}
                    </span>
                  )}
                </NavLink>
              </NavItem>
            </ContextMenu>
          );
        })}
      </nav>
      <div
        className={cn(
          'labels-heading mx-2 mt-7 mb-1.5 flex items-center justify-start gap-2',
          collapsed && 'mx-0 mt-5 mb-1.5 justify-center',
        )}
      >
        <h2 className={cn('text-xs font-medium text-muted', collapsedText)}>{t('nav.labels')}</h2>
        {ctl.labelSelectionMode ? (
          <Button
            size="sm"
            className={cn('label-selection-done ms-auto', collapsed && 'hidden')}
            onClick={ctl.finishLabelSelection}
          >
            {t('label.done')}
          </Button>
        ) : (
          <IconButton
            label={t('label.new')}
            className="ms-auto"
            disabled={!session.engine || !session.writable}
            onClick={() => ctl.setLabelOpen(true)}
          >
            <Plus size={16} />
          </IconButton>
        )}
      </div>
      <div className="label-nav flex min-h-5 w-full min-w-0 flex-1 flex-col gap-0.5 overflow-x-hidden overflow-y-auto select-none">
        {!ctl.labelSelectionMode && (
          <>
            <NavItem
              size="sm"
              className={cn(!filters.labelIds.length && !filters.unlabeledOnly && 'selected', collapsedItem)}
              aria-pressed={!filters.labelIds.length && !filters.unlabeledOnly}
              onClick={() => {
                setFilters({ ...filters, unlabeledOnly: false, labelIds: [] });
                ctl.showNoteList();
                ctl.setDrawer(false);
              }}
            >
              <Tags size={16} />
              <span className={cn('min-w-0 truncate', collapsedText)}>{t('label.all')}</span>
            </NavItem>
            <NavItem
              size="sm"
              className={cn(filters.unlabeledOnly && 'selected', collapsedItem)}
              aria-pressed={filters.unlabeledOnly}
              onClick={() => {
                setFilters({ ...filters, unlabeledOnly: true, labelIds: [] });
                ctl.showNoteList();
                if (!filters.unlabeledOnly) ctl.setDrawer(false);
              }}
            >
              <Tag size={15} />
              <span className={cn('min-w-0 truncate', collapsedText)}>{t('label.unlabeled')}</span>
            </NavItem>
          </>
        )}
        {labels.length ? (
          ctl.sidebarLabelList.map((label) => {
            const selected = ctl.labelSelectionMode
              ? ctl.selectedLabelIds.includes(label.id)
              : filters.labelIds.includes(label.id);
            return (
              <LabelContextMenu
                key={label.id}
                label={label}
                onSelect={() => ctl.startLabelSelection(label.id)}
                selectionMode={ctl.labelSelectionMode}
                selectedForSelection={selected}
                onToggleSelection={() => ctl.toggleLabelSelection(label.id)}
              >
                <div
                  className={cn(
                    'label-nav-row grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 overflow-hidden rounded-md pe-2 hover:bg-hover',
                    ctl.labelSelectionMode && 'selection-mode grid-cols-[minmax(0,1fr)_auto_auto] pe-0',
                    selected && 'selected bg-active hover:bg-active',
                    collapsed && 'pe-0',
                  )}
                  onClick={() => {
                    if (ctl.labelSelectionMode) ctl.toggleLabelSelection(label.id);
                  }}
                >
                  {/* The row carries the hover and selection color, so the button itself stays clear. */}
                  <NavItem
                    size="sm"
                    className={cn(
                      'label-main overflow-hidden pe-0 hover:bg-transparent active:bg-transparent',
                      selected && 'selected',
                      ctl.labelSelectionMode && 'aria-pressed:bg-transparent aria-pressed:font-normal',
                      collapsedItem,
                    )}
                    aria-label={`${label.name} ${counts[label.id] || 0}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      if (ctl.labelSelectionMode) {
                        event.stopPropagation();
                        ctl.toggleLabelSelection(label.id);
                        return;
                      }
                      setFilters({
                        ...filters,
                        unlabeledOnly: false,
                        labelMatch: 'all',
                        labelIds:
                          event.ctrlKey || event.metaKey
                            ? selected
                              ? filters.labelIds.filter((id) => id !== label.id)
                              : [...filters.labelIds, label.id]
                            : [label.id],
                      });
                      ctl.showNoteList();
                      ctl.setDrawer(false);
                    }}
                  >
                    <LabelDot color={label.color} />
                    <span
                      className={cn('label-name block min-w-0 truncate', collapsedText)}
                      title={label.name}
                    >
                      {label.name}
                    </span>
                  </NavItem>
                  <span
                    className={cn(
                      'nav-count label-count shrink-0 text-xs whitespace-nowrap text-muted tabular-nums',
                      collapsedText,
                    )}
                  >
                    {counts[label.id] || 0}
                  </span>
                  {ctl.labelSelectionMode && (
                    <IconButton
                      size="xs"
                      className="label-filter-toggle justify-self-end pointer-coarse:size-11"
                      label={t('label.toggleSelection', { name: label.name })}
                      pressed={selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        ctl.toggleLabelSelection(label.id);
                      }}
                    >
                      {selected ? <Check size={16} /> : <Plus size={16} />}
                    </IconButton>
                  )}
                </div>
              </LabelContextMenu>
            );
          })
        ) : (
          <p className={cn('empty-labels px-2 py-2 text-xs text-muted', collapsedText)}>{t('label.empty')}</p>
        )}
      </div>
      <div className="sidebar-bottom mt-auto pt-6">
        <div
          className={cn(
            'workspace-preferences mb-3 flex items-center justify-between gap-1',
            collapsed && 'flex-col items-center gap-1.5',
          )}
        >
          <ContextMenu
            contextName="refresh"
            items={[
              {
                label: t('action.refresh'),
                icon: RefreshCw,
                disabled: !session.engine || busy,
                run: () => void ctl.refresh(),
              },
            ]}
          >
            <IconButton
              label={t('action.refresh')}
              disabled={!session.engine || busy}
              onClick={() => void ctl.refresh()}
            >
              <RefreshCw size={18} className={busy ? 'animate-spin motion-reduce:animate-none' : undefined} />
            </IconButton>
          </ContextMenu>
          <PreferencesControls compact className="contents" />
          <ContextMenu
            contextName="settings"
            items={[
              {
                label: t('action.openSettings'),
                icon: SettingsIcon,
                run: () => {
                  ctl.navigate('/settings');
                  ctl.setDrawer(false);
                },
              },
            ]}
          >
            <IconButton asChild label={t('nav.settings')}>
              <NavLink to="/settings" onClick={() => ctl.setDrawer(false)}>
                <SettingsIcon size={18} />
              </NavLink>
            </IconButton>
          </ContextMenu>
        </div>
        <ContextMenu
          contextName="repository"
          items={[
            { label: t('action.reconnect'), icon: RefreshCw, run: () => ctl.setConnectOpen(true) },
            {
              label: t('action.openGithub'),
              icon: ArrowUpRight,
              separator: true,
              disabled: !repositoryUrl,
              run: () => {
                if (repositoryUrl) window.open(repositoryUrl, '_blank', 'noopener,noreferrer');
              },
            },
            {
              label: t('context.copyRepository'),
              icon: Copy,
              run: () => void navigator.clipboard.writeText(repositoryName).catch(ctl.report),
            },
          ]}
        >
          <NavItem
            variant="tile"
            className={cn('repository-pill mt-5', collapsed && 'justify-center p-2.5')}
            onClick={() => ctl.setConnectOpen(true)}
          >
            <span
              className={cn(
                'connection-dot size-2 shrink-0 rounded-full bg-muted',
                session.connected && 'connected bg-accent ring-3 ring-accent-soft',
              )}
            />
            <span className={cn('flex min-w-0 flex-1 flex-col overflow-hidden', collapsedText)}>
              <strong className="truncate text-xs font-medium">{connection.repo}</strong>
              <small className="mt-0.5 text-xs text-muted">{connection.owner}</small>
            </span>
          </NavItem>
        </ContextMenu>
      </div>
    </>
  );
}
