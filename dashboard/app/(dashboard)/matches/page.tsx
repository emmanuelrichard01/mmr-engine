import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TableSkeleton } from '@/components/table-skeleton';
import { MatchesView } from './matches-view';

export const metadata: Metadata = { title: 'Matches' };

export default function MatchesPage() {
  return (
    <Suspense fallback={<TableSkeleton title="Matches" columns={7} />}>
      <MatchesView />
    </Suspense>
  );
}
