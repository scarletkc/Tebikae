import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Pin,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  RefreshCw,
  X,
  Check,
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
import { noteColorBg, editorTint } from './cardColor';
import {
  Banner,
  Button,
  Card,
  Checkbox,
  CheckboxLabel,
  cn,
  iconButtonVariants,
  menuContent,
  menuItem,
  menuLabel,
  menuSeparator,
  Spinner,
} from '../../ui';
import { db } from '../../storage/db';
import { safeHref } from '../../security/urls';
import { usePwaUpdate } from '../../app/pwa';
import { confirmDialog, isConfirmDialogOpen } from '../../app/confirm';
import { useIsMobile } from '../../app/useMediaQuery';
import { motion, useReducedMotion } from 'motion/react';
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

export default function NoteDialog({
  initialNote,
  kind = 'markdown',
  labels,
  initialLabelIds,
  onClose,
  onNavigate,
  canPrevious,
  canNext,
}: {
  initialNote?: LocalNote;
  kind?: NoteKind;
  labels: Label[];
  initialLabelIds?: number[];
  onClose(): void;
  onNavigate(direction: -1 | 1): void;
  canPrevious: boolean;
  canNext: boolean;
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
  const closing = useRef(false);
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
  const flush = useCallback(
    async (options?: { finalizeEmptyTitle?: boolean }) => {
      await editorFlush.current();
      await persist(options);
      if (options?.finalizeEmptyTitle && idRef.current) {
        engine?.setEditing(idRef.current, false);
      }
    },
    [persist, engine],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => registerDraftFlusher((options) => flushRef.current(options)), []);
  useEffect(() => {
    if (localId) engine?.setEditing(localId, true);
    return () => {
      if (localId) engine?.setEditing(localId, false);
    };
  }, [engine, localId]);
  useEffect(
    () => () => {
      clearTimeout(localTimer.current);
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
  }
  async function purge() {
    if (
      purging.current ||
      !engine ||
      !writable ||
      !online ||
      !idRef.current ||
      docRef.current.meta.trashedAt === null ||
      !(await confirmDialog({
        title: t('note.deleteConfirm'),
        confirmLabel: t('action.deleteForever'),
        danger: true,
      }))
    )
      return;
    purging.current = true;
    setDeleting(true);
    setDeleteError(false);
    clearTimeout(localTimer.current);
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
    if (purging.current || purged.current || closing.current) return;
    closing.current = true;
    try {
      // Close only waits for the local write; the remote write stays queued so a slow
      // or busy connection never blocks the close button.
      do {
        await editorFlush.current();
        await persist({ finalizeEmptyTitle: true });
        if (!rootRef.current) return;
      } while (savedVersion.current !== version.current);
      if (idRef.current) {
        engine?.setEditing(idRef.current, false);
        /* A failed write keeps the local draft and Outbox entry for a later retry. */
        void engine?.flushNote(idRef.current, { allowEditing: false }).catch(() => {});
      }
      if (direction) onNavigate(direction);
      else onClose();
    } catch {
      /* Keep the only unsaved copy open. */
    } finally {
      closing.current = false;
    }
  }
  async function sync() {
    try {
      await flush();
      if (idRef.current) await engine?.flushNote(idRef.current);
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
          .then(() => (idRef.current ? engine?.flushNote(idRef.current) : undefined))
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
      void engine?.flushNote(localId).catch(() => {});
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
  const reducedMotion = useReducedMotion();
  const dialogTitle = initialNote ? t('action.edit') : t('home.newTitle');
  const rootRef = useRef<HTMLDivElement>(null);
  const noteMenuTrigger = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  // Global Escape closes the editor (menus and nested dialogs handle their own keys first).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as Element | null;
      if (target?.closest('[role="menu"], [role="listbox"], [role="alertdialog"], .confirm-dialog')) return;
      if (
        isConfirmDialogOpen() ||
        window.document.querySelector('.confirm-overlay, .confirm-dialog, [role="alertdialog"]')
      )
        return;
      const labelPicker = rootRef.current?.querySelector<HTMLDetailsElement>('.note-label-picker[open]');
      if (labelPicker) {
        event.preventDefault();
        labelPicker.open = false;
        labelPicker.querySelector('summary')?.focus();
        return;
      }
      event.preventDefault();
      void closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Move focus into the editor on mount and keep Tab cycling inside it.
  // Skip auto-focus in test automation (guarded by the existing ?e2e flag or
  // Playwright) so editor tools stay stable under automated clicks.
  const skipAutoFocus = typeof navigator === 'object' && /playwright/i.test(navigator.userAgent || '');
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const documentGlobal = window.document;
    const previous = documentGlobal.activeElement as HTMLElement | null;
    if (!skipAutoFocus) {
      const focusTarget = root.querySelector<HTMLElement>(
        'input.note-title-input, .milkdown [contenteditable="true"], textarea, button',
      );
      focusTarget?.focus({ preventScroll: true });
    }
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      if (
        isConfirmDialogOpen() ||
        documentGlobal.querySelector('.confirm-overlay, .confirm-dialog, [role="alertdialog"]')
      ) {
        return;
      }
      const active = documentGlobal.activeElement;
      if (active?.closest('.confirm-dialog, [role="alertdialog"], .confirm-overlay, [role="menu"]')) {
        return;
      }
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null || element === documentGlobal.activeElement);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
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
      if (!skipAutoFocus) previous?.focus?.({ preventScroll: true });
    };
  }, [skipAutoFocus]);
  const motionInitial = {
    opacity: 0,
    scale: reducedMotion || isMobile ? 1 : 0.985,
    y: reducedMotion ? 0 : 8,
  };
  return (
    <motion.div
      ref={rootRef}
      className={cn(
        'floating-editor note-dialog relative flex flex-col overflow-hidden outline-none',
        'bg-[linear-gradient(180deg,color-mix(in_srgb,var(--editor-tint,var(--surface))_32%,var(--surface)),var(--surface)_230px)]',
        `note-${document.meta.color}`,
        document.meta.color === 'default' ? undefined : editorTint[document.meta.color],
        'max-md:h-dvh max-md:w-full max-md:rounded-none max-md:border-0',
        'max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]',
        'md:h-[calc(100dvh-48px)] md:w-[min(1040px,calc(100vw-80px))] md:rounded-2xl md:border md:border-line md:shadow-dialog',
        'max-md:[&_.icon-button]:min-h-11 max-md:[&_.icon-button]:min-w-11',
      )}
      role="dialog"
      aria-modal="true"
      aria-label={dialogTitle}
      initial={motionInitial}
      animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, scale: reducedMotion || isMobile ? 1 : 0.99, y: reducedMotion ? 0 : 6 }}
      transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
    >
      <header className="floating-editor-header flex h-14 shrink-0 items-center gap-2 border-b border-line px-3">
        <IconButton label={t(isMobile ? 'action.back' : 'action.close')} onClick={() => void close()}>
          {isMobile ? <ChevronLeft size={20} /> : <X size={18} />}
        </IconButton>
        <div className="note-save-row flex min-w-0 flex-1 items-center justify-end gap-1.5 max-[430px]:flex-wrap">
          <span
            role="status"
            className={cn(
              'min-w-0 text-xs wrap-anywhere max-[430px]:min-w-[95px]',
              saveError ? 'text-danger' : 'text-muted',
            )}
          >
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
        </div>
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger
            ref={noteMenuTrigger}
            className={cn('icon-button', iconButtonVariants(), 'data-[state=open]:bg-active')}
            aria-label={t('context.more')}
            title={t('context.more')}
          >
            <MoreHorizontal size={20} />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={cn('note-actions-menu', menuContent, 'z-80 min-w-52 max-w-[calc(100vw-24px)]')}
              align="end"
              sideOffset={8}
              collisionPadding={12}
              loop
              onCloseAutoFocus={(event) => {
                if (isConfirmDialogOpen()) event.preventDefault();
              }}
            >
              {document.meta.trashedAt ? (
                <>
                  <NoteAction
                    label={t('action.restore')}
                    disabled={!writable || deleting || !!latest?.purgeStartedAt}
                    onClick={() => change((d) => ({ ...d, meta: { ...d.meta, trashedAt: null } }))}
                  >
                    <RotateCcw size={18} />
                  </NoteAction>
                  <NoteAction
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
                    onClick={() => {
                      noteMenuTrigger.current?.focus();
                      void purge();
                    }}
                  >
                    <Trash2 size={18} />
                  </NoteAction>
                </>
              ) : (
                <>
                  <NoteAction
                    label={t(document.meta.pinned ? 'action.unpin' : 'action.pin')}
                    className={document.meta.pinned ? 'is-pinned' : undefined}
                    disabled={readOnly}
                    onClick={() => change((d) => ({ ...d, meta: { ...d.meta, pinned: !d.meta.pinned } }))}
                  >
                    <Pin size={18} />
                  </NoteAction>
                  <NoteAction
                    label={t(document.archived ? 'action.unarchive' : 'action.archive')}
                    disabled={readOnly}
                    onClick={() => change((d) => ({ ...d, archived: !d.archived }))}
                  >
                    {document.archived ? <ArchiveRestore size={18} /> : <Archive size={18} />}
                  </NoteAction>
                  <NoteAction
                    label={t('action.trash')}
                    disabled={readOnly}
                    onClick={() =>
                      change((d) => ({ ...d, meta: { ...d.meta, trashedAt: new Date().toISOString() } }))
                    }
                  >
                    <Trash2 size={18} />
                  </NoteAction>
                </>
              )}
              <NoteAction label={t('action.exportNote')} onClick={exportCurrent}>
                <Download size={18} />
              </NoteAction>
              {issueUrl && safeHref(issueUrl) && (
                <DropdownMenu.Item asChild>
                  <a
                    className={cn('note-action', menuItem)}
                    href={safeHref(issueUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('action.openGithub')}
                    title={t('action.openGithub')}
                  >
                    <ExternalLink size={18} />
                    <span>{t('action.openGithub')}</span>
                  </a>
                </DropdownMenu.Item>
              )}
              {latest && !latest.issueId && latest.syncStatus !== 'uncertain' && (
                <DropdownMenu.Item asChild>
                  <button
                    className={cn('note-action', menuItem)}
                    disabled={!writable || saving}
                    onClick={() => {
                      clearTimeout(localTimer.current);
                      void persistence.current
                        .then(() => discardDraft(scope, localId!))
                        .then(onClose)
                        .catch(() => setSaveError('generic'));
                    }}
                  >
                    {t('action.discard')}
                  </button>
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Separator className={cn('note-menu-separator', menuSeparator)} />
              <DropdownMenu.Label className={cn('note-menu-caption', menuLabel)}>
                {t('note.color')}
              </DropdownMenu.Label>
              <DropdownMenu.RadioGroup
                className="note-color-options flex gap-1.5 px-2 pt-1 pb-2"
                value={document.meta.color}
                onValueChange={(color) =>
                  change((d) => ({
                    ...d,
                    meta: { ...d.meta, color: color as NoteDocument['meta']['color'] },
                  }))
                }
              >
                {NOTE_COLORS.map((color) => (
                  <DropdownMenu.RadioItem
                    key={color}
                    value={color}
                    disabled={readOnly}
                    className={cn(
                      'note-color-option',
                      `note-${color}`,
                      noteColorBg[color],
                      'grid size-7 cursor-pointer place-items-center rounded-full border border-line text-fg outline-none',
                      'data-[highlighted]:outline-2 data-[highlighted]:outline-offset-2 data-[highlighted]:outline-accent',
                      'data-[state=checked]:outline-2 data-[state=checked]:outline-offset-2 data-[state=checked]:outline-accent',
                      'data-[disabled]:cursor-default data-[disabled]:opacity-40',
                    )}
                    aria-label={t(`color.${color}`)}
                    title={t(`color.${color}`)}
                  >
                    <DropdownMenu.ItemIndicator>
                      <Check size={14} aria-hidden="true" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      <div className="note-dialog-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-[max(36px,calc((100%-720px)/2))] pt-7 pb-16 [scrollbar-gutter:stable] max-md:[scrollbar-gutter:auto] max-md:pt-5 max-md:pr-[max(22px,env(safe-area-inset-right))] max-md:pb-12 max-md:pl-[max(22px,env(safe-area-inset-left))]">
        <TextContextMenu readOnly={readOnly}>
          <input
            className="note-title-input w-full border-0 bg-transparent p-0 pb-3 text-2xl font-semibold leading-tight outline-none placeholder:text-muted focus:shadow-none md:text-3xl"
            aria-label={t('note.title')}
            placeholder={t('note.titlePlaceholder')}
            value={document.title}
            readOnly={readOnly}
            onChange={(e) => change((d) => ({ ...d, title: e.target.value }))}
          />
        </TextContextMenu>
        <div className="note-properties mb-7 flex min-h-[30px] flex-wrap items-center gap-2 max-md:mb-5.5">
          {labels
            .filter((label) => document.labelIds.includes(label.id))
            .map((label) => (
              <LabelContextMenu
                key={label.id}
                label={label}
                onRemove={
                  !readOnly
                    ? () => change((d) => ({ ...d, labelIds: d.labelIds.filter((id) => id !== label.id) }))
                    : undefined
                }
              >
                <LabelBadge label={label} className="px-2.5 py-1" />
              </LabelContextMenu>
            ))}
          <details
            className="note-label-picker relative text-xs open:basis-full first:-ms-2"
            onKeyDown={(event) => {
              if (event.key === 'Escape' && event.currentTarget.open && !event.defaultPrevented) {
                event.preventDefault();
                event.currentTarget.open = false;
                event.currentTarget.querySelector('summary')?.focus();
              }
            }}
          >
            <summary
              tabIndex={0}
              aria-label={t('label.choose')}
              className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-full px-2 py-1 text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent max-md:min-h-11 [&::-webkit-details-marker]:hidden"
            >
              <Plus size={14} />
              {t('note.labels')}
            </summary>
            <div className="note-label-options mt-2 max-w-full rounded-xl bg-hover p-4">
              <fieldset className="min-w-0 border-0 p-0" disabled={readOnly}>
                <legend className="mb-3 text-xs font-medium text-muted">{t('note.labels')}</legend>
                <div className="choices mt-2.5 flex flex-wrap gap-x-4 gap-y-2.5">
                  {labels.length ? (
                    labels.map((label) => (
                      <CheckboxLabel key={label.id}>
                        <Checkbox
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
                                  change((d) => ({
                                    ...d,
                                    labelIds: d.labelIds.filter((id) => id !== label.id),
                                  }))
                              : undefined
                          }
                        >
                          <LabelBadge label={label} className="px-2.5 py-1" />
                        </LabelContextMenu>
                      </CheckboxLabel>
                    ))
                  ) : (
                    <span className="text-muted">{t('label.empty')}</span>
                  )}
                </div>
              </fieldset>
            </div>
          </details>
        </div>
        {pwa.available && (
          <Banner className="banner mb-4">
            <span className="flex-1">{t('settings.update')}</span>
            <Button onClick={() => void pwa.update().catch(() => {})}>{t('settings.updateAction')}</Button>
          </Banner>
        )}
        {latest?.remoteUnavailable && (
          <Banner tone="warning" className="banner warning mb-4">
            <p>{t('home.unavailable')}</p>
          </Banner>
        )}
        {!saving && latest?.syncStatus === 'synced' && latest.current.markdown !== document.markdown && (
          <Banner className="banner mb-4">
            <span className="flex-1">{t('note.remoteUpdated')}</span>
            <Button
              variant="link"
              size="sm"
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
            </Button>
          </Banner>
        )}
        {latest?.duplicate && (
          <Banner tone="warning" className="banner warning mb-4">
            <p>{t('note.duplicate')}</p>
            <p>{t('note.duplicateHelp')}</p>
            <Button
              disabled={!engine}
              onClick={() => void engine?.resolveDuplicate(localId!).catch(() => setSaveError('generic'))}
            >
              {t('note.resolveDuplicate')}
            </Button>
          </Banner>
        )}
        {latest?.syncStatus === 'uncertain' && (
          <Banner tone="warning" className="banner warning mb-4">
            <p className="w-full">{t('note.uncertain')}</p>
            <div className="button-row flex flex-wrap items-center gap-2.5">
              <Button
                disabled={!engine}

                onClick={() => void engine?.pull(true).catch(() => setSaveError('generic'))}
              >
                {t('action.checkAgain')}
              </Button>
              {!latest.issueId && (
                <Button
                  disabled={!engine}
                  variant="link"
                  size="sm"
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
                </Button>
              )}
            </div>
          </Banner>
        )}
        {latest?.syncStatus === 'conflict' && !latest.duplicate && remote && (
          <Card className="conflict-panel my-2.5 mb-5">
            <h3 className="text-base font-semibold">{t('note.conflict')}</h3>
            <p className="mt-2 mb-4 text-xs text-muted">{t('note.conflictHelp')}</p>
            <div className="conflict-versions mb-4 grid gap-3 md:grid-cols-2">
              <div className="min-w-0 rounded-lg border border-line bg-canvas p-3">
                <h4 className="mb-2 text-xs text-muted">{t('note.localVersion')}</h4>
                <strong className="text-xs">{document.title}</strong>
                <pre className="max-h-[180px] overflow-auto font-[inherit] text-xs wrap-anywhere whitespace-pre-wrap">
                  {document.markdown}
                </pre>
                <p className="text-xs text-muted">
                  {t('note.color')}: {t(`color.${document.meta.color}`)} · {t('filter.pinned')}:{' '}
                  {t(document.meta.pinned ? 'filter.pinnedOnly' : 'filter.unpinnedOnly')} ·{' '}
                  {t(document.meta.trashedAt ? 'nav.trash' : document.archived ? 'nav.archive' : 'nav.notes')}{' '}
                  · {t(`filter.${document.meta.kind}`)}
                </p>
              </div>
              <div className="min-w-0 rounded-lg border border-line bg-canvas p-3">
                <h4 className="mb-2 text-xs text-muted">{t('note.remoteVersion')}</h4>
                <strong className="text-xs">{remote.title}</strong>
                <pre className="max-h-[180px] overflow-auto font-[inherit] text-xs wrap-anywhere whitespace-pre-wrap">
                  {remote.markdown}
                </pre>
                <p className="text-xs text-muted">
                  {t('note.color')}: {t(`color.${remote.meta.color}`)} · {t('filter.pinned')}:{' '}
                  {t(remote.meta.pinned ? 'filter.pinnedOnly' : 'filter.unpinnedOnly')} ·{' '}
                  {t(remote.meta.trashedAt ? 'nav.trash' : remote.archived ? 'nav.archive' : 'nav.notes')} ·{' '}
                  {t(`filter.${remote.meta.kind}`)}
                </p>
              </div>
            </div>
            <div className="button-row flex flex-wrap items-center gap-2.5">
              <Button disabled={!writable} onClick={() => void resolve('remote')}>
                {t('note.useRemote')}
              </Button>
              <Button disabled={!writable} onClick={() => void resolve('local')}>
                {t('note.useLocal')}
              </Button>
              <Button disabled={!writable} onClick={() => void resolve('copy')}>
                {t('note.saveCopy')}
              </Button>
            </div>
          </Card>
        )}
        <Suspense
          fallback={
            <div className="editor-loading flex justify-center p-11">
              <Spinner size={20} />
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
        {saveError && (
          <Banner tone="danger" role="alert" className="error-box mt-3">
            <p className="w-full">
              {saveError === 'storage' ? t('note.localError') : t(`error.${saveError}`)}
            </p>
            <Button onClick={exportCurrent}>{t('note.copyEmergency')}</Button>
            <Button variant="link" size="sm" onClick={() => void persist().catch(() => {})}>
              {t('action.retry')}
            </Button>
          </Banner>
        )}
        {latest?.error && (
          <details className="error-details mt-5 text-xs text-danger">
            <summary>{t(`error.${latest.error.code}`)}</summary>
            <p className="wrap-anywhere">
              {latest.error.code} {latest.error.status} {latest.error.requestId}
            </p>
            {latest.error.retryAt && (
              <p className="wrap-anywhere">
                {t('error.retryAt', { time: new Date(latest.error.retryAt).toLocaleString() })}
              </p>
            )}
            {latest.error.detail && <p className="wrap-anywhere">{latest.error.detail}</p>}
            <Button
              disabled={!engine}
              onClick={() => void engine?.retry(localId!).catch(() => setSaveError('generic'))}
            >
              {t('action.retry')}
            </Button>
          </details>
        )}
        {deleteError && (
          <Banner tone="danger" role="alert" className="error-box mt-3">
            <p>{t('note.deleteFailed')}</p>
          </Banner>
        )}
      </div>
      <footer className="note-editor-footer flex shrink-0 justify-end gap-1 px-4 pt-1 pb-3 max-md:p-3">
        <IconButton label={t('action.previous')} disabled={!canPrevious} onClick={() => void close(-1)}>
          <ChevronLeft size={18} />
        </IconButton>
        <IconButton label={t('action.next')} disabled={!canNext} onClick={() => void close(1)}>
          <ChevronRight size={18} />
        </IconButton>
      </footer>
    </motion.div>
  );
}

function NoteAction({
  label,
  children,
  onClick,
  disabled,
  className = '',
}: React.ComponentProps<typeof IconButton>) {
  return (
    <DropdownMenu.Item asChild disabled={disabled}>
      <button
        type="button"
        className={cn('note-action', menuItem, className)}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
        <span>{label}</span>
      </button>
    </DropdownMenu.Item>
  );
}
