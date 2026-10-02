'use client';

import { useState, useMemo } from 'react';
import { useDiscrepancies, useResolveDiscrepancy } from '@/lib/hooks';
import { DemoBanner } from '@/components/demo-banner';
import { formatCurrency, getRelativeTime, cn } from '@/lib/utils';
import { PSPLogo } from '@/components/psp-logos';
import {
  AlertCircle, X, CheckCircle2, Clock, Search,
  ChevronRight, ArrowUpDown, Loader2
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'all';
type Status = 'open' | 'investigating' | 'resolved' | 'all';
type PSPFilter = 'all' | 'paystack' | 'flutterwave' | 'mpesa';

const SEVERITY_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  critical: { dot: 'var(--color-danger-500)', text: 'text-[var(--color-danger-500)]', bg: 'bg-[var(--color-danger-50)]' },
  high:     { dot: 'var(--color-warning-500)', text: 'text-[var(--color-warning-500)]', bg: 'bg-[var(--color-warning-50)]' },
  medium:   { dot: 'var(--color-primary-500)', text: 'text-[var(--color-primary-500)]', bg: 'bg-[var(--color-primary-50)]' },
  low:      { dot: 'var(--color-success-500)', text: 'text-[var(--color-success-500)]', bg: 'bg-[var(--color-success-50)]' },
};

const TYPE_LABELS: Record<string, string> = {
  missing_settlement: 'Missing Settlement',
  amount_mismatch: 'Amount Mismatch',
  fx_variance: 'FX Variance',
  duplicate_credit: 'Duplicate Credit',
  late_settlement: 'Late Settlement',
};

const STATUS_BADGE: Record<string, string> = {
  open:          'badge badge-critical',
  investigating: 'badge badge-high',
  escalated:     'badge badge-medium',
  resolved:      'badge badge-low',
};

export default function DiscrepanciesPage() {
  const { data: discrepancies, isLoading, isUsingDemoData } = useDiscrepancies();
  const { resolve, isResolving } = useResolveDiscrepancy();
  const [severityFilter, setSeverityFilter] = useState<Severity>('all');
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  const [pspFilter, setPspFilter] = useState<PSPFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const allDiscrepancies = discrepancies || [];

  const filtered = useMemo(() => {
    return allDiscrepancies.filter(d => {
      if (severityFilter !== 'all' && d.severity !== severityFilter) return false;
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (pspFilter !== 'all' && d.psp !== pspFilter) return false;
      if (searchTerm) {
        const s = searchTerm.toLowerCase();
        return d.reference.toLowerCase().includes(s) ||
               d.beneficiaryName.toLowerCase().includes(s);
      }
      return true;
    });
  }, [allDiscrepancies, severityFilter, statusFilter, pspFilter, searchTerm]);

  const selected = allDiscrepancies.find(d => d.id === selectedId) || null;

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    allDiscrepancies.forEach(d => { counts[d.severity]++; });
    return [
      { name: 'Critical', value: counts.critical, color: 'var(--color-danger-500)' },
      { name: 'High', value: counts.high, color: 'var(--color-warning-500)' },
      { name: 'Medium', value: counts.medium, color: 'var(--color-primary-500)' },
      { name: 'Low', value: counts.low, color: 'var(--color-success-500)' },
    ];
  }, [allDiscrepancies]);

  const severityChips: { label: string; value: Severity }[] = [
    { label: 'All Issues', value: 'all' },
    { label: 'Critical', value: 'critical' },
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ];

  return (
    <div className="space-y-5 pb-8">
      {/* Demo Banner */}
      {isUsingDemoData && <DemoBanner />}

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between animate-fade-in">
        <div>
          <h1 className="text-display">
            Discrepancies
          </h1>
          <p className="text-body mt-1.5">
            {filtered.length} issues · {allDiscrepancies.filter(d => d.status === 'open').length} open
          </p>
        </div>

        {/* Donut chart mini */}
        <div className="flex items-center gap-4 bg-[var(--color-surface-50)] px-4 py-2.5 rounded-[12px] border border-[var(--color-surface-200)] shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="w-[42px] h-[42px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityCounts}
                  cx="50%"
                  cy="50%"
                  innerRadius={15}
                  outerRadius={21}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {severityCounts.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-0)',
                    border: '1px solid var(--color-surface-200)',
                    borderRadius: '8px',
                    color: 'var(--color-surface-800)',
                    fontSize: '11px',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-1 text-[11px] font-medium text-[var(--color-surface-600)]">
            <div className="grid grid-cols-2 gap-x-5 gap-y-1">
              {severityCounts.map(s => (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <span>{s.name}: <strong className="text-[var(--color-surface-900)] font-bold">{s.value}</strong></span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Severity Filter Tabs */}
      <div className="flex border-b border-[var(--color-surface-200)] w-full gap-6">
        {severityChips.map(chip => {
          const active = severityFilter === chip.value;
          return (
            <button
              key={chip.value}
              onClick={() => setSeverityFilter(chip.value)}
              className={cn(
                'pb-3 text-[13px] font-semibold transition-all relative cursor-pointer outline-none',
                active
                  ? 'text-[var(--color-surface-900)]'
                  : 'text-[var(--color-surface-500)] hover:text-[var(--color-surface-750)]'
              )}
            >
              {chip.label}
              {active && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--color-surface-900)] rounded-full animate-fade-in" />
              )}
            </button>
          );
        })}
      </div>

      {/* Search and Filters Toolbar */}
      <div className="flex flex-col sm:flex-row items-center w-full gap-3">
        {/* Search */}
        <div className="relative flex-1 w-full sm:w-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-surface-400)] pointer-events-none" strokeWidth={2} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search reference or name..."
            className="input pl-9"
          />
        </div>

        {/* Dropdowns Group */}
        <div className="flex items-center w-full sm:w-auto gap-2">
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as Status)}
            className="select w-[140px]"
          >
            <option value="all">Status: All</option>
            <option value="open">Open</option>
            <option value="investigating">Investigating</option>
            <option value="resolved">Resolved</option>
          </select>

          <select
            value={pspFilter}
            onChange={e => setPspFilter(e.target.value as PSPFilter)}
            className="select w-[140px]"
          >
            <option value="all">PSP: All</option>
            <option value="paystack">Paystack</option>
            <option value="flutterwave">Flutterwave</option>
            <option value="mpesa">M-Pesa</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
            <tr className="bg-[var(--color-surface-50)] border-b border-[var(--color-surface-200)]">
                {['Discrepancy', 'PSP', 'Amount', 'Beneficiary', 'Age', 'Status', ''].map(h => (
                  <th key={h} className="table-header first:pl-5 last:pr-5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-20 bg-[var(--color-surface-0)]">
                    <AlertCircle className="w-10 h-10 mx-auto mb-4 text-[var(--color-surface-300)]" strokeWidth={1.5} />
                    <p className="text-[14px] font-bold text-[var(--color-surface-900)]">No discrepancies match</p>
                    <p className="text-[13px] text-[var(--color-surface-500)] mt-1">Try adjusting the filters or search term</p>
                  </td>
                </tr>
              ) : (
                filtered.map((d, idx) => (
                  <tr
                    key={d.id}
                    onClick={() => setSelectedId(d.id)}
                    className={cn(
                      'border-b border-[var(--color-surface-100)] last:border-0 hover:bg-[var(--color-surface-50)] transition-colors cursor-pointer group bg-[var(--color-surface-0)]',
                      selectedId === d.id ? 'bg-[var(--color-surface-50)]' : ''
                    )}
                    style={{ animationDelay: `${idx * 0.02}s` }}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: SEVERITY_STYLES[d.severity]?.dot ?? 'var(--color-surface-300)' }}
                        />
                        <div>
                          <p className="text-[13px] font-semibold text-[var(--color-surface-900)] group-hover:text-[var(--color-primary-600)] transition-colors">
                            {TYPE_LABELS[d.type] || d.type}
                          </p>
                          <p className="text-mono text-[var(--color-surface-400)] mt-0.5">
                            {d.reference}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5">
                        <PSPLogo name={d.psp} iconOnly className="w-4 h-4 shrink-0" />
                        <span className="text-[12px] font-medium text-[var(--color-surface-700)] capitalize">
                          {d.psp}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-bold text-[var(--color-surface-900)] tabular-nums">
                        {formatCurrency(d.amount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[12px] font-medium text-[var(--color-surface-700)] max-w-[140px] truncate">
                      {d.beneficiaryName}
                    </td>
                    <td className="px-4 py-3 text-[11px] font-medium text-[var(--color-surface-400)] tabular-nums">
                      {d.ageHours}h
                    </td>
                    <td className="px-4 py-3">
                      <span className={STATUS_BADGE[d.status] ?? 'badge badge-neutral'}>
                        {d.status.charAt(0).toUpperCase() + d.status.slice(1)}
                      </span>
                    </td>
                    <td className="py-3 pr-5">
                      <ChevronRight className="w-4 h-4 text-[var(--color-surface-300)] group-hover:text-[var(--color-surface-600)]" strokeWidth={2.5} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Inspector Panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-[var(--color-surface-900)]/20 backdrop-blur-sm transition-opacity duration-300" onClick={() => setSelectedId(null)} />
          <div className="relative w-full max-w-[480px] bg-[var(--color-surface-0)] border-l border-[var(--color-surface-200)] overflow-y-auto shadow-2xl animate-slide-in-right flex flex-col">
            <div className="p-5 flex-1">
              {/* Header */}
              <div className="flex items-start justify-between mb-6">
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: SEVERITY_STYLES[selected.severity].dot }} />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-[var(--color-surface-500)]">
                      {selected.severity} Severity
                    </span>
                  </div>
                  <h2 className="text-[20px] font-bold tracking-tight text-[var(--color-surface-900)] leading-tight">
                    {TYPE_LABELS[selected.type] || selected.type}
                  </h2>
                  <p className="text-mono text-[var(--color-surface-500)] mt-1.5 bg-[var(--color-surface-100)] px-2 py-1 inline-block rounded-md">{selected.reference}</p>
                </div>
                <button onClick={() => setSelectedId(null)} className="p-2 rounded-full text-[var(--color-surface-400)] hover:text-[var(--color-surface-900)] hover:bg-[var(--color-surface-100)] transition-all cursor-pointer">
                  <X className="w-5 h-5" strokeWidth={2.5} />
                </button>
              </div>

              {/* Details */}
              <div className="grid grid-cols-2 gap-y-5 gap-x-6 mb-8">
                {[
                  { label: 'Amount', value: formatCurrency(selected.amount), isCurrency: true },
                  { label: 'Currency', value: selected.currency },
                  { label: 'PSP', value: selected.psp },
                  { label: 'Status', value: selected.status },
                  { label: 'Beneficiary', value: selected.beneficiaryName },
                  { label: 'Age', value: `${selected.ageHours} hours` },
                ].map(item => (
                  <div key={item.label} className="flex flex-col">
                    <span className="text-overline mb-1">{item.label}</span>
                    <div className={cn("text-[14px] font-medium capitalize text-[var(--color-surface-800)]", item.isCurrency && "text-[16px] font-bold text-[var(--color-surface-900)]")}>
                      {item.label === 'PSP' ? (
                        <span className="flex items-center gap-2">
                          <PSPLogo name={selected.psp} iconOnly className="w-4 h-4 shrink-0 drop-shadow-sm" />
                          {selected.psp}
                        </span>
                      ) : item.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Timeline (Linear minimalist style) */}
              <div>
                <h3 className="text-overline mb-4">Audit Timeline</h3>
                <div className="space-y-0 relative before:absolute before:inset-0 before:ml-[11px] before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-[2px] before:bg-gradient-to-b before:from-[var(--color-surface-200)] before:to-transparent">
                  {[
                    { label: 'Created & Logged', time: selected.createdAt, done: true },
                    { label: 'Under Investigation', time: selected.status !== 'open' ? selected.createdAt : null, done: selected.status !== 'open' },
                    { label: 'Resolved & Closed', time: selected.status === 'resolved' ? selected.createdAt : null, done: selected.status === 'resolved' },
                  ].map((step, i) => (
                    <div key={i} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active py-3">
                      <div className={cn(
                        'flex items-center justify-center w-6 h-6 rounded-full border-2 bg-[var(--color-surface-0)] shrink-0 z-10 shadow-sm',
                        step.done ? 'border-[var(--color-primary-500)] text-[var(--color-primary-500)]' : 'border-[var(--color-surface-200)] text-transparent'
                      )}>
                        {step.done && <div className="w-2 h-2 rounded-full bg-[var(--color-primary-500)]" />}
                      </div>
                      <div className="w-[calc(100%-3rem)] ml-4">
                        <p className={cn('text-[13px] font-bold', step.done ? 'text-[var(--color-surface-900)]' : 'text-[var(--color-surface-400)]')}>
                          {step.label}
                        </p>
                        {step.time && (
                          <p className="text-[12px] font-medium text-[var(--color-surface-500)] mt-0.5">{getRelativeTime(step.time)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Resolution Form */}
            {selected.status !== 'resolved' && (
              <div className="border-t border-[var(--color-surface-200)] p-5 bg-[var(--color-surface-50)]">
                <h3 className="text-[14px] font-semibold text-[var(--color-surface-900)] mb-3">Resolve Discrepancy</h3>
                <textarea
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                  placeholder="Enter final audit notes and reconciliation reference..."
                  className="w-full px-3 py-2.5 rounded-md bg-[var(--color-surface-0)] border border-[var(--color-surface-200)] text-[13px] text-[var(--color-surface-900)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:border-[var(--color-primary-500)] focus:ring-2 focus:ring-[var(--color-primary-500)]/10 transition-all resize-none h-24 mb-3"
                />
                <button
                  onClick={async () => {
                    if (selected) {
                      const numericId = parseInt(selected.id.replace('DIS-', ''), 10);
                      const success = await resolve(numericId, resolveNote);
                      if (success || isUsingDemoData) {
                        setSelectedId(null);
                        setResolveNote('');
                      }
                    }
                  }}
                  disabled={isResolving}
                  className="btn btn-primary w-full"
                >
                  {isResolving ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</>
                  ) : (
                    <><CheckCircle2 className="w-4 h-4" strokeWidth={2.5} /> Mark as Resolved</>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
