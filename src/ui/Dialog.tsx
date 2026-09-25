import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from './cn';
import { IconButton } from './IconButton';

export const dialogSizes = { sm: 'md:max-w-sm', md: 'md:max-w-lg', lg: 'md:max-w-2xl' } as const;
export type DialogSize = keyof typeof dialogSizes;

export const dialogOverlayClass =
  'fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in motion-reduce:animate-none';

/** Bottom sheet below 761px, centered card from 761px up. */
export function dialogContentClass(size: DialogSize = 'md') {
  return cn(
    'fixed z-50 flex flex-col overflow-hidden bg-surface text-fg shadow-dialog outline-none',
    // Phone: bottom sheet.
    'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-sheet-in',
    // Tablet and desktop: centered.
    'md:inset-auto md:top-1/2 md:left-1/2 md:max-h-[85dvh] md:w-[calc(100vw-32px)] md:-translate-x-1/2 md:-translate-y-1/2',
    'md:rounded-2xl md:border md:border-line md:pb-0 md:data-[state=open]:animate-pop-in',
    'motion-reduce:animate-none',
    dialogSizes[size],
  );
}

/**
 * Modal dialog that is always open while mounted; unmount it (or call onClose) to close.
 * Clicking outside does not close it, so half-filled forms are not lost.
 */
export function Dialog({
  title,
  onClose,
  children,
  footer,
  size = 'md',
  className,
  bodyClassName,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  /** Right-aligned action row pinned below the scrolling body. */
  footer?: ReactNode;
  size?: DialogSize;
  /** Extra classes (e.g. legacy hook classes) for the dialog element. */
  className?: string;
  bodyClassName?: string;
}) {
  const { t } = useTranslation();
  return (
    <RadixDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn('dialog-overlay', dialogOverlayClass)} />
        <RadixDialog.Content
          className={cn('dialog', dialogContentClass(size), className)}
          aria-describedby={undefined}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="dialog-header flex shrink-0 items-center justify-between gap-3 border-b border-line py-2 ps-5 pe-3">
            <RadixDialog.Title className="text-base font-semibold text-fg">{title}</RadixDialog.Title>
            <IconButton label={t('action.close')} onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>
          <div className={cn('min-h-0 flex-1 overflow-y-auto p-5', bodyClassName)}>{children}</div>
          {footer && (
            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </div>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Left-edge navigation drawer (mobile sidebar). */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Screen-reader title. */
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={cn('dialog-overlay', dialogOverlayClass)} />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar text-fg shadow-dialog outline-none',
            'pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] ps-[max(1.25rem,env(safe-area-inset-left))] pe-5',
            'data-[state=open]:animate-drawer-in motion-reduce:animate-none',
            className,
          )}
        >
          <RadixDialog.Title className="sr-only">{title}</RadixDialog.Title>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
