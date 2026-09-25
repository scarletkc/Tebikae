import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { cn, IconButton } from '../ui';

export type ToastKind = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
};

type ToastContextValue = {
  toast(message: string, kind?: ToastKind): void;
};

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

const ICONS: Record<ToastKind, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ICON_TONE: Record<ToastKind, string> = {
  success: 'text-accent',
  error: 'text-danger',
  info: 'text-muted',
};

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-3), { id, kind, message }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), 3600),
      );
    },
    [dismiss],
  );

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="toast-layer pointer-events-none fixed right-4 bottom-4 z-70 flex max-w-[calc(100vw-2rem)] flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label={t('toast.region')}
      >
        <AnimatePresence initial={false}>
          {toasts.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <motion.div
                key={item.id}
                className={cn(
                  'toast pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-popover',
                  `toast-${item.kind}`,
                )}
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                role="status"
              >
                <Icon size={16} aria-hidden="true" className={cn('shrink-0', ICON_TONE[item.kind])} />
                <span className="toast-message min-w-0 flex-1">{item.message}</span>
                <IconButton
                  size="xs"
                  className="toast-close -my-1 -mr-1"
                  label={t('toast.dismiss')}
                  onClick={() => dismiss(item.id)}
                >
                  <X size={14} />
                </IconButton>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
