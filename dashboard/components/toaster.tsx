'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { SPRING_SNAPPY } from '@/lib/motion';

type Tone = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  tone: Tone;
  title: string;
  detail?: string;
}

interface ToastApi {
  toast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <Toaster>');
  return ctx;
}

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info } as const;
const ICON_CLASS = {
  success: 'text-positive',
  error: 'text-critical',
  info: 'text-accent',
} as const;

function ToastView({ item, onRemove }: { item: ToastItem; onRemove: (id: number) => void }) {
  const reduce = useReducedMotion();
  const Icon = ICONS[item.tone];
  useEffect(() => {
    const id = window.setTimeout(() => onRemove(item.id), item.tone === 'error' ? 9000 : 5000);
    return () => window.clearTimeout(id);
  }, [onRemove, item.id, item.tone]);

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.14 } }}
      transition={SPRING_SNAPPY}
      className="float pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] items-start gap-3 px-4 py-3"
      role={item.tone === 'error' ? 'alert' : 'status'}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ICON_CLASS[item.tone]}`} strokeWidth={1.75} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-fg">{item.title}</p>
        {item.detail && <p className="t-caption mt-0.5">{item.detail}</p>}
      </div>
      <button type="button" onClick={() => onRemove(item.id)} className="icon-btn -mr-2 -mt-1 h-7 w-7" aria-label="Dismiss notification">
        <X className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </motion.li>
  );
}

export function Toaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);

  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = next.current++;
    setItems((prev) => [...prev.slice(-3), { ...t, id }]);
  }, []);
  const remove = useCallback((id: number) => setItems((prev) => prev.filter((t) => t.id !== id)), []);
  const api = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ol
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[70] flex flex-col items-end gap-2 max-sm:left-4 max-sm:right-4"
      >
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <ToastView key={item.id} item={item} onRemove={remove} />
          ))}
        </AnimatePresence>
      </ol>
    </ToastContext.Provider>
  );
}
