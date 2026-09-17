import { useMemo } from 'react';
import { Pin, Archive, ArchiveRestore, Trash2, RotateCcw, CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Label, LocalNote } from '../../domain/types';
import { isSimpleChecklist, parseChecklist } from '../../domain/markdown';
import { IconButton } from '../../app/ui';
import MarkdownPreview from '../editor/MarkdownPreview';
import { LabelBadge } from '../labels';
import './notes.css';
import { ContextMenu, type MenuAction } from '../../app/ContextMenu';
import { LabelContextMenu } from '../labels/LabelContextMenu';
import { canEditNote } from './actions';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

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
    <ContextMenu items={menuItems} explicit={!!menuItems.length} className="context-card">
      <article
        className={`note-card note-${document.meta.color} ${selected ? 'is-selected' : ''}`}
        tabIndex={0}
        onClickCapture={(e) => {
          if ((e.target as Element).closest('.card-actions, .context-more, .label-badge, [role="menu"]'))
            return;
          if (onSelect?.(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        {selected && (
          <span className="note-selected-mark" aria-label={t('context.selected')}>
            ✓
          </span>
        )}
        <div className="note-summary">
          <div className="card-title">
            <h3>
              <button
                className="note-open"
                onClick={onOpen}
                aria-label={`${t('action.edit')}: ${document.title}`}
              >
                <Highlight query={query} text={document.title} />
              </button>
            </h3>
            {document.meta.pinned && <Pin size={14} />}
          </div>
          {!checklist.length && (
            <MarkdownPreview value={preview || t('note.blank')} compact className="card-rich-preview" />
          )}
        </div>
        {checklist.length > 0 && (
          <div className="card-checklist">
            {checklist.slice(0, 4).map((item) => (
              <div
                className="checklist-preview-item"
                key={item.index}
                style={{ paddingInlineStart: Math.min(item.depth, 3) * 10 }}
              >
                <span className={`preview-checkbox ${item.checked ? 'is-checked' : ''}`} aria-hidden="true">
                  {item.checked ? '✓' : ''}
                </span>
                <span className={item.checked ? 'checked' : ''}>
                  <Highlight query={query} text={item.text} />
                </span>
              </div>
            ))}
            <button className="checklist-count" onClick={onOpen}>
              {t('note.done', { done: checklist.filter((x) => x.checked).length, total: checklist.length })}
            </button>
          </div>
        )}
        {document.labelIds.length > 0 && (
          <div className="card-labels">
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
        <div className="card-footer">
          <time dateTime={updated}>
            {new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(
              new Date(updated),
            )}
          </time>
          {note.syncStatus !== 'synced' && (
            <span
              className={`card-status status-${note.syncStatus}`}
              title={t(`status.${note.syncStatus}`)}
              aria-label={t(`status.${note.syncStatus}`)}
            >
              <CircleAlert size={13} />
              <span>{t(`status.${note.syncStatus}`)}</span>
            </span>
          )}
          <div className="card-actions">
            {trashed ? (
              <>
                <IconButton
                  label={t('action.restore')}
                  onClick={() => onChange('restore')}
                  disabled={!editable}
                >
                  <RotateCcw size={16} />
                </IconButton>
                {onPurge && (
                  <IconButton
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
                <IconButton
                  label={t(document.meta.pinned ? 'action.unpin' : 'action.pin')}
                  onClick={() => onChange('pin')}
                  disabled={!editable}
                >
                  <Pin size={16} />
                </IconButton>
                <IconButton
                  label={t(document.archived ? 'action.unarchive' : 'action.archive')}
                  onClick={() => onChange('archive')}
                  disabled={!editable}
                >
                  {document.archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
                </IconButton>
                <IconButton label={t('action.trash')} onClick={() => onChange('trash')} disabled={!editable}>
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
