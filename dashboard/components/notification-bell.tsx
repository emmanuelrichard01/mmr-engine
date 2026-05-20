'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getRelativeTime, getSeverityColor } from '@/lib/utils';

// ─── Mock Alerts ──────────────────────────────────────────────────────────────

interface Alert {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  createdAt: string;
  read: boolean;
}

function hoursAgo(n: number): string {
  const d = new Date();
  d.setHours(d.getHours() - n);
  return d.toISOString();
}

const initialAlerts: Alert[] = [
  {
    id: 'alert-001',
    severity: 'critical',
    message: 'Flutterwave webhook gap detected — 47 minutes without events',
    createdAt: hoursAgo(0.5),
    read: false,
  },
  {
    id: 'alert-002',
    severity: 'high',
    message: '₦12.75M settlement missing from Paystack batch #PSK-2847',
    createdAt: hoursAgo(2),
    read: false,
  },
  {
    id: 'alert-003',
    severity: 'medium',
    message: 'FX variance on 3 M-Pesa transactions exceeds 0.5% threshold',
    createdAt: hoursAgo(6),
    read: false,
  },
];

// ─── Notification Bell Component ──────────────────────────────────────────────

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>(initialAlerts);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const unreadCount = alerts.filter((a) => !a.read).length;

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  function markAllRead() {
    setAlerts((prev) => prev.map((a) => ({ ...a, read: true })));
  }

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
          'text-surface-500 hover:bg-surface-200/60 hover:text-surface-700',
          isOpen && 'bg-surface-200/60 text-surface-700'
        )}
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell className="h-5 w-5" />

        {/* Badge */}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-500 px-1 text-[10px] font-bold text-white">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="animate-fade-in absolute right-0 top-full z-50 mt-2 w-[380px] overflow-hidden rounded-xl border border-surface-200 bg-surface-50 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3">
            <h3 className="text-sm font-semibold text-surface-800">
              Notifications
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="flex h-6 w-6 items-center justify-center rounded text-surface-500 transition-colors hover:text-surface-700"
              aria-label="Close notifications"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Alert List */}
          <div className="max-h-[320px] overflow-y-auto">
            {alerts.map((alert) => {
              const colors = getSeverityColor(alert.severity);

              return (
                <div
                  key={alert.id}
                  className={cn(
                    'flex gap-3 border-b border-surface-200/50 px-4 py-3 transition-colors hover:bg-surface-100/50',
                    !alert.read && 'bg-primary-500/[0.03]'
                  )}
                >
                  {/* Severity Dot */}
                  <div className="mt-1.5 flex shrink-0">
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        colors.dot
                      )}
                    />
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'text-sm leading-snug',
                        alert.read ? 'text-surface-600' : 'text-surface-800'
                      )}
                    >
                      {alert.message}
                    </p>
                    <p className="mt-1 text-xs text-surface-500">
                      {getRelativeTime(alert.createdAt)}
                    </p>
                  </div>

                  {/* Unread indicator */}
                  {!alert.read && (
                    <div className="mt-1.5 flex shrink-0">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary-400" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Footer */}
          <div className="border-t border-surface-200 px-4 py-2.5">
            <button
              onClick={markAllRead}
              className="w-full text-center text-xs font-medium text-primary-400 transition-colors hover:text-primary-200"
            >
              Mark all as read
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
