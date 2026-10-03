import { Suspense } from 'react';
import type { Metadata } from 'next';
import { TableSkeleton } from '@/components/table-skeleton';
import { TransactionsView } from './transactions-view';

export const metadata: Metadata = { title: 'Transactions' };

export default function TransactionsPage() {
  return (
    <Suspense fallback={<TableSkeleton title="Transactions" columns={8} />}>
      <TransactionsView />
    </Suspense>
  );
}
