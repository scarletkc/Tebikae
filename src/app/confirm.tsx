import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog } from '../ui';

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
  const [pending, setPending] = useState<PendingConfirm | null>(null);
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
    <ConfirmDialog
      open={!!pending}
      title={pending?.title ?? ''}
      description={pending?.description}
      confirmLabel={pending?.confirmLabel}
      cancelLabel={pending?.cancelLabel}
      danger={pending?.danger}
      onSettle={settle}
    />
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
