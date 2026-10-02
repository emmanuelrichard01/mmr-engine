'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  X,
  Compass,
  Link2,
  BookOpen,
  ArrowRight,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'mmr-welcome-dismissed';

interface WelcomeBannerProps {
  onStartTour?: () => void;
}

export function WelcomeBanner({ onStartTour }: WelcomeBannerProps) {
  const router = useRouter();
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Show only on first visit
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (!dismissed) {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => {
      setVisible(false);
      localStorage.setItem(STORAGE_KEY, 'true');
    }, 300);
  };

  if (!visible) return null;

  const actions = [
    {
      icon: Compass,
      title: 'Take a Tour',
      description: 'Interactive walkthrough of every feature',
      onClick: () => {
        dismiss();
        onStartTour?.();
      },
      accent: 'from-indigo-500 to-violet-500',
      glow: 'shadow-indigo-500/20',
    },
    {
      icon: Link2,
      title: 'Connect PSPs',
      description: 'Set up Paystack, Flutterwave, or M-Pesa',
      onClick: () => {
        dismiss();
        router.push('/onboarding');
      },
      accent: 'from-emerald-500 to-teal-500',
      glow: 'shadow-emerald-500/20',
    },
    {
      icon: BookOpen,
      title: 'View Docs',
      description: 'API reference and operations guide',
      onClick: () => {
        window.open('http://localhost:8000/docs', '_blank');
      },
      accent: 'from-amber-500 to-orange-500',
      glow: 'shadow-amber-500/20',
    },
  ];

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border border-[var(--color-surface-200)]/60 bg-gradient-to-br from-[var(--color-surface-50)] to-[var(--color-surface-100)] transition-all duration-300',
        exiting ? 'opacity-0 scale-[0.98] translate-y-2' : 'opacity-100 animate-fade-in'
      )}
    >
      {/* Subtle gradient accent strip */}
      <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-indigo-500 via-violet-500 to-emerald-500 opacity-60" />

      {/* Dismiss button */}
      <button
        onClick={dismiss}
        className="absolute right-3 top-3 z-10 p-1.5 rounded-lg text-[var(--color-surface-400)] hover:text-[var(--color-surface-600)] hover:bg-[var(--color-surface-200)]/60 transition-all"
        aria-label="Dismiss welcome"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="px-6 pt-6 pb-5">
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[var(--color-surface-900)]">
              Welcome to MMR
            </h2>
            <p className="text-xs text-[var(--color-surface-500)]">
              Cross-Border Reconciliation Engine
            </p>
          </div>
        </div>

        <p className="text-sm text-[var(--color-surface-600)] leading-relaxed mb-5 max-w-lg">
          Automatically match transactions across Paystack, Flutterwave, and M-Pesa.
          Detect discrepancies in real-time and generate CBN-compliant daily returns.
        </p>

        {/* Action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {actions.map((action, i) => (
            <button
              key={i}
              onClick={action.onClick}
              className="group relative text-left p-4 rounded-xl border border-[var(--color-surface-200)]/80 bg-[var(--color-surface-50)]/50 hover:bg-[var(--color-surface-50)]/80 hover:border-[var(--color-surface-300)]/80 hover:shadow-lg transition-all duration-200"
            >
              {/* Icon */}
              <div
                className={cn(
                  'flex items-center justify-center w-9 h-9 rounded-lg bg-gradient-to-br mb-3 shadow-md transition-transform duration-200 group-hover:scale-110',
                  action.accent,
                  action.glow
                )}
              >
                <action.icon className="w-4.5 h-4.5 text-white" />
              </div>

              <h3 className="text-sm font-semibold text-[var(--color-surface-800)] mb-0.5 flex items-center gap-1.5">
                {action.title}
                <ArrowRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-60 group-hover:translate-x-0 transition-all duration-200" />
              </h3>
              <p className="text-[11px] text-[var(--color-surface-500)] leading-relaxed">
                {action.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Demo mode note */}
      <div className="px-6 py-2.5 bg-[var(--color-surface-100)]/80 border-t border-[var(--color-surface-200)]/40">
        <p className="flex items-center gap-1.5 text-[11px] text-[var(--color-surface-500)]">
          <Zap className="w-3 h-3 text-amber-400" />
          Exploring with demo data — connect a PSP to see live transactions
        </p>
      </div>
    </div>
  );
}
