import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TableSkeleton } from '@/components/table-skeleton';
import { ActivityView } from './activity-view';

export const metadata: Metadata = { title: 'Activity' };

export default function ActivityPage() {
  return (
    <Suspense fallback={<TableSkeleton title="Activity" columns={7} />}>
      <ActivityView />
    </Suspense>
  );
}
