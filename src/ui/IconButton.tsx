import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export const iconButtonVariants = cva(
  [
    'icon-button inline-flex shrink-0 cursor-pointer select-none items-center justify-center rounded-lg border-0 p-0 text-muted',
    'transition-colors hover:bg-hover hover:text-fg active:bg-active',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted',
    'aria-pressed:bg-active aria-pressed:text-fg [&.selected]:bg-active [&.selected]:text-fg',
  ],
  {
    variants: {
      variant: {
        ghost: 'bg-transparent',
        secondary: 'border border-line bg-surface',
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
    children: ReactNode;
  };

/** Square icon-only button. Always carries `title` and `aria-label`. */
export function IconButton({ label, pressed, variant, size, className, type, ...props }: IconButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
