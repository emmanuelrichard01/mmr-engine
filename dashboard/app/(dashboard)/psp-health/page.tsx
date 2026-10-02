import type { Metadata } from 'next';
import { PspHealthView } from './psp-health-view';

export const metadata: Metadata = { title: 'PSP health' };

export default function PspHealthPage() {
  return <PspHealthView />;
}
