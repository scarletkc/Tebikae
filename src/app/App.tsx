import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Archive,
  ArrowUpRight,
  FileText,
  GitBranch,
  Grid2X2,
  List,
  Menu,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Settings as SettingsIcon,
  SlidersHorizontal,
  Tag,
  Tags,
  Trash2,
  X,
} from 'lucide-react';
import { registerSW } from 'virtual:pwa-register';
import { useSession, flushAllDrafts } from './session';
import { usePreferences } from './preferences';
import { PwaUpdateContext, clearAppCaches, reloadFresh } from './pwa';
import { Brand, IconButton, Modal, PreferencesControls, download } from './ui';
import { db } from '../storage/db';
import { defaultFilters, filterNotes, labelCounts, sidebarLabels } from '../domain/filters';
import WorkspaceStatus, { type WorkspaceNotice } from './WorkspaceStatus';
import type { LocalNote, NoteDocument, NoteFilters, NoteKind, UnmanagedIssue } from '../domain/types';
import { ContextMenu, type MenuAction } from './ContextMenu';
import { useNoteSelection } from '../features/notes/useNoteSelection';
import { noteActions, canEditNote } from '../features/notes/actions';
import { LabelContextMenu } from '../features/labels/LabelContextMenu';
import { summarizeNoteStatuses } from './note-status';
import { convertIssue, saveEditedNote } from '../application/commands';
import { ApiError } from '../adapters/github/client';
import { safeHref } from '../security/urls';
import ConnectPage, { ConnectForm } from '../features/connect/Connect';
import NoteCard from '../features/notes/NoteCard';
import { LabelDot } from '../features/labels';
import NotesGrid from '../features/notes/NotesGrid';
import NoteDialog from '../features/notes/NoteDialog';
import { FilterChips, FiltersDialog, filterCount } from '../features/filters/Filters';
import Settings from '../features/settings/Settings';
import MarkdownPreview from '../features/editor/MarkdownPreview';

function restoreFilters(scope: string): NoteFilters {
  try {
    const raw = JSON.parse(
      sessionStorage.getItem(`tebikae.filters.${scope}`) || 'null',
    ) as Partial<NoteFilters> | null;
    if (raw && Array.isArray(raw.labelIds) && Array.isArray(raw.colors) && Array.isArray(raw.kinds))
      return { ...defaultFilters, ...raw };
  } catch {
    /* Invalid preferences do not block access to drafts. */
  }
  return structuredClone(defaultFilters);
}
export default function App() {
  const session = useSession();
  const { t } = useTranslation();
  const [offlineReady, setOfflineReady] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const update = useRef<(reload?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let active = true;
    update.current = registerSW({
      onOfflineReady: () => setOfflineReady(true),
      onNeedRefresh: () => setUpdateReady(true),
    });
    if (import.meta.env.PROD && 'serviceWorker' in navigator && 'caches' in window) {
      void navigator.serviceWorker.ready
        .then(async () => {
          const base = new URL(import.meta.env.BASE_URL, location.href).pathname;
          const keys = await caches.keys();
          const requests = (
            await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()))
          ).flat();
          const paths = requests
            .map((request) => new URL(request.url).pathname)
            .filter((path) => path.startsWith(base));
          const cached =
            paths.includes(`${base}index.html`) &&
            paths.includes(`${base}theme.js`) &&
            paths.some((path) => path.includes('/assets/MarkdownEditor-') && path.endsWith('.js')) &&
            paths.some((path) => path.includes('/assets/index-') && path.endsWith('.js'));
          if (active && cached) setOfflineReady(true);
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, []);
  const applyUpdate = async () => {
    await flushAllDrafts();
    session.engine?.stop();
    await update.current(true);
  };
  const forceUpdate = async () => {
    await flushAllDrafts();
    session.engine?.stop();
    await clearAppCaches();
    reloadFresh();
  };
  return (
    <PwaUpdateContext.Provider value={{ available: updateReady, update: applyUpdate, forceUpdate }}>
      {session.restoring ? (
        <main className="loading-notice" role="status">
          {t('connect.restoring')}
        </main>
      ) : session.connection ? (
        <Workspace key={session.connection.scopeId} offlineReady={offlineReady} />
      ) : (
        <ConnectPage />
      )}
      {updateReady && (
        <div className="update-toast" role="status">
          <span>{t('settings.update')}</span>
          <button className="button primary" onClick={() => void applyUpdate().catch(() => {})}>
            {t('settings.updateAction')}
          </button>
          <IconButton label={t('action.close')} onClick={() => setUpdateReady(false)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
    </PwaUpdateContext.Provider>
  );
}
function Workspace({ offlineReady }: { offlineReady: boolean }) {
  const { t } = useTranslation();
  const session = useSession();
  const prefs = usePreferences();
  const connection = session.connection!;
  const scope = connection.scopeId;
  const location = useLocation();
  const navigate = useNavigate();
  const route = location.pathname.slice(1) || 'notes';
  const view = (
    ['notes', 'all', 'archive', 'trash'].includes(route) ? route : 'notes'
  ) as NoteFilters['view'];
  const [filters, updateFilters] = useState<NoteFilters>(() => restoreFilters(scope));
  const activeFilters = useMemo(() => ({ ...filters, view }), [filters, view]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [labelColor, setLabelColor] = useState('#62836a');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [limit, setLimit] = useState(100);
  const [online, setOnline] = useState(navigator.onLine);
  const [selection, setSelection] = useState<{
    id?: string;
    kind?: NoteKind;
    ids: string[];
    initial?: LocalNote;
    labelIds?: number[];
  } | null>(null);
  const [issue, setIssue] = useState<UnmanagedIssue | null>(null);
  const notes = useLiveQuery(() => db.notes.where('scopeId').equals(scope).toArray(), [scope], []);
  const labels = useLiveQuery(() => db.labels.where('scopeId').equals(scope).toArray(), [scope], []);
  const issues = useLiveQuery(() => db.unmanagedIssues.where('scopeId').equals(scope).toArray(), [scope], []);
  const sync = useLiveQuery(() => db.syncState.get(scope), [scope]);
  const result = useMemo(() => {
    try {
      return { notes: filterNotes(notes, activeFilters, labels), error: false };
    } catch {
      return { notes: [], error: true };
    }
  }, [notes, activeFilters, labels]);
  const multi = useNoteSelection(result.notes.map((note) => note.localId));
  const selectedNotes = result.notes.filter((note) => multi.isSelected(note.localId));
  async function mutateNotes(targets: LocalNote[], edit: (doc: NoteDocument) => void) {
    if (!session.writable || targets.some((note) => !canEditNote(note))) return;
    try {
      await db.transaction('rw', db.notes, db.outbox, db.recovery, async () => {
        for (const note of targets) {
          const fresh = await db.notes.get([scope, note.localId]);
          if (!fresh) continue;
          const next = structuredClone(fresh.current);
          edit(next);
          await saveEditedNote(scope, note.localId, fresh.current, next);
        }
      });
      void session.engine?.flush(false).catch(report);
    } catch (error) {
      report(error);
    }
  }
  function menuFor(note: LocalNote): MenuAction[] {
    const targets = multi.isSelected(note.localId) ? selectedNotes : [note];
    const actions = noteActions(
      targets,
      labels,
      session.writable,
      t,
      (edit) => void mutateNotes(targets, edit),
    );
    if (note.current.meta.trashedAt)
      return [
        ...actions,
        {
          label: t('action.deleteForever'),
          danger: true,
          separator: true,
          disabled: targets.length > 1 || !session.writable || !session.engine || !online || busy,
          run: () => void purge(note),
        },
      ];
    if (targets.length > 1) return actions;
    const trash = actions.pop()!;
    return [
      { label: t('action.edit'), run: () => openNote(note) },
      ...actions,
      {
        label: t('context.copyContent'),
        separator: true,
        run: () => void navigator.clipboard.writeText(note.current.markdown).catch(report),
      },
      ...(safeHref(note.base?.url ?? '')
        ? [
            {
              label: t('context.copyNoteLink'),
              run: () => void navigator.clipboard.writeText(note.base!.url).catch(report),
            },
          ]
        : []),
      { label: t('context.select'), run: () => multi.select(note.localId) },
      trash,
    ];
  }
  const counts = useMemo(() => {
    try {
      return labelCounts(notes, activeFilters, labels);
    } catch {
      return {};
    }
  }, [notes, activeFilters, labels]);
  const sidebarLabelList = useMemo(() => sidebarLabels(notes, labels), [notes, labels]);
  function setFilters(next: NoteFilters) {
    multi.clear();
    updateFilters(next);
    setLimit(100);
    try {
      sessionStorage.setItem(`tebikae.filters.${scope}`, JSON.stringify(next));
    } catch {
      /* Preferences are optional. */
    }
  }
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  function newNote() {
    setSelection({
      kind: 'markdown',
      ids: [],
      labelIds: filters.unlabeledOnly
        ? []
        : [...new Set(filters.labelIds)].filter((id) => labels.some((label) => label.id === id)),
    });
  }
  function report(error: unknown) {
    setNotice(error instanceof ApiError ? t(`error.${error.code}`) : t('error.generic'));
  }
  async function purge(note: LocalNote) {
    if (!session.writable || !session.engine || !online || busy || !confirm(t('note.deleteConfirm'))) return;
    setBusy(true);
    try {
      await session.engine.destroy(note.localId);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    setBusy(true);
    try {
      await session.engine?.pull();
      await session.engine?.flush(true);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function change(note: LocalNote, action: 'pin' | 'archive' | 'trash' | 'restore') {
    await mutateNotes([note], (current) => {
      if (action === 'pin') current.meta.pinned = !current.meta.pinned;
      else if (action === 'archive') current.archived = !current.archived;
      else current.meta.trashedAt = action === 'trash' ? new Date().toISOString() : null;
    });
  }
  function openNote(note: LocalNote) {
    session.engine?.setEditing(note.localId, true);
    setSelection({ id: note.localId, ids: result.notes.map((n) => n.localId), initial: note });
  }
  function navigateNote(direction: -1 | 1) {
    if (!selection) return;
    const index = selection.ids.indexOf(selection.id!) + direction;
    const next = notes.find((note) => note.localId === selection.ids[index]);
    if (next) openWithSequence(next);
  }
  function openWithSequence(note: LocalNote) {
    session.engine?.setEditing(note.localId, true);
    setSelection((old) => ({ id: note.localId, ids: old?.ids || [], initial: note }));
  }
  async function createLabel() {
    if (!session.engine || !labelName.trim()) return;
    setBusy(true);
    try {
      await session.engine.createLabel(labelName.trim(), labelColor.slice(1));
      setLabelName('');
      setLabelOpen(false);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  const statusNotices: WorkspaceNotice[] = [];
  const reconnect = { label: t('action.connect'), run: () => setConnectOpen(true) };
  if (notice)
    statusNotices.push({
      id: 'notice',
      severity: 'error',
      message: notice,
      action: { label: t('action.close'), run: () => setNotice('') },
    });
  if (session.notice)
    statusNotices.push({
      id: 'session',
      severity: 'error',
      message: t(`error.${session.notice}`),
      action: reconnect,
    });
  if (!online) statusNotices.push({ id: 'offline', severity: 'warning', message: t('home.offline') });
  else if (!session.connected)
    statusNotices.push({
      id: 'disconnected',
      severity: 'warning',
      message: t('home.disconnected'),
      action: reconnect,
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
      action: sync.error.code === 'AUTH_REQUIRED' ? reconnect : undefined,
    });
  if (sync?.loading || (!sync?.initialLoadComplete && session.connected))
    statusNotices.push({
      id: 'loading',
      severity: 'progress',
      message: `${t('home.loading')} ${sync?.loadedCount || 0}`,
    });
  else if (busy)
    statusNotices.push({ id: 'busy', severity: 'progress', message: t('workspaceStatus.working') });
  if (result.error)
    statusNotices.push({ id: 'filter', severity: 'error', message: t('error.VALIDATION_FAILED') });
  for (const group of summarizeNoteStatuses(notes)) {
    statusNotices.push({
      id: `notes-${group.status}`,
      severity: group.severity,
      message: `${t('workspaceStatus.notes', { count: group.count, status: t(`status.${group.status}`) })}${group.retryAt ? ` ${t('error.retryAt', { time: new Date(group.retryAt).toLocaleString() })}` : ''}`,
      action:
        group.recovery === 'connect'
          ? reconnect
          : group.recovery === 'review'
            ? {
                label: t('workspaceStatus.reviewNotes'),
                run: () => {
                  const note = group.notes[0]!;
                  session.engine?.setEditing(note.localId, true);
                  setSelection({
                    id: note.localId,
                    ids: group.notes.map((item) => item.localId),
                    initial: note,
                  });
                },
              }
            : undefined,
    });
  }
  const statusControl = (
    <WorkspaceStatus
      notices={statusNotices}
      count={
        route === 'settings'
          ? undefined
          : route === 'issues'
            ? issues.filter((row) =>
                `${row.snapshot.title}\n${row.snapshot.body}\n${row.snapshot.labels.map((label) => label.name).join(' ')}`
                  .toLowerCase()
                  .includes(filters.query.toLowerCase()),
              ).length
            : result.notes.length
      }
    />
  );
  const navItems = [
    ['notes', NotebookPen],
    ['archive', Archive],
    ['trash', Trash2],
  ] as const;
  const nav = (
    <>
      <div className="sidebar-brand">
        <Brand />
      </div>
      <nav className="main-nav">
        {navItems.map(([name, Icon]) => (
          <NavLink
            key={name}
            to={`/${name}`}
            onClick={() => {
              multi.clear();
              setDrawer(false);
              setLimit(100);
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
        ))}
      </nav>
      <div className="labels-heading">
        <h2>{t('nav.labels')}</h2>
        <IconButton
          label={t('label.new')}
          disabled={!session.engine || !session.writable}
          onClick={() => setLabelOpen(true)}
        >
          <Plus size={16} />
        </IconButton>
      </div>
      <div className="label-nav">
        <button
          type="button"
          className={`nav-item ${!filters.labelIds.length && !filters.unlabeledOnly ? 'selected' : ''}`}
          aria-pressed={!filters.labelIds.length && !filters.unlabeledOnly}
          onClick={() => {
            setFilters({ ...filters, unlabeledOnly: false, labelIds: [] });
            if (route === 'settings' || route === 'issues') navigate('/notes');
            setDrawer(false);
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
            if (route === 'settings' || route === 'issues') navigate('/notes');
            if (!filters.unlabeledOnly) setDrawer(false);
          }}
        >
          <Tag size={15} />
          <span>{t('label.unlabeled')}</span>
        </button>
        {labels.length ? (
          sidebarLabelList.map((label) => {
            const selected = filters.labelIds.includes(label.id);
            return (
              <LabelContextMenu key={label.id} label={label}>
                <div className={`label-nav-row ${selected ? 'selected' : ''}`}>
                  <button
                    type="button"
                    className={`nav-item label-main ${selected ? 'selected' : ''}`}
                    aria-label={`${label.name} ${counts[label.id] || 0}`}
                    aria-pressed={selected}
                    onClick={(event) => {
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
                      if (route === 'settings' || route === 'issues') navigate('/notes');
                      setDrawer(false);
                    }}
                  >
                    <LabelDot color={label.color} />
                    <span className="label-name" title={label.name}>
                      {label.name}
                    </span>
                  </button>
                  <span className="nav-count label-count">{counts[label.id] || 0}</span>
                  <button
                    className="icon-button label-filter-toggle"
                    aria-label={t('context.toggleFilter', { name: label.name })}
                    aria-pressed={selected}
                    onClick={() => {
                      setFilters({
                        ...filters,
                        unlabeledOnly: false,
                        labelMatch: 'all',
                        labelIds: selected
                          ? filters.labelIds.filter((id) => id !== label.id)
                          : [...filters.labelIds, label.id],
                      });
                      if (route === 'settings' || route === 'issues') navigate('/notes');
                    }}
                  >
                    {selected ? '✓' : '＋'}
                  </button>
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
          <IconButton
            label={t('action.refresh')}
            disabled={!session.engine || busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={18} className={busy ? 'spin' : ''} />
          </IconButton>
          <PreferencesControls compact />
          <NavLink
            to="/settings"
            onClick={() => setDrawer(false)}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
            className={({ isActive }) => `icon-button ${isActive ? 'selected' : ''}`}
          >
            <SettingsIcon size={18} />
          </NavLink>
        </div>
        <button className="repository-pill" onClick={() => setConnectOpen(true)}>
          <span className={`connection-dot ${session.connected ? 'connected' : ''}`} />
          <span>
            <strong>{connection.repo}</strong>
            <small>{connection.owner}</small>
          </span>
          <ArrowUpRight size={15} />
        </button>
      </div>
    </>
  );
  const empty = !result.notes.length;
  const resultNotes = result.notes.slice(0, limit);
  const pinned = view === 'notes' ? resultNotes.filter((n) => n.current.meta.pinned) : [];
  const others = view === 'notes' ? resultNotes.filter((n) => !n.current.meta.pinned) : resultNotes;
  const renderCards = (items: LocalNote[]) => (
    <NotesGrid list={prefs.layout === 'list'}>
      {items.map((note) => (
        <NoteCard
          key={note.localId}
          note={note}
          labels={labels}
          query={filters.query}
          writable={session.writable}
          canPurge={session.writable && !!session.engine && online && !busy}
          onPurge={() => void purge(note)}
          onOpen={() => openNote(note)}
          onChange={(action) => void change(note, action)}
          menuItems={menuFor(note)}
          selected={multi.isSelected(note.localId)}
          onSelect={(event) => {
            if (event.shiftKey) {
              multi.selectRange(note.localId);
              return true;
            }
            if (event.ctrlKey || event.metaKey || multi.selectedCount) {
              multi.toggle(note.localId);
              return true;
            }
            return false;
          }}
          onRemoveLabel={(id) =>
            void mutateNotes([note], (d) => {
              d.labelIds = d.labelIds.filter((value) => value !== id);
            })
          }
        />
      ))}
    </NotesGrid>
  );
  return (
    <div className="workspace">
      <aside className="sidebar">{nav}</aside>
      <Dialog.Root open={drawer} onOpenChange={setDrawer}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="mobile-drawer" aria-describedby={undefined}>
            <Dialog.Title className="sr-only">{t('nav.menu')}</Dialog.Title>
            <IconButton label={t('nav.close')} className="drawer-close" onClick={() => setDrawer(false)}>
              <X size={20} />
            </IconButton>
            {nav}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <div className="workspace-body">
        <header className="app-topbar">
          <IconButton className="mobile-menu" label={t('nav.menu')} onClick={() => setDrawer(true)}>
            <Menu size={21} />
          </IconButton>
          <div className="search-box">
            <Search size={19} />
            <input
              aria-label={t('home.search')}
              placeholder={t('home.search')}
              value={filters.query}
              onChange={(e) => setFilters({ ...filters, query: e.target.value })}
            />
            {route !== 'settings' && route !== 'issues' && (
              <IconButton
                label={t('action.filter')}
                className={`filter-open-button ${filterCount(filters) ? 'is-active' : ''}`}
                onClick={() => setFiltersOpen(true)}
              >
                <SlidersHorizontal size={16} />
              </IconButton>
            )}
            {(filters.query || filterCount(filters) > 0) && (
              <IconButton
                label={t('action.clearSearchFilters')}
                className="search-clear-button"
                onClick={() => {
                  setFilters({ ...defaultFilters, view, sort: filters.sort });
                }}
              >
                <X size={15} />
              </IconButton>
            )}
          </div>
          {route !== 'settings' && route !== 'issues' && (
            <div className="topbar-note-actions">
              <select
                aria-label={t('filter.sort')}
                value={filters.sort}
                onChange={(e) => setFilters({ ...filters, sort: e.target.value as NoteFilters['sort'] })}
              >
                {(['updated-desc', 'updated-asc', 'created-desc', 'title'] as const).map((sort) => (
                  <option key={sort} value={sort}>
                    {t(`filter.${sort}`)}
                  </option>
                ))}
              </select>
              <span className="view-toggle">
                <IconButton
                  className={prefs.layout === 'grid' ? 'selected' : ''}
                  label={t('action.grid')}
                  onClick={() => prefs.setLayout('grid')}
                >
                  <Grid2X2 size={17} />
                </IconButton>
                <IconButton
                  className={prefs.layout === 'list' ? 'selected' : ''}
                  label={t('action.list')}
                  onClick={() => prefs.setLayout('list')}
                >
                  <List size={18} />
                </IconButton>
              </span>
              {statusControl}
              {route !== 'trash' && view !== 'archive' && (
                <button
                  className="button primary new-note-button"
                  disabled={!session.writable}
                  onClick={newNote}
                >
                  <Plus size={18} />
                  {t('action.new')}
                </button>
              )}
            </div>
          )}
          {(route === 'settings' || route === 'issues') && statusControl}
        </header>
        <ContextMenu
          items={
            route !== 'settings' && route !== 'issues'
              ? [{ label: t('action.new'), disabled: !session.writable, run: newNote }]
              : []
          }
          acceptTarget={(target) =>
            target instanceof Element &&
            !target.closest(
              '.context-card, button, a, input, textarea, [contenteditable], [role="menu"], .selection-toolbar',
            )
          }
        >
          <main
            className="main-content"
            tabIndex={-1}
            onKeyDown={(event) => {
              if (
                (event.target as Element).closest('input, textarea, [contenteditable="true"], [role="menu"]')
              )
                return;
              if (event.key === 'Escape') multi.clear();
              if (
                (event.ctrlKey || event.metaKey) &&
                event.key.toLowerCase() === 'a' &&
                route !== 'settings' &&
                route !== 'issues'
              ) {
                event.preventDefault();
                multi.selectAll();
              }
            }}
          >
            {!!multi.selectedCount && (
              <div className="selection-toolbar" role="toolbar" aria-label={t('context.selection')}>
                <button className="icon-button" aria-label={t('action.close')} onClick={multi.clear}>
                  ×
                </button>
                <strong>{t('context.selectedCount', { count: multi.selectedCount })}</strong>
                <button className="button secondary" onClick={multi.selectAll}>
                  {t('context.selectAll')}
                </button>
                {noteActions(
                  selectedNotes,
                  labels,
                  session.writable,
                  t,
                  (edit) => void mutateNotes(selectedNotes, edit),
                ).map((action) =>
                  action.children ? (
                    <ContextMenu
                      key={action.label}
                      triggerLabel={action.label}
                      items={action.children.map((child) => ({
                        ...child,
                        disabled: action.disabled || child.disabled,
                      }))}
                    >
                      <span />
                    </ContextMenu>
                  ) : (
                    <button
                      key={action.label}
                      className={`button secondary ${action.danger ? 'danger' : ''}`}
                      disabled={action.disabled}
                      onClick={action.run}
                    >
                      {action.label}
                    </button>
                  ),
                )}
              </div>
            )}
            {route === 'settings' ? (
              <Settings onConnect={() => setConnectOpen(true)} offlineReady={offlineReady} />
            ) : (
              <>
                <h1 className="sr-only">{t(`nav.${route}`)}</h1>
                {route === 'issues' ? (
                  <div className={`notes-grid ${prefs.layout === 'list' ? 'notes-list' : ''}`}>
                    {issues
                      .filter((row) =>
                        `${row.snapshot.title}\n${row.snapshot.body}\n${row.snapshot.labels.map((l) => l.name).join(' ')}`
                          .toLowerCase()
                          .includes(filters.query.toLowerCase()),
                      )
                      .slice(0, limit)
                      .map((row) => (
                        <article key={row.issueId} className="note-card">
                          <button className="note-open" onClick={() => setIssue(row)}>
                            <span className="issue-number">#{row.snapshot.number}</span>
                            <h3>{row.snapshot.title}</h3>
                            <p className="card-preview">{row.snapshot.body.slice(0, 220)}</p>
                            {row.status !== 'unmanaged' && (
                              <p className="danger">{t(`home.${row.status}`)}</p>
                            )}
                          </button>
                        </article>
                      ))}
                    {!issues.length && (
                      <div className="empty-state">
                        <GitBranch size={35} />
                        <h2>{t('home.noResults')}</h2>
                        <p>{t('home.issuesDescription')}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <FilterChips filters={activeFilters} setFilters={setFilters} labels={labels} />
                    {empty ? (
                      <div className="empty-state">
                        <div className="empty-illustration">
                          <NotebookPen size={38} strokeWidth={1.3} />
                        </div>
                        <h2>{t(notes.length ? 'home.noResults' : 'home.empty')}</h2>
                        <p>{t(notes.length ? 'home.noResultsDescription' : 'home.emptyDescription')}</p>
                        {!notes.length && view === 'notes' && (
                          <button className="button secondary" disabled={!session.writable} onClick={newNote}>
                            <Plus size={17} />
                            {t('action.new')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <>
                        {pinned.length > 0 && (
                          <section className="note-group">
                            <h2>{t('home.pinned')}</h2>
                            {renderCards(pinned)}
                          </section>
                        )}
                        {others.length > 0 && (
                          <section className="note-group">
                            {pinned.length > 0 && <h2>{t('home.other')}</h2>}
                            {renderCards(others)}
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}
                {(route === 'issues' ? issues.length : result.notes.length) > limit && (
                  <button className="button secondary load-more" onClick={() => setLimit((n) => n + 100)}>
                    {t('action.more')}
                  </button>
                )}
              </>
            )}
          </main>
        </ContextMenu>
        <footer className="workspace-footer">
          <span>Tebikae</span>
          <span>{t('tagline')}</span>
        </footer>
      </div>
      {filtersOpen && (
        <FiltersDialog
          filters={activeFilters}
          setFilters={setFilters}
          labels={labels}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      {connectOpen && (
        <Modal title={t('action.connect')} onClose={() => setConnectOpen(false)} className="connect-dialog">
          <ConnectForm onConnected={() => setConnectOpen(false)} />
        </Modal>
      )}
      {labelOpen && (
        <Modal title={t('label.new')} onClose={() => setLabelOpen(false)}>
          <form
            className="label-form"
            onSubmit={(e) => {
              e.preventDefault();
              void createLabel();
            }}
          >
            <p>{t('label.createHelp')}</p>
            <label>
              {t('label.name')}
              <input
                autoFocus
                value={labelName}
                maxLength={50}
                required
                onChange={(e) => setLabelName(e.target.value)}
              />
            </label>
            <label>
              {t('label.color')}
              <input type="color" value={labelColor} onChange={(e) => setLabelColor(e.target.value)} />
            </label>
            <button className="button primary" disabled={busy || !session.engine}>
              {t('action.create')}
            </button>
          </form>
        </Modal>
      )}
      {selection && (
        <NoteDialog
          key={selection.id || 'new'}
          initialNote={selection.initial}
          kind={selection.kind}
          labels={labels}
          initialLabelIds={selection.labelIds}
          onClose={() => setSelection(null)}
          onNavigate={navigateNote}
          canPrevious={!!selection.id && selection.ids.indexOf(selection.id) > 0}
          canNext={!!selection.id && selection.ids.indexOf(selection.id) < selection.ids.length - 1}
        />
      )}
      {issue && (
        <Modal title={t('home.readIssue')} onClose={() => setIssue(null)} className="issue-dialog">
          <div className="issue-content">
            <h2>{issue.snapshot.title}</h2>
            {issue.status !== 'unmanaged' && <p className="banner warning">{t(`home.${issue.status}`)}</p>}
            <MarkdownPreview value={issue.snapshot.body} />
            <div className="button-row">
              {issue.status === 'unmanaged' && (
                <button
                  className="button primary"
                  disabled={!session.client || !session.writable}
                  onClick={() =>
                    void convertIssue(connection, issue.issueId, session.client!)
                      .then((note) => {
                        setIssue(null);
                        setSelection({ id: note.localId, initial: note, ids: [] });
                        void session.engine?.flush(true);
                      })
                      .catch(report)
                  }
                >
                  {t('action.convert')}
                </button>
              )}
              <button
                className="button secondary"
                onClick={() => download(`${issue.snapshot.title}.md`, issue.snapshot.body, 'text/markdown')}
              >
                <FileText size={15} />
                {t('action.exportNote')}
              </button>
              {safeHref(issue.snapshot.url) && (
                <a
                  className="button secondary"
                  href={safeHref(issue.snapshot.url)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t('action.openGithub')}
                  <ArrowUpRight size={15} />
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
