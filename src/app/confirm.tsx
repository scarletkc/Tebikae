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

/** Promise-based replacement for window.confirm, rendered as an app dialog. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  if (ask) return ask(options);
  return Promise.resolve(window.confirm(options.title));
}

export function ConfirmDialogHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ask = (options) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      });
    return () => {
      ask = null;
    };
  }, []);

  const settle = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

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
            role="alertdialog"
            aria-modal="true"
            aria-label={pending.title}
            className="confirm-dialog"
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Escape') settle(false);
            }}
            ref={(node) => {
              if (node) setTimeout(() => confirmRef.current?.focus(), 0);
            }}
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
