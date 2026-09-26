import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const iconButtonVariants = cva(
  [
    'icon-button inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-lg border-0 p-0 text-muted',
    'transition-colors hover:bg-hover hover:text-fg active:bg-active',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted',
    // Selected looks: toggles (aria-pressed), open menus and panels, and the current page's nav link.
    'aria-pressed:bg-active aria-pressed:text-fg aria-expanded:bg-active aria-expanded:text-fg [&.selected]:bg-active [&.selected]:text-fg',
    'data-[state=open]:bg-active data-[state=open]:text-fg aria-[current=page]:bg-active aria-[current=page]:text-fg',
  ],
  {
    variants: {
      variant: {
        ghost: 'bg-transparent',
        secondary: 'border border-line bg-surface',
        /** Highlights a control whose setting is in effect, e.g. the filter button with active filters. */
        accent: 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent',
      },
      size: {
        xs: 'size-7',
        sm: 'size-8',
        md: 'size-9',
      },
    },
    defaultVariants: { variant: 'ghost', size: 'md' },
  },
);

export type IconButtonProps = Omit<ComponentProps<'button'>, 'children'> &
  VariantProps<typeof iconButtonVariants> & {
    /** Accessible name; also shown as the native tooltip. */
    label: string;
    /** Toggle state; sets aria-pressed. Leave undefined for plain actions. */
    pressed?: boolean;
    /** Render the single child element (e.g. a router <NavLink>) with icon-button styles. */
    asChild?: boolean;
    children: ReactNode;
  };

/**
 * Square icon-only button. Always carries `title` and `aria-label`. Menu triggers wrap it:
 * <MenuTrigger><IconButton label=…>…</IconButton></MenuTrigger>.
 */
export function IconButton({
  label,
  pressed,
  variant,
  size,
  className,
  type,
  asChild,
  ...props
}: IconButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      type={asChild ? undefined : (type ?? 'button')}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
