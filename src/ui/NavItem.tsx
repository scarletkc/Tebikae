import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

const navItemVariants = cva(
  [
    'flex w-full min-w-0 items-center text-start text-fg no-underline transition-colors hover:no-underline',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-50',
  ],
  {
    variants: {
      variant: {
        /** Highlighted while it is the current page (aria-current) or an applied filter (aria-pressed). */
        row: [
          'nav-item gap-2 rounded-md px-2 hover:bg-hover active:bg-active',
          'aria-[current=page]:bg-active aria-[current=page]:font-medium aria-pressed:bg-active aria-pressed:font-medium',
        ],
        /** Bordered entry with room for two lines, such as the repository at the foot of the sidebar. */
        tile: 'gap-2.5 rounded-lg border border-line bg-canvas p-3 hover:bg-hover',
      },
      size: {
        md: 'h-8 text-sm',
        sm: 'h-7 text-xs',
      },
    },
    // Tiles grow with their content; listed last so it wins over the size height.
    compoundVariants: [{ variant: 'tile', class: 'h-auto' }],
    defaultVariants: { variant: 'row', size: 'md' },
  },
);

export type NavItemProps = ComponentProps<'button'> &
  VariantProps<typeof navItemVariants> & {
    /** Render the single child element (e.g. a router <NavLink>) with the row styles. */
    asChild?: boolean;
  };

/**
 * Full-width row in the sidebar and the mobile drawer: pages, label filters, the repository.
 * Pass `aria-pressed` for filters; a router <NavLink> sets `aria-current` itself.
 */
export function NavItem({ variant, size, asChild, className, type, ...props }: NavItemProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(navItemVariants({ variant, size }), className)}
      {...props}
    />
  );
}
