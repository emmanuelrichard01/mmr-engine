'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { X, ArrowRight, ArrowLeft, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Tour Step Definition ─────────────────────────────────────────────

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target: string;
  /** Tooltip title */
  title: string;
  /** Tooltip description */
  description: string;
  /** Preferred placement relative to the target */
  placement?: 'top' | 'bottom' | 'left' | 'right';
}

// ── Default Overview Tour Steps ──────────────────────────────────────

export const OVERVIEW_TOUR: TourStep[] = [
  {
    target: '[data-tour="kpi-cards"]',
    title: 'Key Metrics at a Glance',
    description:
      'These four cards show your most critical numbers: match rate, financial exposure, pending issues, and today\'s transaction volume. The sparklines reveal 7-day trends.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="match-trend"]',
    title: 'Match Rate Trend',
    description:
      'This chart tracks your daily match rate over 30 days. A sustained drop below 97% signals webhook gaps or PSP settlement delays that need investigation.',
    placement: 'top',
  },
  {
    target: '[data-tour="exposure-chart"]',
    title: 'Exposure by PSP',
    description:
      'See which payment provider has the most unresolved exposure. Higher bars mean more money at risk — prioritize investigation on those PSPs.',
    placement: 'top',
  },
  {
    target: '[data-tour="recent-discrepancies"]',
    title: 'Recent Discrepancies',
    description:
      'The latest flagged transactions sorted by age. Click any row to see details. Critical items appear in red — these need immediate attention.',
    placement: 'top',
  },
];

// ── Walkthrough Context ──────────────────────────────────────────────

interface WalkthroughContextType {
  isActive: boolean;
  currentStep: number;
  totalSteps: number;
  startTour: (steps?: TourStep[]) => void;
  endTour: () => void;
  nextStep: () => void;
  prevStep: () => void;
}

const WalkthroughContext = createContext<WalkthroughContextType>({
  isActive: false,
  currentStep: 0,
  totalSteps: 0,
  startTour: () => {},
  endTour: () => {},
  nextStep: () => {},
  prevStep: () => {},
});

export const useWalkthrough = () => useContext(WalkthroughContext);

// ── Provider ─────────────────────────────────────────────────────────

interface WalkthroughProviderProps {
  children: ReactNode;
}

export function WalkthroughProvider({ children }: WalkthroughProviderProps) {
  const [isActive, setIsActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [steps, setSteps] = useState<TourStep[]>([]);

  const startTour = useCallback((tourSteps?: TourStep[]) => {
    const s = tourSteps || OVERVIEW_TOUR;
    setSteps(s);
    setCurrentStep(0);
    setIsActive(true);
  }, []);

  const endTour = useCallback(() => {
    setIsActive(false);
    setCurrentStep(0);
    setSteps([]);
  }, []);

  const nextStep = useCallback(() => {
    setCurrentStep((prev) => {
      if (prev >= steps.length - 1) {
        setIsActive(false);
        return 0;
      }
      return prev + 1;
    });
  }, [steps.length]);

  const prevStep = useCallback(() => {
    setCurrentStep((prev) => Math.max(0, prev - 1));
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') endTour();
      if (e.key === 'ArrowRight') nextStep();
      if (e.key === 'ArrowLeft') prevStep();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isActive, endTour, nextStep, prevStep]);

  return (
    <WalkthroughContext.Provider
      value={{
        isActive,
        currentStep,
        totalSteps: steps.length,
        startTour,
        endTour,
        nextStep,
        prevStep,
      }}
    >
      {children}
      {isActive && steps.length > 0 && (
        <WalkthroughOverlay
          step={steps[currentStep]}
          stepIndex={currentStep}
          totalSteps={steps.length}
          onNext={nextStep}
          onPrev={prevStep}
          onSkip={endTour}
        />
      )}
    </WalkthroughContext.Provider>
  );
}

// ── Spotlight Overlay ────────────────────────────────────────────────

interface OverlayProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

function WalkthroughOverlay({
  step,
  stepIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
}: OverlayProps) {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 });
  const [fadeIn, setFadeIn] = useState(false);

  // Find and scroll to the target element
  useEffect(() => {
    setFadeIn(false);

    const findTarget = () => {
      const el = document.querySelector(step.target);
      if (!el) return null;

      // Scroll into view smoothly
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Wait for scroll to settle
      setTimeout(() => {
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
        setFadeIn(true);
      }, 350);

      return el;
    };

    // Retry until target is found (it may be rendering)
    const attempts = [0, 100, 300, 600];
    attempts.forEach((delay) => {
      setTimeout(() => {
        if (!targetRect) findTarget();
      }, delay);
    });

    const el = findTarget();
    if (!el) {
      // If target not found, show tooltip centered
      setTargetRect(null);
      setFadeIn(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.target, stepIndex]);

  // Position tooltip relative to target
  useEffect(() => {
    if (!targetRect) {
      // Center fallback
      setTooltipPos({
        top: window.innerHeight / 2 - 100,
        left: window.innerWidth / 2 - 180,
      });
      return;
    }

    const pad = 16;
    const tooltipW = 360;
    const tooltipH = 200;
    const placement = step.placement || 'bottom';

    let top = 0;
    let left = 0;

    switch (placement) {
      case 'bottom':
        top = targetRect.bottom + pad;
        left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
        break;
      case 'top':
        top = targetRect.top - tooltipH - pad;
        left = targetRect.left + targetRect.width / 2 - tooltipW / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.left - tooltipW - pad;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipH / 2;
        left = targetRect.right + pad;
        break;
    }

    // Keep within viewport
    left = Math.max(16, Math.min(left, window.innerWidth - tooltipW - 16));
    top = Math.max(16, Math.min(top, window.innerHeight - tooltipH - 16));

    setTooltipPos({ top, left });
  }, [targetRect, step.placement]);

  const isLast = stepIndex === totalSteps - 1;

  return (
    <div className="fixed inset-0 z-[9999]">
      {/* Backdrop with spotlight cutout */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {targetRect && (
              <rect
                x={targetRect.left - 8}
                y={targetRect.top - 8}
                width={targetRect.width + 16}
                height={targetRect.height + 16}
                rx={12}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.5)"
          mask="url(#spotlight-mask)"
          style={{ pointerEvents: 'all' }}
          onClick={onSkip}
        />
      </svg>

      {/* Spotlight ring glow */}
      {targetRect && (
        <div
          className="absolute rounded-xl border-2 border-indigo-400/60 shadow-[0_0_0_4000px_rgba(0,0,0,0)] transition-all duration-500 pointer-events-none"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
            boxShadow: '0 0 30px rgba(99, 102, 241, 0.3), 0 0 60px rgba(99, 102, 241, 0.1)',
          }}
        />
      )}

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className={cn(
          'absolute z-10 w-[360px] transition-all duration-300',
          fadeIn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
        )}
        style={{ top: tooltipPos.top, left: tooltipPos.left }}
      >
        <div className="relative rounded-2xl bg-[var(--color-surface-50)]/98 backdrop-blur-2xl border border-[var(--color-surface-200)]/80 shadow-2xl shadow-black/[0.15] overflow-hidden">
          {/* Accent line */}
          <div className="h-[2px] bg-gradient-to-r from-indigo-500 via-violet-500 to-indigo-400" />

          {/* Content */}
          <div className="px-5 pt-4 pb-3">
            {/* Step counter */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-1.5">
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'h-1.5 rounded-full transition-all duration-300',
                      i === stepIndex
                        ? 'w-6 bg-gradient-to-r from-indigo-500 to-violet-500'
                        : i < stepIndex
                          ? 'w-1.5 bg-indigo-400/60'
                          : 'w-1.5 bg-[var(--color-surface-300)]'
                    )}
                  />
                ))}
              </div>
              <button
                onClick={onSkip}
                className="p-1 rounded-md text-[var(--color-surface-400)] hover:text-[var(--color-surface-600)] hover:bg-[var(--color-surface-200)]/60 transition-all"
                aria-label="Close tour"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <h3 className="text-sm font-bold text-[var(--color-surface-900)] mb-1.5">
              {step.title}
            </h3>
            <p className="text-xs text-[var(--color-surface-600)] leading-relaxed">
              {step.description}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-surface-200)]/60 bg-[var(--color-surface-100)]/50">
            <button
              onClick={onSkip}
              className="flex items-center gap-1 text-[11px] text-[var(--color-surface-500)] hover:text-[var(--color-surface-700)] transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              Skip tour
            </button>

            <div className="flex items-center gap-2">
              {stepIndex > 0 && (
                <button
                  onClick={onPrev}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-surface-600)] hover:bg-[var(--color-surface-200)]/60 transition-all"
                >
                  <ArrowLeft className="w-3 h-3" />
                  Back
                </button>
              )}
              <button
                onClick={onNext}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 shadow-md shadow-indigo-500/20 transition-all"
              >
                {isLast ? 'Finish' : 'Next'}
                {!isLast && <ArrowRight className="w-3 h-3" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
