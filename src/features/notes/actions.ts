import type { TFunction } from 'i18next';
import { NOTE_COLORS, type Label, type LocalNote, type NoteDocument } from '../../domain/types';
import type { MenuAction } from '../../app/ContextMenu';

export const canEditNote = (note: LocalNote) =>
  !note.duplicate &&
  !note.remoteUnavailable &&
  !note.purgeStartedAt &&
  !note.conflictFields?.includes('protocol');

export function noteActions(
  notes: LocalNote[],
  labels: Label[],
  writable: boolean,
  t: TFunction,
  mutate: (edit: (doc: NoteDocument) => void) => void,
): MenuAction[] {
  const disabled = !writable || !notes.length || notes.some((note) => !canEditNote(note));
  const allPinned = notes.every((n) => n.current.meta.pinned);
  const allArchived = notes.every((n) => n.current.archived);
  const bulk = notes.length > 1;
  if (notes.every((n) => n.current.meta.trashedAt))
    return [
      {
        label: t('action.restore'),
        disabled,
        run: () =>
          mutate((d) => {
            d.meta.trashedAt = null;
          }),
      },
    ];
  return [
    {
      label: t(
        bulk
          ? allPinned
            ? 'context.unpinAll'
            : 'context.pinAll'
          : allPinned
            ? 'action.unpin'
            : 'action.pin',
      ),
      disabled,
      run: () =>
        mutate((d) => {
          d.meta.pinned = !allPinned;
        }),
    },
    {
      label: t('note.labels'),
      disabled,
      children: labels.length
        ? labels.map((label) => {
            const count = notes.filter((n) => n.current.labelIds.includes(label.id)).length;
            return {
              label: label.name,
              checked: count === notes.length ? true : count ? 'indeterminate' : false,
              run: () =>
                mutate((d) => {
                  d.labelIds =
                    count === notes.length
                      ? d.labelIds.filter((id) => id !== label.id)
                      : [...new Set([...d.labelIds, label.id])];
                }),
            };
          })
        : [{ label: t('label.empty'), disabled: true }],
    },
    {
      label: t('context.color'),
      disabled,
      children: NOTE_COLORS.map((color) => ({
        label: t(`color.${color}`),
        checked: notes.every((n) => n.current.meta.color === color),
        run: () =>
          mutate((d) => {
            d.meta.color = color;
          }),
      })),
    },
    {
      label: t(
        bulk
          ? allArchived
            ? 'context.unarchiveAll'
            : 'context.archiveAll'
          : allArchived
            ? 'action.unarchive'
            : 'action.archive',
      ),
      disabled,
      run: () =>
        mutate((d) => {
          d.archived = !allArchived;
        }),
    },
    {
      label: t('action.trash'),
      danger: true,
      separator: true,
      disabled,
      run: () =>
        mutate((d) => {
          d.meta.trashedAt = new Date().toISOString();
        }),
    },
  ];
}
