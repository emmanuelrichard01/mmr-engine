import type { Metadata } from 'next';
import { ReportsView } from './reports-view';

export const metadata: Metadata = { title: 'Daily return (experimental)' };

export default function ReportsPage() {
  return <ReportsView />;
}
