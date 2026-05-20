'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Step {
  label: string;
  description?: string;
}

interface StepperProps {
  steps: Step[];
  currentStep: number; // 0-indexed
  className?: string;
}

export function Stepper({ steps, currentStep, className }: StepperProps) {
  return (
    <div className={cn('w-full', className)}>
      {/* Desktop: horizontal stepper */}
      <div className="hidden sm:flex items-center justify-between relative">
        {/* Connecting line background */}
        <div className="absolute top-5 left-[calc(100%/(2*var(--steps)))] right-[calc(100%/(2*var(--steps)))] h-0.5 bg-[var(--color-surface-200)]"
          style={{ '--steps': steps.length } as React.CSSProperties}
        />
        {/* Active connecting line */}
        <div
          className="absolute top-5 left-[calc(100%/(2*var(--steps)))] h-0.5 bg-gradient-to-r from-[var(--color-primary-500)] to-[var(--color-primary-400)] transition-all duration-500 ease-out"
          style={{
            '--steps': steps.length,
            width: `${Math.max(0, ((currentStep) / (steps.length - 1)) * (100 - 100 / steps.length))}%`,
          } as React.CSSProperties}
        />

        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const isUpcoming = index > currentStep;

          return (
            <div
              key={index}
              className="relative flex flex-col items-center z-10"
              style={{ flex: 1 }}
            >
              {/* Circle */}
              <div
                className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-full border-2 transition-all duration-300',
                  isCompleted &&
                    'bg-[var(--color-primary-500)] border-[var(--color-primary-500)] text-white',
                  isActive &&
                    'bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)] text-[var(--color-primary-500)] ring-4 ring-[var(--color-primary-500)]/20',
                  isUpcoming &&
                    'bg-[var(--color-surface-100)] border-[var(--color-surface-300)] text-[var(--color-surface-400)]'
                )}
              >
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-semibold">{index + 1}</span>
                )}
              </div>

              {/* Label */}
              <span
                className={cn(
                  'mt-2 text-xs font-medium text-center transition-colors duration-300',
                  isActive
                    ? 'text-[var(--color-primary-400)]'
                    : isCompleted
                    ? 'text-[var(--color-surface-700)]'
                    : 'text-[var(--color-surface-400)]'
                )}
              >
                {step.label}
              </span>

              {/* Description */}
              {step.description && (
                <span className="mt-0.5 text-[10px] text-[var(--color-surface-400)] text-center max-w-[100px]">
                  {step.description}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile: vertical stepper */}
      <div className="sm:hidden flex flex-col gap-3">
        {steps.map((step, index) => {
          const isCompleted = index < currentStep;
          const isActive = index === currentStep;
          const isUpcoming = index > currentStep;

          return (
            <div key={index} className="flex items-center gap-3">
              <div
                className={cn(
                  'flex items-center justify-center w-8 h-8 rounded-full border-2 shrink-0 transition-all duration-300',
                  isCompleted &&
                    'bg-[var(--color-primary-500)] border-[var(--color-primary-500)] text-white',
                  isActive &&
                    'bg-[var(--color-primary-500)]/10 border-[var(--color-primary-500)] text-[var(--color-primary-500)]',
                  isUpcoming &&
                    'bg-[var(--color-surface-100)] border-[var(--color-surface-300)] text-[var(--color-surface-400)]'
                )}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <span className="text-xs font-semibold">{index + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  'text-sm font-medium transition-colors duration-300',
                  isActive
                    ? 'text-[var(--color-primary-400)]'
                    : isCompleted
                    ? 'text-[var(--color-surface-700)]'
                    : 'text-[var(--color-surface-400)]'
                )}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
