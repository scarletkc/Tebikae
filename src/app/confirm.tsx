import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useTranslation } from 'react-i18next';
import { Button, cn, dialogContentClass, dialogOverlayClass } from '../ui';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

let ask: ((options: ConfirmOptions) => Promise<boolean>) | null = null;
let isConfirmOpen = false;
let lastInteractionTarget: HTMLElement | null = null;

if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as HTMLElement | null;
      lastInteractionTarget =
        target?.closest<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex], [role="button"]',
        ) || target;
    },
    true,
  );
}

export function isConfirmDialogOpen(): boolean {
  return isConfirmOpen;
}

/** Promise-based replacement for window.confirm, rendered as an app dialog. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (ask) return ask(options);
  return Promise.resolve(window.confirm(options.title));
}

export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ask = (options) =>
      new Promise<boolean>((resolve) => {
        const active = document.activeElement as HTMLElement | null;
        // Menus close before the dialog opens, so fall back to the element that was clicked.
        previousFocusRef.current =
          active && active !== document.body ? active : lastInteractionTarget || active || null;
        isConfirmOpen = true;
        setPending({ ...options, resolve });
      });
    return () => {
      ask = null;
      isConfirmOpen = false;
    };
  }, []);

  const settle = (value: boolean) => {
    if (!pending) return;
    isConfirmOpen = false;
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    setPending(null);
    pending.resolve(value);
    requestAnimationFrame(() => {
      prev?.focus?.();
    });
    setTimeout(() => {
      prev?.focus?.();
    }, 16);
  };

  return (
    <AlertDialog.Root
      open={!!pending}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className={cn('confirm-overlay', dialogOverlayClass, 'z-55')}
          onClick={() => settle(false)}
        />
        <AlertDialog.Content
          className={cn(
            'confirm-dialog',
            dialogContentClass('sm'),
            'z-55 gap-2 p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:pb-6',
          )}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            confirmRef.current?.focus();
          }}
          // Focus goes back to the control that asked, handled in settle().
          onCloseAutoFocus={(event) => event.preventDefault()}
          {...(pending?.description ? {} : { 'aria-describedby': undefined })}
        >
          {pending && (
            <>
              <AlertDialog.Title className="confirm-title text-base font-semibold text-fg [overflow-wrap:anywhere]">
                {pending.title}
              </AlertDialog.Title>
              {pending.description && (
                <AlertDialog.Description className="confirm-description text-sm text-muted [overflow-wrap:anywhere]">
                  {pending.description}
                </AlertDialog.Description>
              )}
              <div className="confirm-actions mt-4 flex flex-wrap justify-end gap-2">
                <Button onClick={() => settle(false)}>{pending.cancelLabel || t('action.cancel')}</Button>
                <Button
                  ref={confirmRef}
                  variant={pending.danger ? 'danger' : 'primary'}
                  onClick={() => settle(true)}
                >
                  {pending.confirmLabel || t('action.confirm')}
                </Button>
              </div>
            </>
          )}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <ConfirmDialogHost />
    </>
  );
}
