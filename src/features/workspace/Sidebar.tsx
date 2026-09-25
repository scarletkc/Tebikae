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
import { Brand, IconButton, PreferencesControls } from '../../app/ui';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { LabelContextMenu } from '../labels/LabelContextMenu';
import { LabelDot } from '../labels';
import { safeHref } from '../../security/urls';
import { useWorkspace } from './useWorkspaceController';
import { Button, cn, iconButtonVariants } from '../../ui';

const NAV_ITEMS = [
  ['notes', NotebookPen],
  ['archive', Archive],
  ['trash', Trash2],
] as const;

/** Navigation, labels and workspace controls; rendered in the desktop sidebar and the mobile drawer. */
export default function Sidebar() {
  const ctl = useWorkspace();
  const { t, session, connection, filters, setFilters, notes, labels, counts, busy, online } = ctl;
  const repositoryName = `${connection.owner}/${connection.repo}`;
  const repositoryUrl = safeHref(`https://github.com/${repositoryName}`);
  return (
    <>
      <div className="sidebar-brand">
        <Brand />
      </div>
      <nav className="main-nav">
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
              <NavLink
                to={`/${name}`}
                onClick={() => {
                  ctl.resetNavigationState();
                }}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={19} />
                <span>{t(`nav.${name}`)}</span>
                {name === 'notes' && (
                  <span className="nav-count">
                    {notes.filter((n) => !n.current.archived && !n.current.meta.trashedAt).length}
                  </span>
                )}
              </NavLink>
            </ContextMenu>
          );
        })}
      </nav>
      <div className="labels-heading">
        <h2>{t('nav.labels')}</h2>
        {ctl.labelSelectionMode ? (
          <Button size="sm" className="label-selection-done ms-auto" onClick={ctl.finishLabelSelection}>
            {t('label.done')}
          </Button>
        ) : (
          <IconButton
            label={t('label.new')}
            disabled={!session.engine || !session.writable}
            onClick={() => ctl.setLabelOpen(true)}
          >
            <Plus size={16} />
          </IconButton>
        )}
      </div>
      <div className="label-nav">
        {!ctl.labelSelectionMode && (
          <>
            <button
              type="button"
              className={`nav-item ${!filters.labelIds.length && !filters.unlabeledOnly ? 'selected' : ''}`}
              aria-pressed={!filters.labelIds.length && !filters.unlabeledOnly}
              onClick={() => {
                setFilters({ ...filters, unlabeledOnly: false, labelIds: [] });
                ctl.showNoteList();
                ctl.setDrawer(false);
              }}
            >
              <Tags size={16} />
              <span>{t('label.all')}</span>
            </button>
            <button
              type="button"
              className={`nav-item ${filters.unlabeledOnly ? 'selected' : ''}`}
              aria-pressed={filters.unlabeledOnly}
              onClick={() => {
                setFilters({ ...filters, unlabeledOnly: true, labelIds: [] });
                ctl.showNoteList();
                if (!filters.unlabeledOnly) ctl.setDrawer(false);
              }}
            >
              <Tag size={15} />
              <span>{t('label.unlabeled')}</span>
            </button>
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
                  className={`label-nav-row ${selected ? 'selected' : ''} ${ctl.labelSelectionMode ? 'selection-mode' : ''}`}
                  onClick={() => {
                    if (ctl.labelSelectionMode) ctl.toggleLabelSelection(label.id);
                  }}
                >
                  <button
                    type="button"
                    className={`nav-item label-main ${selected ? 'selected' : ''}`}
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
                    <span className="label-name" title={label.name}>
                      {label.name}
                    </span>
                  </button>
                  <span className="nav-count label-count">{counts[label.id] || 0}</span>
                  {ctl.labelSelectionMode && (
                    <button
                      type="button"
                      className={cn(iconButtonVariants({ size: 'xs' }), 'label-filter-toggle')}
                      aria-label={t('label.toggleSelection', { name: label.name })}
                      aria-pressed={selected}
                      onClick={(event) => {
                        event.stopPropagation();
                        ctl.toggleLabelSelection(label.id);
                      }}
                    >
                      {selected ? <Check size={16} /> : <Plus size={16} />}
                    </button>
                  )}
                </div>
              </LabelContextMenu>
            );
          })
        ) : (
          <p className="empty-labels">{t('label.empty')}</p>
        )}
      </div>
      <div className="sidebar-bottom">
        <div className="workspace-preferences">
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
              <RefreshCw size={18} className={busy ? 'spin' : ''} />
            </IconButton>
          </ContextMenu>
          <PreferencesControls compact />
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
            <NavLink
              to="/settings"
              onClick={() => ctl.setDrawer(false)}
              title={t('nav.settings')}
              aria-label={t('nav.settings')}
              className={({ isActive }) => cn(iconButtonVariants(), isActive && 'selected')}
            >
              <SettingsIcon size={18} />
            </NavLink>
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
          <button className="repository-pill" onClick={() => ctl.setConnectOpen(true)}>
            <span className={`connection-dot ${session.connected ? 'connected' : ''}`} />
            <span>
              <strong>{connection.repo}</strong>
              <small>{connection.owner}</small>
            </span>
            <ArrowUpRight size={15} />
          </button>
        </ContextMenu>
      </div>
    </>
  );
}
