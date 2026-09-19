import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { cn } from './utils';

export function CommandDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ui-command-overlay" />
        <DialogPrimitive.Content className="ui-command-dialog" aria-describedby={undefined}>
          <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Command({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('ui-command', className)} {...props} />;
}

export function CommandInput({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input className={cn('ui-command-input', className)} {...props} />;
}

export function CommandList({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('ui-command-list', className)} {...props} />;
}

export function CommandItem({ className, ...props }: ComponentPropsWithoutRef<'button'>) {
  return <button type="button" className={cn('ui-command-item', className)} {...props} />;
}
