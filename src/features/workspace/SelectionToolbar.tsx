import { ContextMenu } from '../../app/ContextMenu';
import { noteActions } from '../notes/actions';
import { useWorkspace } from './useWorkspaceController';
import { X } from 'lucide-react';
import { Button, IconButton } from '../../ui';

/** Bulk actions for the notes currently selected in the list. */
export default function SelectionToolbar() {
  const { t, multi, selectedNotes, labels, session, mutateNotes } = useWorkspace();
  if (!multi.selectedCount) return null;
  return (
    <div
      className="selection-toolbar sticky top-0 z-12 mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3 [@media(pointer:coarse)]:top-auto [@media(pointer:coarse)]:bottom-2 max-[600px]:top-auto max-[600px]:bottom-2"
      role="toolbar"
      aria-label={t('context.selection')}
    >
      <IconButton size="sm" label={t('action.close')} onClick={multi.clear}>
        <X size={16} />
      </IconButton>
      <strong>{t('context.selectedCount', { count: multi.selectedCount })}</strong>
      <Button onClick={multi.selectAll}>{t('context.selectAll')}</Button>
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
          <Button
            key={action.label}
            variant={action.danger ? 'danger-outline' : 'secondary'}
            disabled={action.disabled}
            onClick={action.run}
          >
            {action.label}
          </Button>
        ),
      )}
    </div>
  );
}
