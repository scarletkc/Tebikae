import type { TFunction } from 'i18next';
import { CheckSquare, Copy, Link, Pencil, Trash2 } from 'lucide-react';
import type { MenuAction } from '../../app/ContextMenu';
import type { Label, LocalNote, NoteDocument } from '../../domain/types';
import { safeHref } from '../../security/urls';
import { noteActions } from '../notes/actions';

/** Context menu for a note card; acts on the whole selection when the card is selected. */
export function buildNoteMenu(
  note: LocalNote,
  {
    t,
    labels,
    writable,
    targets,
    canPurge,
    mutate,
    purge,
    open,
    select,
    report,
  }: {
    t: TFunction;
    labels: Label[];
    writable: boolean;
    /** The selected notes when `note` is part of the selection, otherwise just `note`. */
    targets: LocalNote[];
    canPurge: boolean;
    mutate(targets: LocalNote[], edit: (doc: NoteDocument) => void): void;
    purge(note: LocalNote): void;
    open(note: LocalNote): void;
    select(localId: string): void;
    report(error: unknown): void;
  },
): MenuAction[] {
  const actions = noteActions(targets, labels, writable, t, (edit) => mutate(targets, edit));
  if (note.current.meta.trashedAt)
    return [
      ...actions,
      {
        label: t('action.deleteForever'),
        icon: Trash2,
        danger: true,
        separator: true,
        disabled: targets.length > 1 || !canPurge,
        run: () => purge(note),
      },
    ];
  if (targets.length > 1) return actions;
  const trash = actions.pop()!;
  return [
    { label: t('action.edit'), icon: Pencil, run: () => open(note) },
    ...actions,
    {
      label: t('context.copyContent'),
      icon: Copy,
      separator: true,
      run: () => void navigator.clipboard.writeText(note.current.markdown).catch(report),
    },
    ...(safeHref(note.base?.url ?? '')
      ? [
          {
            label: t('context.copyNoteLink'),
            icon: Link,
            run: () => void navigator.clipboard.writeText(note.base!.url).catch(report),
          },
        ]
      : []),
    { label: t('context.select'), icon: CheckSquare, run: () => select(note.localId) },
    trash,
  ];
}
