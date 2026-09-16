import { useMemo } from 'react';
import { Pin, Archive, ArchiveRestore, Trash2, RotateCcw, CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Label, LocalNote } from '../../domain/types';
import { isSimpleChecklist, parseChecklist } from '../../domain/markdown';
import { IconButton } from '../../app/ui';
import MarkdownPreview from '../editor/MarkdownPreview';
import { LabelBadge } from '../labels';
import './notes.css';

export default function NoteCard({
  note,
  labels,
  onOpen,
  onChange,
  writable,
}: {
  note: LocalNote;
  labels: Label[];
  onOpen(): void;
  onChange(action: 'pin' | 'archive' | 'trash' | 'restore'): void;
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
  const editable = writable && !note.duplicate && !note.remoteUnavailable;
  const updated =
    note.syncStatus === 'synced' ? note.base?.updatedAt || note.localModifiedAt : note.localModifiedAt;
  return (
    <article className={`note-card note-${document.meta.color}`}>
      <div className="note-summary">
        <div className="card-title">
          <h3>
            <button
              className="note-open"
              onClick={onOpen}
              aria-label={`${t('action.edit')}: ${document.title}`}
            >
              {document.title}
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
              <span className={item.checked ? 'checked' : ''}>{item.text}</span>
            </div>
          ))}
          <button className="checklist-count" onClick={onOpen}>
            {t('note.done', { done: checklist.filter((x) => x.checked).length, total: checklist.length })}
          </button>
        </div>
      )}
      {document.labelIds.length > 0 && (
        <div className="card-labels">
          {document.labelIds.slice(0, 2).map((id) => (
            <LabelBadge key={id} label={labels.find((l) => l.id === id)} fallback={`#${id}`} />
          ))}
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
            <IconButton label={t('action.restore')} onClick={() => onChange('restore')} disabled={!editable}>
              <RotateCcw size={16} />
            </IconButton>
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
  );
}
