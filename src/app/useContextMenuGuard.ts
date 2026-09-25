import { useEffect } from 'react';

/**
 * Suppresses the browser's native context menu where the app defines none. Shift+right-click,
 * menus, dialogs and editable text keep the native menu.
 */
export function preventUndefinedContextMenu(event: {
  target: EventTarget | null;
  shiftKey: boolean;
  preventDefault(): void;
}) {
  if (event.shiftKey) return;
  const target = event.target;
  if (
    target instanceof Element &&
    target.closest(
      '[role="menu"], [role="dialog"], input, textarea, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return;
  event.preventDefault();
}

export function useContextMenuGuard() {
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      preventUndefinedContextMenu(event);
    };
    document.addEventListener('contextmenu', handle);
    return () => document.removeEventListener('contextmenu', handle);
  }, []);
}
