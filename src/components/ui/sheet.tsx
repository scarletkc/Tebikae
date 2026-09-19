import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef } from 'react';
import { X } from 'lucide-react';
import { cn } from './utils';

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetPortal({ children }: { children: React.ReactNode }) {
  return <DialogPrimitive.Portal>{children}</DialogPrimitive.Portal>;
}

export function SheetOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn('ui-sheet-overlay', className)} {...props} />;
}

export function SheetContent({
  side = 'right',
  className,
  children,
  showClose = false,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: 'top' | 'right' | 'bottom' | 'left';
  showClose?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content className={cn('ui-sheet-content', `ui-sheet-${side}`, className)} {...props}>
        {children}
        {showClose && (
          <DialogPrimitive.Close className="ui-sheet-close" aria-label="Close">
            <X size={18} />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;
