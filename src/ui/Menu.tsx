import * as Radix from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import type { ComponentProps } from 'react';
import { buttonVariants } from './Button';
import { cn } from './cn';
import {
  menuContent,
  menuIndicator,
  menuItem,
  menuItemDanger,
  menuLabel,
  menuRadioItem,
  menuSeparator,
  menuSurface,
} from './menuClasses';

/**
 * Dropdown menu built from kit parts; the trigger is always a kit button:
 *   <Menu>
 *     <MenuTrigger><IconButton label={t('context.more')}><MoreHorizontal /></IconButton></MenuTrigger>
 *     <MenuContent align="end"><MenuItem onSelect={pin}><Pin /> {t('action.pin')}</MenuItem></MenuContent>
 *   </Menu>
 * Right-click menus go through src/app/ContextMenu.tsx instead.
 */
export const Menu = Radix.Root;

/** Renders its only child (a <Button> or <IconButton>) as the trigger. */
export function MenuTrigger(props: Omit<ComponentProps<typeof Radix.Trigger>, 'asChild'>) {
  return <Radix.Trigger asChild {...props} />;
}

/** The floating list. `panel` makes an information panel instead: no item padding or width cap. */
export function MenuContent({
  className,
  panel = false,
  sideOffset = 6,
  ...props
}: ComponentProps<typeof Radix.Content> & { panel?: boolean }) {
  return (
    <Radix.Portal>
      <Radix.Content
        sideOffset={sideOffset}
        className={cn(panel ? menuSurface : menuContent, className)}
        {...props}
      />
    </Radix.Portal>
  );
}

export function MenuItem({
  className,
  danger = false,
  ...props
}: ComponentProps<typeof Radix.Item> & { danger?: boolean }) {
  return <Radix.Item className={cn(menuItem, danger && menuItemDanger, className)} {...props} />;
}

/** Small button-shaped item for actions inside a `panel` (for example "Reconnect" in a notice). */
export function MenuButtonItem({ className, ...props }: ComponentProps<typeof Radix.Item>) {
  return (
    <Radix.Item
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        'w-fit outline-none data-[highlighted]:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof Radix.Separator>) {
  return <Radix.Separator className={cn(menuSeparator, className)} {...props} />;
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof Radix.Label>) {
  return <Radix.Label className={cn(menuLabel, className)} {...props} />;
}

export const MenuRadioGroup = Radix.RadioGroup;

/** Single-choice item: the selected one shows a trailing check mark. */
export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof Radix.RadioItem>) {
  return (
    <Radix.RadioItem className={cn(menuRadioItem, className)} {...props}>
      {children}
      <Radix.ItemIndicator className={menuIndicator}>
        <Check aria-hidden="true" />
      </Radix.ItemIndicator>
    </Radix.RadioItem>
  );
}

/** Round color choice in a MenuRadioGroup. Give it the color's `bg-card-*` class and a label. */
export function MenuSwatchItem({ className, ...props }: ComponentProps<typeof Radix.RadioItem>) {
  return (
    <Radix.RadioItem
      className={cn(
        'grid size-7 cursor-pointer place-items-center rounded-full border border-line text-fg outline-none',
        'data-[highlighted]:outline-2 data-[highlighted]:outline-offset-2 data-[highlighted]:outline-accent',
        'data-[state=checked]:outline-2 data-[state=checked]:outline-offset-2 data-[state=checked]:outline-accent',
        'data-[disabled]:cursor-default data-[disabled]:opacity-40',
        className,
      )}
      {...props}
    >
      <Radix.ItemIndicator>
        <Check size={14} aria-hidden="true" />
      </Radix.ItemIndicator>
    </Radix.RadioItem>
  );
}
