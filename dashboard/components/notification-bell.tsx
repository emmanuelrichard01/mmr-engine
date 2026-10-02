"use client";

import { useState, useRef, useEffect } from "react";
import { Bell, AlertTriangle, Clock, X } from "lucide-react";
import { useDiscrepancies } from "@/lib/hooks";
import { cn, formatCurrency, getRelativeTime } from "@/lib/utils";

/**
 * Notification bell — dynamically shows count of open critical/high discrepancies.
 * Dropdown panel shows recent items. No static data.
 */
export function NotificationBell() {
  const { data: discrepancies } = useDiscrepancies();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Derive urgent items from live data
  const urgent = (discrepancies ?? [])
    .filter(
      (d) =>
        d.status !== "resolved" &&
        (d.severity === "critical" || d.severity === "high")
    )
    .slice(0, 5);

  const count = urgent.length;

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center justify-center w-8 h-8 rounded-md transition-colors outline-none",
          "focus-visible:ring-2 focus-visible:ring-[var(--color-primary-500)]",
          open
            ? "bg-[var(--color-surface-100)] text-[var(--color-surface-900)]"
            : "text-[var(--color-surface-400)] hover:text-[var(--color-surface-700)] hover:bg-[var(--color-surface-100)]"
        )}
        title={`${count} urgent notifications`}
        aria-label={`${count} notifications`}
      >
        <Bell className="w-[15px] h-[15px]" strokeWidth={2} />
        {count > 0 && (
          <span className="absolute top-1 right-1 w-[14px] h-[14px] rounded-full bg-[var(--color-danger-500)] text-white text-[8px] font-bold flex items-center justify-center ring-2 ring-[var(--color-surface-0)]">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] w-[340px] bg-[var(--color-surface-0)] border border-[var(--color-surface-200)] rounded-lg shadow-lg animate-fade-in overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-surface-100)]">
            <h3 className="text-[13px] font-semibold text-[var(--color-surface-900)]">
              Notifications
            </h3>
            <span className="text-[11px] font-medium text-[var(--color-surface-400)]">
              {count} urgent
            </span>
          </div>

          {/* Items */}
          {urgent.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <Bell className="w-full h-full" />
              </div>
              <p className="empty-state-title">All clear</p>
              <p className="empty-state-description">
                No critical or high-severity discrepancies right now.
              </p>
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto">
              {urgent.map((d, i) => (
                <a
                  key={d.id}
                  href={`/discrepancies?id=${d.id}`}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3 hover:bg-[var(--color-surface-50)] transition-colors cursor-pointer group",
                    i < urgent.length - 1 &&
                      "border-b border-[var(--color-surface-100)]"
                  )}
                >
                  <div
                    className={cn(
                      "w-7 h-7 rounded-md flex items-center justify-center shrink-0 mt-0.5",
                      d.severity === "critical"
                        ? "bg-[var(--color-danger-50)] text-[var(--color-danger-500)]"
                        : "bg-[var(--color-warning-50)] text-[var(--color-warning-500)]"
                    )}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2.5} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-[var(--color-surface-800)] group-hover:text-[var(--color-primary-600)] transition-colors truncate">
                      {d.type
                        .split("_")
                        .map(
                          (w: string) =>
                            w.charAt(0).toUpperCase() + w.slice(1)
                        )
                        .join(" ")}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-bold text-[var(--color-surface-900)] tabular-nums">
                        {formatCurrency(d.amount)}
                      </span>
                      <span className="text-[10px] text-[var(--color-surface-400)]">
                        ·
                      </span>
                      <span className="text-[10px] text-[var(--color-surface-400)] flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {d.ageHours < 24
                          ? `${d.ageHours}h ago`
                          : `${Math.floor(d.ageHours / 24)}d ago`}
                      </span>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "badge text-[9px] mt-1 shrink-0",
                      d.severity === "critical"
                        ? "badge-critical"
                        : "badge-high"
                    )}
                  >
                    {d.severity}
                  </span>
                </a>
              ))}
            </div>
          )}

          {/* Footer */}
          {urgent.length > 0 && (
            <a
              href="/discrepancies"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center py-2.5 border-t border-[var(--color-surface-100)] text-[12px] font-semibold text-[var(--color-primary-500)] hover:bg-[var(--color-surface-50)] transition-colors"
            >
              View all discrepancies
            </a>
          )}
        </div>
      )}
    </div>
  );
}
