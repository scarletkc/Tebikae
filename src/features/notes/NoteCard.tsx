import { useMemo } from 'react';
import { Pin, Archive, ArchiveRestore, Trash2, RotateCcw, CircleAlert, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Label, LocalNote } from '../../domain/types';
import { isSimpleChecklist, parseChecklist } from '../../domain/markdown';
import { IconButton, StretchedButton, cn } from '../../ui';
import MarkdownPreview, { PreviewCheckbox } from '../editor/MarkdownPreview';
import { LabelBadge } from '../labels';
import { cardColor } from './cardColor';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { LabelContextMenu } from '../labels/LabelContextMenu';
import { canEditNote } from './actions';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

const DANGER_STATUSES = new Set(['error', 'conflict', 'uncertain']);

export function Highlight({ query, text }: { query: string; text: string }) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const marks: { start: number; end: number }[] = [];
  for (const term of terms) {
    let index = lower.indexOf(term);
    while (index !== -1) {
      marks.push({ start: index, end: index + term.length });
      index = lower.indexOf(term, index + Math.max(term.length, 1));
    }
  }
  if (!marks.length) return <>{text}</>;
  const originalRanges: { start: number; end: number }[] = [];
  for (const { segment, index } of graphemes.segment(text)) {
    const range = { start: index, end: index + segment.length };
    const foldedLength = segment.toLocaleLowerCase().length;
    for (let i = 0; i < foldedLength; i++) originalRanges.push(range);
  }
  for (const mark of marks) {
    const start = originalRanges[mark.start]!.start;
    mark.end = originalRanges[mark.end - 1]!.end;
    mark.start = start;
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const mark of marks) {
    if (mark.start < cursor) continue;
    if (mark.start > cursor) parts.push(text.slice(cursor, mark.start));
    parts.push(<mark key={mark.start}>{text.slice(mark.start, mark.end)}</mark>);
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

export default function NoteCard({
  note,
  labels,
  query = '',
  onOpen,
  onChange,
  onPurge,
  canPurge = false,
  writable,
  menuItems = [],
  selected = false,
  onSelect,
  onRemoveLabel,
}: {
  menuItems?: MenuAction[];
  selected?: boolean;
  onSelect?: (event: React.MouseEvent) => boolean;
  onRemoveLabel?: (id: number) => void;
  note: LocalNote;
  labels: Label[];
  query?: string;
  onOpen(): void;
  onChange(action: 'pin' | 'archive' | 'trash' | 'restore'): void;
  onPurge?(): void;
  canPurge?: boolean;
  writable: boolean;
}) {
  const { t, i18n } = useTranslation();
  const document = note.current;
  const checklist = useMemo(
    () =>
      document.meta.kind === 'checklist' || isSimpleChecklist(document.markdown)
        ? parseChecklist(document.markdown)
        : [],
    [document.markdown, document.meta.kind],
  );
  const preview = document.markdown.slice(0, 2400);
  const trashed = document.meta.trashedAt !== null;
  const editable = writable && canEditNote(note);
  const updated =
    note.syncStatus === 'synced' ? note.base?.updatedAt || note.localModifiedAt : note.localModifiedAt;
  return (
    <ContextMenu items={menuItems} className="context-card relative block">
      <article
        className={cn(
          'note-card group relative min-w-0 rounded-xl border border-line p-4 transition-shadow',
          'hover:shadow-card-hover focus-within:shadow-card-hover active:scale-[0.985]',
          `note-${document.meta.color}`,
          cardColor[document.meta.color],
          selected && 'is-selected ring-2 ring-accent',
        )}
        tabIndex={0}
        onClickCapture={(e) => {
          if ((e.target as Element).closest('.card-actions, .card-pin-toggle, .label-badge, [role="menu"]'))
            return;
          if (onSelect?.(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {selected && (
          <span
            className="note-selected-mark absolute top-2 right-2.5 z-1 text-accent"
            aria-label={t('context.selected')}
          >
            <Check size={16} aria-hidden="true" />
          </span>
        )}
        <div className="note-summary min-w-0">
          <div className="card-title mb-2 flex items-start justify-between gap-2">
            <h3 className="min-w-0">
              <StretchedButton
                className="note-open line-clamp-2 text-base font-semibold wrap-anywhere"
                onClick={onOpen}
                aria-label={`${t('action.edit')}: ${document.title}`}
              >
                <Highlight query={query} text={document.title} />
              </StretchedButton>
            </h3>
            {!trashed && document.meta.pinned && (
              <IconButton
                size="xs"
                label={t('action.unpin')}
                className="card-pin-toggle relative z-2 mt-0.5 shrink-0 [&_svg]:rotate-45"
                onClick={() => onChange('pin')}
                disabled={!editable}
              >
                <Pin size={14} />
              </IconButton>
            )}
          </div>
          {!checklist.length && (
            <MarkdownPreview value={preview || t('note.blank')} compact className="card-rich-preview" />
          )}
        </div>
        {checklist.length > 0 && (
          <div className="card-checklist mt-2 flex flex-col gap-2 text-xs">
            {checklist.slice(0, 4).map((item) => (
              <div
                className="checklist-preview-item flex items-start gap-2 wrap-anywhere"
                key={item.index}
                style={{ paddingInlineStart: Math.min(item.depth, 3) * 10 }}
              >
                <PreviewCheckbox checked={item.checked} className="mt-0.5" />
                <span className={cn('line-clamp-2', item.checked && 'checked line-through opacity-60')}>
                  <Highlight query={query} text={item.text} />
                </span>
              </div>
            ))}
            {/* Plain text: the title's click area already opens the note from here. */}
            <span className="checklist-count mt-1 self-start text-muted">
              {t('note.done', { done: checklist.filter((x) => x.checked).length, total: checklist.length })}
            </span>
          </div>
        )}
        {document.labelIds.length > 0 && (
          <div className="card-labels relative z-2 mt-2 flex w-fit max-w-full flex-wrap gap-1.5">
            {document.labelIds.slice(0, 2).map((id) => {
              const label = labels.find((l) => l.id === id);
              return label && onRemoveLabel ? (
                <LabelContextMenu
                  key={id}
                  label={label}
                  onRemove={editable ? () => onRemoveLabel(id) : undefined}
                >
                  <LabelBadge label={label} />
                </LabelContextMenu>
              ) : (
                <LabelBadge key={id} label={label} fallback={`#${id}`} />
              );
            })}
            {document.labelIds.length > 2 && (
              <span
                className="inline-flex items-center self-center rounded-md border border-line px-1.5 py-0.5 text-xs text-muted"
                title={document.labelIds
                  .slice(2)
                  .map((id) => labels.find((l) => l.id === id)?.name || `#${id}`)
                  .join(', ')}
              >
                +{document.labelIds.length - 2}
              </span>
            )}
          </div>
        )}
        <div className="card-footer mt-2 flex min-h-7 flex-wrap items-center gap-1.5">
          <time dateTime={updated} className="text-xs whitespace-nowrap text-muted">
            {new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(
              new Date(updated),
            )}
          </time>
          {note.syncStatus !== 'synced' && (
            <span
              className={cn(
                'card-status flex items-center gap-1 text-xs',
                `status-${note.syncStatus}`,
                DANGER_STATUSES.has(note.syncStatus) ? 'text-danger' : 'text-muted',
              )}
              title={t(`status.${note.syncStatus}`)}
              aria-label={t(`status.${note.syncStatus}`)}
            >
              <CircleAlert size={13} />
              <span className="hidden">{t(`status.${note.syncStatus}`)}</span>
            </span>
          )}
          <div className="card-actions relative z-2 ml-auto flex opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            {trashed ? (
              <>
                <IconButton
                  size="xs"
                  label={t('action.restore')}
                  onClick={() => onChange('restore')}
                  disabled={!editable}
                >
                  <RotateCcw size={16} />
                </IconButton>
                {onPurge && (
                  <IconButton
                    size="xs"
                    label={t('action.deleteForever')}
                    onClick={onPurge}
                    disabled={!writable || !canPurge}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </>
            ) : (
              <>
                {document.meta.pinned ? null : (
                  <IconButton
                    size="xs"
                    label={t('action.pin')}
                    onClick={() => onChange('pin')}
                    disabled={!editable}
                  >
                    <Pin size={16} />
                  </IconButton>
                )}
                <IconButton
                  size="xs"
                  label={t(document.archived ? 'action.unarchive' : 'action.archive')}
                  onClick={() => onChange('archive')}
                  disabled={!editable}
                >
                  {document.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                </IconButton>
                <IconButton
                  size="xs"
                  label={t('action.trash')}
                  onClick={() => onChange('trash')}
                  disabled={!editable}
                >
                  <Trash2 size={16} />
                </IconButton>
              </>
            )}
          </div>
        </div>
      </article>
    </ContextMenu>
  );
}
