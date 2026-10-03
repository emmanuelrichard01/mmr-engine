'use client';

import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { DURATION, EASE_OUT, SPRING_PANEL } from '@/lib/motion';
import { useModal } from '@/lib/use-modal';
import { cn } from '@/lib/utils';
import { Portal } from './portal';

// Right-hand drawer for detail views (transactions, pairs) and the mobile
// discrepancy view. Focus moves in, is trapped, Escape closes, and focus
// returns to whatever opened it.

function SheetPanel({
  onClose,
  title,
  subtitle,
  headerExtra,
  children,
  footer,
  width,
}: {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width: string;
}) {
  const ref = useModal<HTMLDivElement>(true, onClose);
  const titleId = useId();
  const reduce = useReducedMotion();

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <motion.div
        className="scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
      />
      <motion.div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col bg-panel outline-none sm:my-2 sm:mr-2 sm:h-[calc(100%-16px)] sm:rounded-[14px]',
          'shadow-[var(--shadow-overlay)]',
          width,
        )}
        initial={reduce ? { opacity: 0 } : { x: 32, opacity: 0 }}
        animate={reduce ? { opacity: 1 } : { x: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : { x: 24, opacity: 0, transition: { duration: DURATION.base, ease: EASE_OUT } }}
        transition={reduce ? { duration: DURATION.fast } : SPRING_PANEL}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-[17px] font-semibold tracking-[-0.01em] text-fg">
              {title}
            </h2>
            {subtitle && <div className="t-caption mt-1">{subtitle}</div>}
            {headerExtra && <div className="mt-3">{headerExtra}</div>}
          </div>
          <button type="button" onClick={onClose} className="icon-btn -mr-2" aria-label="Close" data-autofocus>
            <X className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer && <div className="border-t border-line">{footer}</div>}
      </motion.div>
    </div>
  );
}

export function Sheet({
  open,
  onClose,
  width = 'sm:max-w-[560px]',
  ...rest
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <Portal>
      <AnimatePresence>{open && <SheetPanel key="sheet" onClose={onClose} width={width} {...rest} />}</AnimatePresence>
    </Portal>
  );
}
