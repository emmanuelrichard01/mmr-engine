import {
  ArrowLeftRight,
  FileText,
  History,
  Inbox,
  LayoutGrid,
  Link2,
  Radio,
  Server,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Second key of the "g then …" shortcut. */
  key: string;
  keywords: readonly string[];
  note?: string;
}

export interface NavGroup {
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [{ label: 'Overview', href: '/', icon: LayoutGrid, key: 'o', keywords: ['home', 'summary', 'kpi', 'dashboard'] }],
  },
  {
    label: 'Reconcile',
    items: [
      { label: 'Inbox', href: '/inbox', icon: Inbox, key: 'i', keywords: ['discrepancies', 'triage', 'resolve', 'gold'] },
      { label: 'Transactions', href: '/transactions', icon: ArrowLeftRight, key: 't', keywords: ['silver', 'payments', 'explorer', 'lineage'] },
      { label: 'Matches', href: '/matches', icon: Link2, key: 'm', keywords: ['pairs', 'matched', 'confidence', 'gold'] },
    ],
  },
  {
    label: 'Monitor',
    items: [
      { label: 'PSP health', href: '/psp-health', icon: Radio, key: 'p', keywords: ['paystack', 'flutterwave', 'freshness', 'events'] },
      { label: 'Activity', href: '/activity', icon: History, key: 'a', keywords: ['pipeline', 'runs', 'flows', 'scheduler', 'jobs'] },
    ],
  },
  {
    label: 'Report',
    items: [
      { label: 'Daily return', href: '/reports', icon: FileText, key: 'r', keywords: ['cbn', 'csv', 'report'], note: 'Experimental' },
      { label: 'System', href: '/system', icon: Server, key: 's', keywords: ['readiness', 'health', 'config', 'status'] },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function currentNav(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => isActive(pathname, item.href));
}
