import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const buttonVariants = cva(
  [
    'inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium no-underline',
    'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    // No pointer-events-none: disabled buttons still need their title and surrounding context menu.
    'disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'border border-transparent bg-accent text-accent-fg hover:bg-accent-hover',
        secondary: 'border border-line bg-surface text-fg hover:bg-hover active:bg-active',
        ghost: 'border border-transparent bg-transparent text-fg hover:bg-hover active:bg-active',
        danger: 'border border-transparent bg-danger text-danger-fg hover:opacity-90',
        'danger-outline': 'border border-line bg-surface text-danger hover:bg-danger-soft',
        link: 'h-auto! border-0 bg-transparent px-0! text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-11 px-5 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Render the single child element (e.g. <a> or <Link>) with button styles. */
    asChild?: boolean;
  };

/**
 * The only button style in the app. Defaults to `type="button"`: pass `type="submit"`
 * explicitly for buttons that submit a form.
 */
export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return (
    <Component
      type={asChild ? undefined : (type ?? 'button')}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
