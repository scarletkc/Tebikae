import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const bannerVariants = cva(
  'flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg px-3 py-2.5 text-sm leading-relaxed text-fg [&>p]:m-0 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      tone: {
        info: 'bg-hover [&_svg]:text-muted',
        warning: 'bg-warning-soft [&_svg]:text-warning',
        danger: 'bg-danger-soft [&_svg]:text-danger',
        success: 'bg-accent-soft [&_svg]:text-accent',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

/**
 * Inline status message. Keep legacy hook classes (`banner`, `banner warning`, `error-box`) via
 * className when replacing old markup. Add role="alert" for errors that appear after an action.
 */
export function Banner({
  tone,
  className,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof bannerVariants>) {
  return <div className={cn(bannerVariants({ tone }), className)} {...props} />;
}
