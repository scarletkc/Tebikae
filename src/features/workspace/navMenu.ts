import { FolderOpen, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { MenuAction } from '../../app/ContextMenu';
import type { WorkspaceController } from './useWorkspaceController';

/** Right-click / long-press items for a primary destination, shared by the sidebar and bottom nav. */
export function navMenuItems(
  ctl: WorkspaceController,
  name: 'notes' | 'archive' | 'trash' | 'settings',
): MenuAction[] {
  const { t, session, notes, busy, online } = ctl;
  const open: MenuAction = {
    label: t(name === 'settings' ? 'action.openSettings' : 'action.open'),
    icon: name === 'settings' ? SettingsIcon : FolderOpen,
    run: () => {
      ctl.resetNavigationState();
      ctl.navigate(`/${name}`);
    },
  };
  if (name === 'notes')
    return [
      open,
      {
        label: t('action.new'),
        icon: Plus,
        separator: true,
        disabled: !session.writable,
        run: () => ctl.newNote(),
      },
    ];
  if (name === 'trash')
    return [
      open,
      {
        label: t('action.clearTrash'),
        icon: Trash2,
        separator: true,
        danger: true,
        disabled:
          !notes.some((note) => note.current.meta.trashedAt !== null) ||
          !session.writable ||
          !session.engine ||
          !online ||
          busy,
        run: () => void ctl.clearTrash(),
      },
    ];
  return [open];
}
