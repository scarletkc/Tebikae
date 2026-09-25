import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge the project's custom shadow names (src/styles/theme.css) so that
// `shadow-popover` is treated as a shadow size rather than a shadow color.
const twMerge = extendTailwindMerge({
  extend: { theme: { shadow: ['card-hover', 'popover', 'dialog'] } },
});

/** Merge class names; later Tailwind classes override earlier conflicting ones. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
