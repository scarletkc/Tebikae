import { NavLink } from 'react-router-dom';
import { Archive, NotebookPen, Settings, Trash2 } from 'lucide-react';
import { ContextMenu } from '../../app/ContextMenu';
import { navMenuItems } from './navMenu';
import { useWorkspace } from './useWorkspaceController';

const ITEMS = [
  ['notes', NotebookPen],
  ['archive', Archive],
  ['trash', Trash2],
  ['settings', Settings],
] as const;

/** Primary navigation bar on phones (<761px); sits below the FAB and toasts. */
export default function BottomNav() {
  const ctl = useWorkspace();
  const { t, resetNavigationState } = ctl;
  return (
    <nav
      className="bottom-nav fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-sidebar pb-[env(safe-area-inset-bottom)] select-none"
      aria-label={t('nav.menu')}
    >
      {ITEMS.map(([name, Icon]) => (
        <ContextMenu
          key={name}
          contextName={name === 'settings' ? 'settings' : `navigation-${name}`}
          items={navMenuItems(ctl, name)}
        >
          <NavLink
            to={`/${name}`}
            onClick={() => resetNavigationState()}
            className="flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-xs text-muted no-underline active:bg-active aria-[current=page]:text-accent"
          >
            <Icon size={22} aria-hidden="true" />
            {t(`nav.${name}`)}
          </NavLink>
        </ContextMenu>
      ))}
    </nav>
  );
}
