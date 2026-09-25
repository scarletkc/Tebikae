import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { confirmDialog } from '../../app/confirm';
import { db } from '../../storage/db';
import { defaultFilters, filterNotes, labelCounts, sidebarLabels } from '../../domain/filters';
import type { LocalNote, NoteDocument, NoteFilters, NoteKind, UnmanagedIssue } from '../../domain/types';
import { saveEditedNote } from '../../application/commands';
import { ApiError } from '../../adapters/github/client';
import { useNoteSelection } from '../notes/useNoteSelection';
import { canEditNote } from '../notes/actions';
import { useIssueFeed } from '../notes/useIssueFeed';
import { filterIssues, isNoteListRoute, parseRoute } from './routes';
import { useOnline, useWorkspaceLayout } from './useWorkspaceLayout';
import { useInfiniteReveal } from './useInfiniteReveal';
import { useGlobalShortcuts } from './useGlobalShortcuts';
import { workspaceNotices } from './notices';
import { buildNoteMenu } from './noteMenu';

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

export type EditorSelection = {
  id?: string;
  kind?: NoteKind;
  ids: string[];
  initial?: LocalNote;
  labelIds?: number[];
};

/** All workspace state and actions. Rendered components read it through `useWorkspace()`. */
export function useWorkspaceController() {
  const { t } = useTranslation();
  const session = useSession();
  const connection = session.connection!;
  const scope = connection.scopeId;
  const location = useLocation();
  const navigate = useNavigate();
  const { route, view } = parseRoute(location.pathname);
  const { toast } = useToast();
  const layout = useWorkspaceLayout();
  const online = useOnline();
  const searchRef = useRef<HTMLInputElement>(null);

  const [filters, updateFilters] = useState<NoteFilters>(() => restoreFilters(scope));
  const [searchInput, setSearchInput] = useState(filters.query);
  const activeFilters = useMemo(() => ({ ...filters, view }), [filters, view]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const [labelSelectionMode, setLabelSelectionMode] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [drawer, setDrawer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [limit, setLimit] = useState(25);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [issue, setIssue] = useState<UnmanagedIssue | null>(null);

  const notes = useLiveQuery(() => db.notes.where('scopeId').equals(scope).toArray(), [scope], []);
  const labels = useLiveQuery(() => db.labels.where('scopeId').equals(scope).toArray(), [scope], []);
  const issues = useLiveQuery(() => db.unmanagedIssues.where('scopeId').equals(scope).toArray(), [scope], []);
  const sync = useLiveQuery(() => db.syncState.get(scope), [scope]);
  const feed = useIssueFeed(
    session.engine,
    session.client,
    connection,
    filters.query.trim(),
    JSON.stringify(activeFilters),
    online && route !== 'settings',
  );
  const result = useMemo(() => {
    try {
      if (feed.remote && activeFilters.query) {
        const localMatches = new Set(
          filterNotes(
            notes.filter((note) => !note.issueId || note.syncStatus !== 'synced'),
            activeFilters,
            labels,
          ).map((note) => note.localId),
        );
        const candidates = notes.filter(
          (note) => (note.issueId && feed.ids.has(note.issueId)) || localMatches.has(note.localId),
        );
        return { notes: filterNotes(candidates, { ...activeFilters, query: '' }, labels), error: false };
      }
      return { notes: filterNotes(notes, activeFilters, labels), error: false };
    } catch {
      return { notes: [], error: true };
    }
  }, [notes, activeFilters, labels, feed.remote, feed.ids]);
  const visibleIssues = filterIssues(issues, filters.query);
  const availableCount = route === 'issues' ? issues.length : result.notes.length;
  const cachedIds = new Set([...notes.map((note) => note.issueId), ...issues.map((issue) => issue.issueId)]);
  const feedCacheReady = [...feed.ids].every((id) => cachedIds.has(id));
  useInfiniteReveal({
    areaRef: layout.notesAreaRef,
    route,
    query: filters.query,
    feed,
    feedCacheReady,
    availableCount,
    limit,
    setLimit,
  });
  const multi = useNoteSelection(result.notes.map((note) => note.localId));
  const selectedNotes = result.notes.filter((note) => multi.isSelected(note.localId));
  const counts = useMemo(() => {
    try {
      return labelCounts(notes, activeFilters, labels);
    } catch {
      return {};
    }
  }, [notes, activeFilters, labels]);
  const sidebarLabelList = useMemo(() => sidebarLabels(notes, labels), [notes, labels]);
  const canPurge = session.writable && !!session.engine && online && !busy;

  function report(error: unknown) {
    setNotice(error instanceof ApiError ? t(`error.${error.code}`) : t('error.generic'));
  }
  function resetNavigationState() {
    multi.clear();
    setLabelSelectionMode(false);
    setSelectedLabelIds([]);
    setDrawer(false);
    setLimit(25);
  }
  /** Leaves settings/issues for the note list, e.g. after picking a label filter. */
  function showNoteList() {
    if (!isNoteListRoute(route)) navigate('/notes');
  }
  function setFilters(next: NoteFilters) {
    setSearchInput(next.query);
    if (JSON.stringify(next) === JSON.stringify(filters)) return;
    multi.clear();
    updateFilters(next);
    setLimit(25);
    layout.notesAreaRef.current?.scrollTo({ top: 0 });
    try {
      sessionStorage.setItem(`tebikae.filters.${scope}`, JSON.stringify(next));
    } catch {
      /* Preferences are optional. */
    }
  }
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
  function newNote(kind: NoteKind = 'markdown') {
    setSelection({
      kind,
      ids: [],
      labelIds: filters.unlabeledOnly
        ? []
        : [...new Set(filters.labelIds)].filter((id) => labels.some((label) => label.id === id)),
    });
  }
  async function purge(note: LocalNote) {
    if (
      !session.writable ||
      !session.engine ||
      !online ||
      busy ||
      !(await confirmDialog({
        title: t('note.deleteConfirm'),
        confirmLabel: t('action.deleteForever'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    try {
      await session.engine.destroy(note.localId);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function clearTrash() {
    const trashed = notes.filter((note) => note.current.meta.trashedAt !== null);
    if (
      !trashed.length ||
      !session.writable ||
      !session.engine ||
      !online ||
      busy ||
      !(await confirmDialog({
        title: t('context.clearTrashConfirm', { count: trashed.length }),
        confirmLabel: t('action.clearTrash'),
        danger: true,
      }))
    )
      return;
    setBusy(true);
    let firstError: unknown;
    try {
      for (const note of trashed) {
        try {
          await session.engine.destroy(note.localId);
        } catch (error) {
          firstError ??= error;
        }
      }
    } finally {
      setBusy(false);
      if (firstError) report(firstError);
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
    const messages: Record<typeof action, string> = {
      pin: note.current.meta.pinned ? t('action.unpin') : t('action.pin'),
      archive: note.current.archived ? t('action.unarchive') : t('action.archive'),
      trash: t('action.trash'),
      restore: t('action.restore'),
    };
    toast(messages[action], 'success');
  }
  function openNote(note: LocalNote, ids = result.notes.map((n) => n.localId)) {
    session.engine?.setEditing(note.localId, true);
    setSelection({ id: note.localId, ids, initial: note });
  }
  function navigateNote(direction: -1 | 1) {
    if (!selection) return;
    const index = selection.ids.indexOf(selection.id!) + direction;
    const next = notes.find((note) => note.localId === selection.ids[index]);
    if (!next) return;
    session.engine?.setEditing(next.localId, true);
    setSelection((old) => ({ id: next.localId, ids: old?.ids || [], initial: next }));
  }
  function menuFor(note: LocalNote) {
    return buildNoteMenu(note, {
      t,
      labels,
      writable: session.writable,
      targets: multi.isSelected(note.localId) ? selectedNotes : [note],
      canPurge,
      mutate: (targets, edit) => void mutateNotes(targets, edit),
      purge: (target) => void purge(target),
      open: (target) => openNote(target),
      select: multi.select,
      report,
    });
  }
  function startLabelSelection(labelId: number) {
    setLabelSelectionMode(true);
    setSelectedLabelIds([labelId]);
  }
  function toggleLabelSelection(labelId: number) {
    setSelectedLabelIds((current) =>
      current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId],
    );
  }
  function finishLabelSelection() {
    setFilters({ ...filters, unlabeledOnly: false, labelMatch: 'all', labelIds: [...selectedLabelIds] });
    setLabelSelectionMode(false);
    setSelectedLabelIds([]);
    showNoteList();
  }

  useGlobalShortcuts({
    searchRef,
    route,
    writable: session.writable,
    dialogOpen: connectOpen || filtersOpen || !!issue,
    flushEngine: () => void session.engine?.flush(false).catch(report),
    newNote,
  });

  const notices = workspaceNotices({
    t,
    session,
    notice,
    clearNotice: () => setNotice(''),
    online,
    sync,
    busy,
    filterError: result.error,
    notes,
    reconnect: () => setConnectOpen(true),
    review: (group) =>
      openNote(
        group[0]!,
        group.map((item) => item.localId),
      ),
    report,
  });

  return {
    t,
    session,
    connection,
    route,
    view,
    navigate,
    layout,
    online,
    searchRef,
    filters,
    activeFilters,
    setFilters,
    searchInput,
    setSearchInput,
    filtersOpen,
    setFiltersOpen,
    connectOpen,
    setConnectOpen,
    labelOpen,
    setLabelOpen,
    labelSelectionMode,
    selectedLabelIds,
    startLabelSelection,
    toggleLabelSelection,
    finishLabelSelection,
    drawer,
    setDrawer,
    busy,
    setBusy,
    limit,
    setLimit,
    selection,
    setSelection,
    issue,
    setIssue,
    notes,
    labels,
    issues,
    visibleIssues,
    feed,
    result,
    availableCount,
    multi,
    selectedNotes,
    counts,
    sidebarLabelList,
    canPurge,
    notices,
    report,
    resetNavigationState,
    showNoteList,
    mutateNotes,
    newNote,
    purge,
    clearTrash,
    refresh,
    change,
    openNote,
    navigateNote,
    menuFor,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspaceController>;

export const WorkspaceContext = createContext<WorkspaceController | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace() must be used inside <Workspace>.');
  return value;
}
