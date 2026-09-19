import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Pin,
  RotateCcw,
  Trash2,
  RefreshCw,
  LoaderCircle,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  type Label,
  type LocalNote,
  type NoteDocument,
  type NoteKind,
  NOTE_COLORS,
} from '../../domain/types';
import { newMetadata, snapshotToDocument } from '../../domain/codec';
import { isSimpleChecklist } from '../../domain/markdown';
import {
  createNote,
  saveEditedNote,
  resolveConflict,
  discardDraft,
  exportMarkdown,
} from '../../application/commands';
import { useSession, registerDraftFlusher } from '../../app/session';
import { IconButton, download } from '../../app/ui';
import { db } from '../../storage/db';
import { safeHref } from '../../security/urls';
import { usePwaUpdate } from '../../app/pwa';
import { confirmDialog } from '../../app/confirm';
import { useIsMobile } from '../../app/useMediaQuery';
import { motion } from 'motion/react';
import { LabelBadge } from '../labels';
import { TextContextMenu } from '../editor/TextContextMenu';
import { LabelContextMenu } from '../labels/LabelContextMenu';
/**
 * The editor chunk is lazy-loaded so the shell stays small for offline precache. A
 * transient fetch failure (spotty network, a Service Worker eviction mid-load) must
 * not leave the dialog stuck on the spinner, so retry the import a few times.
 */
const MarkdownEditor = lazy(async () => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await import('../editor/MarkdownEditor');
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
});

export type EditorOrigin = { x: number; y: number; width: number; height: number } | null;

export default function NoteDialog({
  initialNote,
  kind = 'markdown',
  labels,
  initialLabelIds,
  onClose,
  onNavigate,
  canPrevious,
  canNext,
  origin = null,
}: {
  initialNote?: LocalNote;
  kind?: NoteKind;
  labels: Label[];
  initialLabelIds?: number[];
  onClose(): void;
  onNavigate(direction: -1 | 1): void;
  canPrevious: boolean;
  canNext: boolean;
  /** Bounding rect of the card the editor expands from; null fades in place (new notes). */
  origin?: EditorOrigin;
}) {
  const { t } = useTranslation();
  const { connection, engine, writable, connected } = useSession();
  const pwa = usePwaUpdate();
  const scope = connection!.scopeId;
  const [document, setDocument] = useState<NoteDocument>(() =>
    initialNote
      ? structuredClone(initialNote.current)
      : {
          title: '',
          markdown: '',
          meta: newMetadata(kind),
          archived: false,
          labelIds: initialLabelIds ? [...initialLabelIds] : [],
        },
  );
  const docRef = useRef(document);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const lastEditorDocument = useRef(structuredClone(document));
  const [localId, setLocalId] = useState(initialNote?.localId);
  const idRef = useRef(localId);
  const latest = useLiveQuery(() => (localId ? db.notes.get([scope, localId]) : undefined), [scope, localId]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const purging = useRef(false);
  const purged = useRef(false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const [saveError, setSaveError] = useState('');
  const [persistedRevision, setPersistedRevision] = useState(initialNote?.localRevision || 0);
  const persistence = useRef<Promise<void>>(Promise.resolve());
  const localTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorFlush = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    if (
      !latest ||
      saving ||
      version.current !== savedVersion.current ||
      latest.localRevision < persistedRevision
    )
      return;
    // Adopt merged properties without replacing the live editor document or its undo history.
    // Keep the old Markdown baseline so a later edit of stale text becomes a conflict.
    const adopted = {
      title: latest.current.title,
      meta: structuredClone(latest.current.meta),
      archived: latest.current.archived,
      labelIds: [...latest.current.labelIds],
    };
    // Keep a locally cleared title in the input until close; the persist baseline still tracks the saved title.
    const editorTitle = docRef.current.title;
    docRef.current = {
      ...docRef.current,
      ...adopted,
      ...(editorTitle.trim() ? {} : { title: editorTitle }),
    };
    lastEditorDocument.current = { ...lastEditorDocument.current, ...structuredClone(adopted) };
    setDocument(docRef.current);
  }, [latest, saving, persistedRevision]);
  const readOnly =
    !writable ||
    deleting ||
    !!latest?.purgeStartedAt ||
    document.meta.trashedAt !== null ||
    !!latest?.duplicate ||
    !!latest?.remoteUnavailable;
  const persist = useCallback(
    async (options?: { finalizeEmptyTitle?: boolean; beforePurge?: boolean }) => {
      clearTimeout(localTimer.current);
      const run = async () => {
        if (purged.current || (purging.current && !options?.beforePurge)) return;
        const emptyTitle = !docRef.current.title.trim();
        // Title-only clearing is kept local; still persist the untitled fallback on close.
        if (version.current === savedVersion.current && !(options?.finalizeEmptyTitle && emptyTitle)) return;
        const currentVersion = version.current;
        const draft = structuredClone(docRef.current);
        if (!idRef.current && emptyTitle && !draft.markdown.trim()) {
          savedVersion.current = currentVersion;
          setSaving(false);
          return;
        }
        if (emptyTitle) {
          draft.title =
            options?.finalizeEmptyTitle || !idRef.current
              ? t('home.untitled')
              : lastEditorDocument.current.title;
        }
        try {
          const note = idRef.current
            ? await saveEditedNote(scope, idRef.current, lastEditorDocument.current, draft)
            : await createNote(scope, draft);
          lastEditorDocument.current = structuredClone(draft);
          setPersistedRevision(note.localRevision);
          if (!idRef.current) {
            idRef.current = note.localId;
            setLocalId(note.localId);
            engine?.setEditing(note.localId, true);
          }
          savedVersion.current = currentVersion;
          setSaveError('');
          if (currentVersion === version.current) setSaving(false);
        } catch (error) {
          setSaving(false);
          setSaveError(
            error instanceof Error && /VALIDATION|LIMIT|title|markdown|body/i.test(error.message)
              ? 'VALIDATION_FAILED'
              : 'storage',
          );
          throw error;
        }
      };
      const result = persistence.current.catch(() => {}).then(run);
      persistence.current = result;
      return result;
    },
    [scope, t, engine],
  );
  const flush = useCallback(async () => {
    await editorFlush.current();
    await persist();
  }, [persist]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => registerDraftFlusher(() => flushRef.current()), []);
  useEffect(() => {
    if (localId) engine?.setEditing(localId, true);
    return () => {
      if (localId) engine?.setEditing(localId, false);
    };
  }, [engine, localId]);
  useEffect(
    () => () => {
      clearTimeout(localTimer.current);
      clearTimeout(syncTimer.current);
    },
    [],
  );
  function change(update: (old: NoteDocument) => NoteDocument) {
    const next = update(docRef.current);
    docRef.current = next;
    setDocument(next);
    version.current++;
    setSaving(true);
    clearTimeout(localTimer.current);
    localTimer.current = setTimeout(() => void persist().catch(() => {}), 150);
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(
      () =>
        void persist()
          .then(() => engine?.flush(false))
          .catch(() => {}),
      2000,
    );
  }
  async function purge() {
    if (
      purging.current ||
      !engine ||
      !writable ||
      !online ||
      !idRef.current ||
      docRef.current.meta.trashedAt === null ||
      !(await confirmDialog({ title: t('note.deleteConfirm'), confirmLabel: t('action.deleteForever'), danger: true }))
    )
      return;
    purging.current = true;
    setDeleting(true);
    setDeleteError(false);
    clearTimeout(localTimer.current);
    clearTimeout(syncTimer.current);
    try {
      await persistence.current;
      await editorFlush.current();
      await persist({ beforePurge: true });
      await engine.destroy(idRef.current);
      purged.current = true;
      engine.setEditing(idRef.current, false);
      onClose();
    } catch {
      setDeleteError(true);
    } finally {
      purging.current = false;
      setDeleting(false);
    }
  }
  async function close(direction?: -1 | 1) {
    if (purging.current || purged.current) return;
    try {
      await editorFlush.current();
      await persist({ finalizeEmptyTitle: true });
      if (idRef.current) engine?.setEditing(idRef.current, false);
      if (direction) onNavigate(direction);
      else onClose();
      void engine?.flush(false).catch(() => {});
    } catch {
      /* Keep the only unsaved copy open. */
    }
  }
  async function sync() {
    try {
      await flush();
      await engine?.flush(true);
    } catch {
      /* The local error and queue status provide recovery actions. */
    }
  }
  useEffect(() => {
    const save = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushRef
          .current()
          .then(() => engine?.flush(true))
          .catch(() => {});
      }
    };
    const hidden = () => {
      if (documentGlobal.hidden) void flushRef.current().catch(() => {});
    };
    const documentGlobal = window.document;
    window.addEventListener('keydown', save);
    documentGlobal.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('keydown', save);
      documentGlobal.removeEventListener('visibilitychange', hidden);
    };
  }, [engine]);
  async function resolve(choice: 'local' | 'remote' | 'copy') {
    if (!localId) return;
    try {
      await flush();
      const note = await resolveConflict(scope, localId, choice);
      docRef.current = structuredClone(note.current);
      lastEditorDocument.current = structuredClone(note.current);
      setDocument(docRef.current);
      version.current = 0;
      savedVersion.current = 0;
      void engine?.flush(true).catch(() => {});
    } catch {
      setSaveError('generic');
    }
  }
  async function exportCurrent() {
    await editorFlush.current();
    if (latest) {
      const output = exportMarkdown({ ...latest, current: docRef.current }, labels);
      download(output.filename, output.content, 'text/markdown');
    } else
      download(
        `${docRef.current.title || 'Tebikae'}.md`,
        `# ${docRef.current.title}\n\n${docRef.current.markdown}`,
        'text/markdown',
      );
  }
  const issueUrl = latest?.base?.url || latest?.lastSeenRemote?.url;
  const remote = latest?.lastSeenRemote && snapshotToDocument(latest.lastSeenRemote);
  const isMobile = useIsMobile();
  const dialogTitle = initialNote ? t('action.edit') : t('home.newTitle');
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  // Global Escape closes the editor (menus and nested dialogs handle their own keys first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest('[role="menu"], [role="listbox"], [role="alertdialog"]')) return;
      event.preventDefault();
      void closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Move focus into the editor on mount and keep Tab cycling inside it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const documentGlobal = window.document;
    const previous = documentGlobal.activeElement as HTMLElement | null;
    const focusTarget = root.querySelector<HTMLElement>(
      'input.note-title-input, .milkdown [contenteditable="true"], textarea, button',
    );
    focusTarget?.focus({ preventScroll: true });
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === documentGlobal.activeElement);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = documentGlobal.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !root.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    documentGlobal.addEventListener('keydown', trap);
    return () => {
      documentGlobal.removeEventListener('keydown', trap);
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
  // Expand from the clicked card's rect when available; otherwise fade in place.
  const motionInitial = origin
    ? {
        opacity: 0,
        scale: 0.7,
        x: origin.x + origin.width / 2 - window.innerWidth / 2,
        y: origin.y + origin.height / 2 - window.innerHeight / 2,
      }
    : { opacity: 0, scale: isMobile ? 1 : 0.96, y: isMobile ? 24 : 10 };
  return (
    <motion.div
      ref={rootRef}
      className={`floating-editor note-dialog note-${document.meta.color} ${isMobile ? 'floating-editor-mobile' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={dialogTitle}
      initial={motionInitial}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={
        origin
          ? { opacity: 0, scale: 0.82, x: origin.x + origin.width / 2 - window.innerWidth / 2, y: 0 }
          : { opacity: 0, scale: isMobile ? 1 : 0.97, y: isMobile ? 24 : 8 }
      }
      transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 1 }}
    >
      <header className="floating-editor-header">
        {isMobile && (
          <IconButton label={t('action.back')} onClick={() => void close()}>
            <ChevronLeft size={20} />
          </IconButton>
        )}
        <h2 className="floating-editor-heading">{dialogTitle}</h2>
        <IconButton label={t('action.close')} className="floating-editor-close" onClick={() => void close()}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="note-dialog-scroll">
        <TextContextMenu readOnly={readOnly}>
          <input
            className="note-title-input"
            aria-label={t('note.title')}
            placeholder={t('note.titlePlaceholder')}
            value={document.title}
            readOnly={readOnly}
            onChange={(e) => change((d) => ({ ...d, title: e.target.value }))}
          />
        </TextContextMenu>
        {pwa.available && (
          <div className="banner">
            <span>{t('settings.update')}</span>
            <button className="button secondary" onClick={() => void pwa.update().catch(() => {})}>
              {t('settings.updateAction')}
            </button>
          </div>
        )}
        {latest?.remoteUnavailable && <p className="banner warning">{t('home.unavailable')}</p>}
        {!saving && latest?.syncStatus === 'synced' && latest.current.markdown !== document.markdown && (
          <div className="banner">
            <span>{t('note.remoteUpdated')}</span>
            <button
              className="text-button"
              onClick={async () => {
                await flush();
                const fresh = idRef.current ? await db.notes.get([scope, idRef.current]) : undefined;
                if (fresh?.syncStatus === 'synced') {
                  docRef.current = structuredClone(fresh.current);
                  lastEditorDocument.current = structuredClone(fresh.current);
                  setDocument(docRef.current);
                }
              }}
            >
              {t('note.loadLatest')}
            </button>
          </div>
        )}
        {latest?.duplicate && (
          <div className="banner warning">
            <p>{t('note.duplicate')}</p>
            <p>{t('note.duplicateHelp')}</p>
            <button
              className="button secondary"
              disabled={!engine}
              onClick={() => void engine?.resolveDuplicate(localId!).catch(() => setSaveError('generic'))}
            >
              {t('note.resolveDuplicate')}
            </button>
          </div>
        )}
        {latest?.syncStatus === 'uncertain' && (
          <div className="banner warning">
            <p>{t('note.uncertain')}</p>
            <div className="button-row">
              <button
                disabled={!engine}
                className="button secondary"
                onClick={() => void engine?.pull(true).catch(() => setSaveError('generic'))}
              >
                {t('action.checkAgain')}
              </button>
              {!latest.issueId && (
                <button
                  disabled={!engine}
                  className="text-button"
                  onClick={() => {
                    void confirmDialog({
                      title: t('note.retryWarning'),
                      confirmLabel: t('action.retryCreate'),
                    }).then((ok) => {
                      if (ok) void engine?.retry(localId!, true).catch(() => setSaveError('generic'));
                    });
                  }}
                >
                  {t('action.retryCreate')}
                </button>
              )}
            </div>
          </div>
        )}
        {latest?.syncStatus === 'conflict' && !latest.duplicate && remote && (
          <section className="conflict-panel">
            <h3>{t('note.conflict')}</h3>
            <p>{t('note.conflictHelp')}</p>
            <div className="conflict-versions">
              <div>
                <h4>{t('note.localVersion')}</h4>
                <strong>{document.title}</strong>
                <pre>{document.markdown}</pre>
                <p>
                  {t('note.color')}: {t(`color.${document.meta.color}`)} · {t('filter.pinned')}:{' '}
                  {t(document.meta.pinned ? 'filter.pinnedOnly' : 'filter.unpinnedOnly')} ·{' '}
                  {t(document.meta.trashedAt ? 'nav.trash' : document.archived ? 'nav.archive' : 'nav.notes')}{' '}
                  · {t(`filter.${document.meta.kind}`)}
                </p>
              </div>
              <div>
                <h4>{t('note.remoteVersion')}</h4>
                <strong>{remote.title}</strong>
                <pre>{remote.markdown}</pre>
                <p>
                  {t('note.color')}: {t(`color.${remote.meta.color}`)} · {t('filter.pinned')}:{' '}
                  {t(remote.meta.pinned ? 'filter.pinnedOnly' : 'filter.unpinnedOnly')} ·{' '}
                  {t(remote.meta.trashedAt ? 'nav.trash' : remote.archived ? 'nav.archive' : 'nav.notes')} ·{' '}
                  {t(`filter.${remote.meta.kind}`)}
                </p>
              </div>
            </div>
            <div className="button-row">
              <button
                className="button secondary"
                disabled={!writable}
                onClick={() => void resolve('remote')}
              >
                {t('note.useRemote')}
              </button>
              <button className="button secondary" disabled={!writable} onClick={() => void resolve('local')}>
                {t('note.useLocal')}
              </button>
              <button className="button secondary" disabled={!writable} onClick={() => void resolve('copy')}>
                {t('note.saveCopy')}
              </button>
            </div>
          </section>
        )}
        <Suspense
          fallback={
            <div className="editor-loading">
              <LoaderCircle className="spin" size={20} />
            </div>
          }
        >
          <MarkdownEditor
            value={document.markdown}
            initialKind={document.meta.kind}
            readOnly={readOnly}
            onChange={(markdown) =>
              change((d) => ({
                ...d,
                markdown,
                meta: {
                  ...d.meta,
                  kind:
                    d.meta.kind === 'checklist' && markdown.trim() && !isSimpleChecklist(markdown)
                      ? 'markdown'
                      : d.meta.kind,
                },
              }))
            }
            onReady={(fn) => {
              editorFlush.current = fn;
            }}
          />
        </Suspense>
        <div className="note-properties">
          <fieldset disabled={readOnly}>
            <legend>{t('note.color')}</legend>
            <div className="color-swatches">
              {NOTE_COLORS.map((color) => (
                <button
                  type="button"
                  key={color}
                  title={t(`color.${color}`)}
                  aria-label={t(`color.${color}`)}
                  aria-pressed={document.meta.color === color}
                  className={`color-swatch note-${color}`}
                  onClick={() => change((d) => ({ ...d, meta: { ...d.meta, color } }))}
                />
              ))}
            </div>
          </fieldset>
          <fieldset disabled={readOnly}>
            <legend>{t('note.labels')}</legend>
            <div className="choices">
              {labels.length ? (
                labels.map((label) => (
                  <label key={label.id}>
                    <input
                      type="checkbox"
                      checked={document.labelIds.includes(label.id)}
                      onChange={() =>
                        change((d) => ({
                          ...d,
                          labelIds: d.labelIds.includes(label.id)
                            ? d.labelIds.filter((id) => id !== label.id)
                            : [...d.labelIds, label.id],
                        }))
                      }
                    />
                    <LabelContextMenu
                      label={label}
                      onRemove={
                        !readOnly && document.labelIds.includes(label.id)
                          ? () =>
                              change((d) => ({ ...d, labelIds: d.labelIds.filter((id) => id !== label.id) }))
                          : undefined
                      }
                    >
                      <LabelBadge label={label} />
                    </LabelContextMenu>
                  </label>
                ))
              ) : (
                <span className="muted">{t('label.empty')}</span>
              )}
            </div>
          </fieldset>
        </div>
        {saveError && (
          <div role="alert" className="error-box">
            <p>{saveError === 'storage' ? t('note.localError') : t(`error.${saveError}`)}</p>
            <button className="button secondary" onClick={exportCurrent}>
              {t('note.copyEmergency')}
            </button>
            <button className="text-button" onClick={() => void persist().catch(() => {})}>
              {t('action.retry')}
            </button>
          </div>
        )}
        {latest?.error && (
          <details className="error-details">
            <summary>{t(`error.${latest.error.code}`)}</summary>
            <p>
              {latest.error.code} {latest.error.status} {latest.error.requestId}
            </p>
            {latest.error.retryAt && (
              <p>{t('error.retryAt', { time: new Date(latest.error.retryAt).toLocaleString() })}</p>
            )}
            {latest.error.detail && <p>{latest.error.detail}</p>}
            <button
              className="button secondary"
              disabled={!engine}
              onClick={() => void engine?.retry(localId!).catch(() => setSaveError('generic'))}
            >
              {t('action.retry')}
            </button>
          </details>
        )}
        {deleteError && (
          <div role="alert" className="error-box">
            <p>{t('note.deleteFailed')}</p>
          </div>
        )}
      </div>
      <footer className="note-editor-footer">
        <div className="note-tools">
          {document.meta.trashedAt ? (
            <>
              <IconButton
                label={t('action.restore')}
                disabled={!writable || deleting || !!latest?.purgeStartedAt}
                onClick={() => change((d) => ({ ...d, meta: { ...d.meta, trashedAt: null } }))}
              >
                <RotateCcw size={18} />
              </IconButton>
              <IconButton
                label={t(deleting ? 'note.deleting' : 'action.deleteForever')}
                disabled={
                  !engine ||
                  !writable ||
                  !online ||
                  deleting ||
                  !localId ||
                  !!latest?.duplicate ||
                  !!latest?.remoteUnavailable
                }
                onClick={() => void purge()}
              >
                <Trash2 size={18} />
              </IconButton>
            </>
          ) : (
            <>
              <IconButton
                label={t(document.meta.pinned ? 'action.unpin' : 'action.pin')}
                disabled={readOnly}
                onClick={() => change((d) => ({ ...d, meta: { ...d.meta, pinned: !d.meta.pinned } }))}
              >
                <Pin size={18} />
              </IconButton>
              <IconButton
                label={t(document.archived ? 'action.unarchive' : 'action.archive')}
                disabled={readOnly}
                onClick={() => change((d) => ({ ...d, archived: !d.archived }))}
              >
                {document.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
              </IconButton>
              <IconButton
                label={t('action.trash')}
                disabled={readOnly}
                onClick={() =>
                  change((d) => ({ ...d, meta: { ...d.meta, trashedAt: new Date().toISOString() } }))
                }
              >
                <Trash2 size={18} />
              </IconButton>
            </>
          )}
          <IconButton label={t('action.exportNote')} onClick={exportCurrent}>
            <Download size={18} />
          </IconButton>
          {issueUrl && safeHref(issueUrl) && (
            <a
              className="icon-button"
              href={safeHref(issueUrl)!}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('action.openGithub')}
              title={t('action.openGithub')}
            >
              <ExternalLink size={18} />
            </a>
          )}
          {latest && !latest.issueId && latest.syncStatus !== 'uncertain' && (
            <button
              className="text-button"
              disabled={!writable || saving}
              onClick={() => {
                clearTimeout(localTimer.current);
                clearTimeout(syncTimer.current);
                void persistence.current
                  .then(() => discardDraft(scope, localId!))
                  .then(onClose)
                  .catch(() => setSaveError('generic'));
              }}
            >
              {t('action.discard')}
            </button>
          )}
        </div>
        <div className="note-save-row">
          <span role="status" className={saveError ? 'danger' : 'muted'}>
            {saveError
              ? t('note.localError')
              : saving
                ? t('note.savingLocal')
                : persistedRevision > (latest?.localRevision || 0)
                  ? t('note.localSaved')
                  : latest
                    ? t(`status.${latest.syncStatus}`)
                    : t('note.blank')}
          </span>
          <IconButton
            label={t('action.save')}
            disabled={!connected || !writable || !!saveError}
            onClick={() => void sync()}
          >
            <RefreshCw size={17} />
          </IconButton>
          <IconButton label={t('action.previous')} disabled={!canPrevious} onClick={() => void close(-1)}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label={t('action.next')} disabled={!canNext} onClick={() => void close(1)}>
            <ChevronRight size={18} />
          </IconButton>
          <button className="button primary" onClick={() => void close()}>
            {t('action.close')}
          </button>
        </div>
      </footer>
    </motion.div>
  );
}
