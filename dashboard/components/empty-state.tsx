"use client";

import { type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Reusable empty state with icon, title, description, and optional CTA.
 *
 * Usage:
 *   <EmptyState
 *     icon={<FileX className="w-12 h-12" />}
 *     title="No discrepancies found"
 *     description="Try adjusting your filters to see more results."
 *     action={<button className="btn btn-primary btn-sm">Clear Filters</button>}
 *   />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("empty-state", className)}>
      <div className="empty-state-icon">
        {icon || <Inbox className="w-full h-full" />}
      </div>
      <p className="empty-state-title">{title}</p>
      {description && (
        <p className="empty-state-description">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
