import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Check, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type ToastItem = { id: number; message: string };
type ToastContextValue = { push(message: string): void };
const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const reducedMotion = useReducedMotion();
  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);
  const push = useCallback(
    (message: string) => {
      const id = ++nextId.current;
      setItems((current) => [...current.slice(-2), { id, message }]);
      window.setTimeout(() => dismiss(id), 2800);
    },
    [dismiss],
  );
  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="toast-layer" aria-live="polite" aria-atomic="false">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              className="app-toast"
              initial={reducedMotion ? false : { opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
              transition={{ duration: reducedMotion ? 0 : 0.16, ease: 'easeOut' }}
              role="status"
            >
              <Check size={16} aria-hidden="true" />
              <span>{item.message}</span>
              <button type="button" aria-label={t('action.close')} onClick={() => dismiss(item.id)}>
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
