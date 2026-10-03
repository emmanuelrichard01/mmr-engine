'use client';

import { useId, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { useModal } from '@/lib/use-modal';
import { cn } from '@/lib/utils';
import { Portal } from './portal';

function DialogPanel({
  onClose,
  title,
  description,
  children,
  className,
  position,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  position: 'center' | 'top';
}) {
  const ref = useModal<HTMLDivElement>(true, onClose);
  const titleId = useId();
  const descId = useId();
  const reduce = useReducedMotion();

  return (
    <div className={cn('fixed inset-0 z-[60] flex justify-center px-4', position === 'top' ? 'items-start pt-[12vh]' : 'items-center')}>
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
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn('overlay relative w-full max-w-[480px] outline-none', className)}
        initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -6 }}
        animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
      >
        <div className="px-6 pb-0 pt-5">
          <h2 id={titleId} className="t-title text-[16px]">
            {title}
          </h2>
          {description && (
            <p id={descId} className="t-body mt-1 text-[13px]">
              {description}
            </p>
          )}
        </div>
        {children}
      </motion.div>
    </div>
  );
}

export function Dialog({
  open,
  onClose,
  position = 'center',
  ...rest
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  position?: 'center' | 'top';
}) {
  return (
    <Portal>
      <AnimatePresence>{open && <DialogPanel key="dialog" onClose={onClose} position={position} {...rest} />}</AnimatePresence>
    </Portal>
  );
}
