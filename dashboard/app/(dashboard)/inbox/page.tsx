import { Suspense } from 'react';
import type { Metadata } from 'next';
import { InboxView } from './inbox-view';
import { InboxSkeleton } from './inbox-skeleton';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  // Filters and the open item live in the query string (useSearchParams), which needs a Suspense boundary.
  return (
    <Suspense fallback={<InboxSkeleton />}>
      <InboxView />
    </Suspense>
  );
}
