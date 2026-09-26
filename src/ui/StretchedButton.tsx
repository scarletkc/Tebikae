import type { ComponentProps } from 'react';
import { cn } from './cn';

/**
 * A card's title as a button whose click area covers the whole card, so the card opens from
 * anywhere while screen readers hear only the title. The card needs `relative`; other controls
 * inside it need `relative z-2` to stay on top of the click area.
 */
export function StretchedButton({ className, type, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type ?? 'button'}
      className={cn(
        'm-0 w-full cursor-pointer border-0 bg-transparent p-0 text-start outline-none',
        "after:absolute after:inset-0 after:z-1 after:rounded-xl after:content-['']",
        'focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent',
        className,
      )}
      {...props}
    />
  );
}
