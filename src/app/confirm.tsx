import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslation } from 'react-i18next';

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
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    ask = (options) =>
      new Promise<boolean>((resolve) => {
        const active = document.activeElement as HTMLElement | null;
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
    isConfirmOpen = false;
    const resolver = pending?.resolve;
    const prev = previousFocusRef.current;
    previousFocusRef.current = null;
    setPending(null);
    resolver?.(value);
    requestAnimationFrame(() => {
      prev?.focus?.();
    });
    setTimeout(() => {
      prev?.focus?.();
    }, 16);
  };

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      confirmRef.current?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        settle(false);
        return;
      }
      if (event.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => element.offsetParent !== null || element === document.activeElement);
        if (!focusable.length) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement;
        if (event.shiftKey) {
          if (active === first || !dialog.contains(active)) {
            event.preventDefault();
            event.stopPropagation();
            last.focus();
          }
        } else {
          if (active === last || !dialog.contains(active)) {
            event.preventDefault();
            event.stopPropagation();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [pending]);

  return (
    <AnimatePresence>
      {pending && (
        <motion.div
          className="confirm-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          onClick={() => settle(false)}
        >
          <motion.div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
            className="confirm-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
            tabIndex={-1}
          >
            <h2 className="confirm-title">{pending.title}</h2>
            {pending.description && <p className="confirm-description">{pending.description}</p>}
            <div className="confirm-actions">
              <button className="button secondary" onClick={() => settle(false)}>
                {pending.cancelLabel || t('action.cancel')}
              </button>
              <button
                ref={confirmRef}
                className={`button ${pending.danger ? 'danger primary' : 'primary'}`}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel || t('action.confirm')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
