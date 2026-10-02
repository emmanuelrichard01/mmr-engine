import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DiscrepanciesView } from './discrepancies-view';

export const metadata: Metadata = { title: 'Discrepancies' };

export default function DiscrepanciesPage() {
  // useSearchParams (for ?id= deep links) requires a Suspense boundary.
  return (
    <Suspense fallback={null}>
      <DiscrepanciesView />
    </Suspense>
  );
}
