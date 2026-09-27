/**
 * Shared classes for every Radix dropdown/context menu. Use them on the Radix parts directly:
 *   <DropdownMenu.Content className={cn('my-hook-class', menuContent)}>
 *   <DropdownMenu.Item className={menuItem}>
 * Checked state looks the same everywhere: semibold text plus a trailing indicator
 * (<Check>, <Minus> for indeterminate) rendered through `menuIndicator` (docs/context-menus.md).
 */

/** Popover surface shared by menus and menu-like panels (e.g. the workspace status panel). */
export const menuSurface =
  'z-60 rounded-xl border border-line bg-surface text-sm text-fg shadow-popover outline-none ' +
  // Grow from the anchor so the menu's corner stays exactly at the pointer while animating.
  'origin-(--radix-dropdown-menu-content-transform-origin) data-[state=open]:animate-pop-in motion-reduce:animate-none';

export const menuContent =
  `${menuSurface} min-w-44 max-w-[min(240px,calc(100vw-16px))] ` +
  'max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height,70dvh))] overflow-y-auto p-1';

export const menuItem =
  'relative flex min-h-8 w-full cursor-default select-none items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 ' +
  'text-start text-sm text-fg no-underline outline-none data-[highlighted]:bg-hover ' +
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50 ' +
  'pointer-coarse:min-h-11 max-sm:min-h-11 ' +
  '[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted data-[highlighted]:[&_svg]:text-current ' +
  'data-[state=checked]:font-semibold data-[state=indeterminate]:font-semibold';

/** Single-choice item: same classes as `menuItem`; the check mark comes from menuIndicator. */
export const menuRadioItem = menuItem;

export const menuItemDanger = 'text-danger [&_svg]:text-danger data-[highlighted]:bg-danger-soft';

export const menuSeparator = 'mx-1 my-1 h-px bg-line';

export const menuLabel = 'px-2 py-1.5 text-xs font-medium text-muted';

/** Trailing check/dash mark for checked items (`menuRadioItem` and context-menu checkboxes). */
export const menuIndicator =
  'ms-auto flex size-4 items-center justify-center text-accent [&_svg]:text-accent!';
