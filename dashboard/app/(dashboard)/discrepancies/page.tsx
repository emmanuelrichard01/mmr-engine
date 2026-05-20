'use client';

import { useState, useMemo } from 'react';
import { useDiscrepancies, useResolveDiscrepancy, useAPIStatus } from '@/lib/hooks';
import { DemoBanner } from '@/components/demo-banner';
import { formatCurrency, getRelativeTime, cn } from '@/lib/utils';
import {
  AlertCircle, X, CheckCircle2, Clock, Search,
  ChevronRight, Filter, ArrowUpDown, Loader2
} from 'lucide-react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip
} from 'recharts';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'all';
type Status = 'open' | 'investigating' | 'resolved' | 'all';
type PSPFilter = 'all' | 'paystack' | 'flutterwave' | 'mpesa';

const SEVERITY_STYLES: Record<string, { dot: string; bg: string; text: string }> = {
  critical: { dot: 'bg-[var(--color-danger-500)]', bg: 'badge-critical', text: 'text-[var(--color-danger-400)]' },
  high:     { dot: 'bg-[var(--color-warning-500)]', bg: 'badge-high', text: 'text-[var(--color-warning-400)]' },
  medium:   { dot: 'bg-[var(--color-primary-400)]', bg: 'badge-medium', text: 'text-[var(--color-primary-400)]' },
  low:      { dot: 'bg-[var(--color-success-500)]', bg: 'badge-low', text: 'text-[var(--color-success-400)]' },
};

const TYPE_LABELS: Record<string, string> = {
  missing_settlement: 'Missing Settlement',
  amount_mismatch: 'Amount Mismatch',
  fx_variance: 'FX Variance',
  duplicate_credit: 'Duplicate Credit',
  late_settlement: 'Late Settlement',
};

const DONUT_COLORS = ['#f43f5e', '#f59e0b', '#6366f1', '#10b981'];

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
      { name: 'Critical', value: counts.critical, color: '#f43f5e' },
      { name: 'High', value: counts.high, color: '#f59e0b' },
      { name: 'Medium', value: counts.medium, color: '#6366f1' },
      { name: 'Low', value: counts.low, color: '#10b981' },
    ];
  }, [allDiscrepancies]);

  const severityChips: { label: string; value: Severity }[] = [
    { label: 'All', value: 'all' },
    { label: 'Critical', value: 'critical' },
    { label: 'High', value: 'high' },
    { label: 'Medium', value: 'medium' },
    { label: 'Low', value: 'low' },
  ];

  return (
    <div className="space-y-6">
      {/* Demo Banner */}
      {isUsingDemoData && <DemoBanner />}

      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-surface-900)]">
            Discrepancies
          </h1>
          <p className="text-sm text-[var(--color-surface-500)] mt-1">
            {filtered.length} discrepancies found · {allDiscrepancies.filter(d => d.status === 'open').length} open
          </p>
        </div>

        {/* Donut chart mini */}
        <div className="flex items-center gap-4">
          <div className="w-20 h-20">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={severityCounts}
                  cx="50%"
                  cy="50%"
                  innerRadius={22}
                  outerRadius={36}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {severityCounts.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-surface-100)',
                    border: '1px solid var(--color-surface-300)',
                    borderRadius: '8px',
                    color: 'var(--color-surface-800)',
                    fontSize: '12px',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            {severityCounts.map(s => (
              <span key={s.name} className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                {s.name}: {s.value}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Filters Row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Severity chips */}
        <div className="flex gap-1.5">
          {severityChips.map(chip => (
            <button
              key={chip.value}
              onClick={() => setSeverityFilter(chip.value)}
              className={cn(
                'px-3 py-1 rounded-full text-xs font-medium transition-all',
                severityFilter === chip.value
                  ? 'bg-[var(--color-primary-600)] text-white'
                  : 'bg-[var(--color-surface-100)] text-[var(--color-surface-500)] hover:bg-[var(--color-surface-200)]'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* PSP filter */}
        <select
          value={pspFilter}
          onChange={e => setPspFilter(e.target.value as PSPFilter)}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-sm text-[var(--color-surface-700)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40"
        >
          <option value="all">All PSPs</option>
          <option value="paystack">Paystack</option>
          <option value="flutterwave">Flutterwave</option>
          <option value="mpesa">M-Pesa</option>
        </select>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as Status)}
          className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-sm text-[var(--color-surface-700)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40"
        >
          <option value="all">All Status</option>
          <option value="open">Open</option>
          <option value="investigating">Investigating</option>
          <option value="resolved">Resolved</option>
        </select>

        {/* Search */}
        <div className="relative ml-auto">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-surface-400)]" />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search reference or name..."
            className="pl-9 pr-3 py-1.5 rounded-lg bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-sm text-[var(--color-surface-700)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 w-64"
          />
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-surface-200)]">
                {['Severity', 'Type', 'PSP', 'Reference', 'Amount', 'Beneficiary', 'Age', 'Status', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-[var(--color-surface-500)] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-16 text-[var(--color-surface-400)]">
                    <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-50" />
                    <p className="font-medium">No discrepancies match your filters</p>
                    <p className="text-xs mt-1">Try adjusting the severity or PSP filters</p>
                  </td>
                </tr>
              ) : filtered.map((d, idx) => (
                <tr
                  key={d.id}
                  onClick={() => setSelectedId(d.id)}
                  className={cn(
                    'border-b border-[var(--color-surface-200)]/50 cursor-pointer transition-colors animate-fade-in',
                    selectedId === d.id
                      ? 'bg-[var(--color-primary-500)]/5'
                      : 'hover:bg-[var(--color-surface-100)]'
                  )}
                  style={{ animationDelay: `${idx * 0.03}s` }}
                >
                  <td className="px-4 py-3">
                    <span className={cn('badge', SEVERITY_STYLES[d.severity].bg)}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', SEVERITY_STYLES[d.severity].dot)} />
                      {d.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--color-surface-700)]">{TYPE_LABELS[d.type] || d.type}</td>
                  <td className="px-4 py-3 capitalize text-[var(--color-surface-600)]">{d.psp}</td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--color-surface-500)]">{d.reference}</td>
                  <td className="px-4 py-3 font-medium text-[var(--color-surface-800)]">{formatCurrency(d.amount)}</td>
                  <td className="px-4 py-3 text-[var(--color-surface-600)]">{d.beneficiaryName}</td>
                  <td className="px-4 py-3 text-[var(--color-surface-500)]">{d.ageHours}h</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'text-xs font-medium capitalize',
                      d.status === 'open' ? 'text-[var(--color-danger-400)]' :
                      d.status === 'investigating' ? 'text-[var(--color-warning-400)]' :
                      'text-[var(--color-success-400)]'
                    )}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ChevronRight className="w-4 h-4 text-[var(--color-surface-400)]" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Detail Panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <div className="relative w-full max-w-lg bg-[var(--color-surface-50)] border-l border-[var(--color-surface-200)] overflow-y-auto animate-fade-in">
            <div className="p-6 space-y-6">
              {/* Header */}
              <div className="flex items-start justify-between">
                <div>
                  <span className={cn('badge mb-2', SEVERITY_STYLES[selected.severity].bg)}>
                    <span className={cn('w-1.5 h-1.5 rounded-full', SEVERITY_STYLES[selected.severity].dot)} />
                    {selected.severity}
                  </span>
                  <h2 className="text-xl font-bold text-[var(--color-surface-900)] mt-2">
                    {TYPE_LABELS[selected.type] || selected.type}
                  </h2>
                  <p className="text-sm text-[var(--color-surface-500)] mt-1 font-mono">{selected.reference}</p>
                </div>
                <button onClick={() => setSelectedId(null)} className="p-2 rounded-lg hover:bg-[var(--color-surface-200)] transition-colors">
                  <X className="w-5 h-5 text-[var(--color-surface-500)]" />
                </button>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: 'Amount', value: formatCurrency(selected.amount) },
                  { label: 'Currency', value: selected.currency },
                  { label: 'PSP', value: selected.psp },
                  { label: 'Status', value: selected.status },
                  { label: 'Beneficiary', value: selected.beneficiaryName },
                  { label: 'Age', value: `${selected.ageHours} hours` },
                ].map(item => (
                  <div key={item.label} className="bg-[var(--color-surface-100)] rounded-lg p-3">
                    <p className="text-xs text-[var(--color-surface-500)]">{item.label}</p>
                    <p className="text-sm font-medium text-[var(--color-surface-800)] mt-0.5 capitalize">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Timeline */}
              <div>
                <h3 className="text-sm font-medium text-[var(--color-surface-700)] mb-3">Timeline</h3>
                <div className="space-y-3">
                  {[
                    { label: 'Created', time: selected.createdAt, icon: AlertCircle, done: true },
                    { label: 'Investigating', time: selected.status !== 'open' ? selected.createdAt : null, icon: Clock, done: selected.status !== 'open' },
                    { label: 'Resolved', time: selected.status === 'resolved' ? selected.createdAt : null, icon: CheckCircle2, done: selected.status === 'resolved' },
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className={cn(
                        'w-8 h-8 rounded-full flex items-center justify-center',
                        step.done ? 'bg-[var(--color-primary-500)]/20 text-[var(--color-primary-400)]' : 'bg-[var(--color-surface-200)] text-[var(--color-surface-400)]'
                      )}>
                        <step.icon className="w-4 h-4" />
                      </div>
                      <div>
                        <p className={cn('text-sm font-medium', step.done ? 'text-[var(--color-surface-800)]' : 'text-[var(--color-surface-400)]')}>
                          {step.label}
                        </p>
                        {step.time && (
                          <p className="text-xs text-[var(--color-surface-500)]">{getRelativeTime(step.time)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resolution Form */}
              {selected.status !== 'resolved' && (
                <div className="border-t border-[var(--color-surface-200)] pt-4">
                  <h3 className="text-sm font-medium text-[var(--color-surface-700)] mb-2">Resolve Discrepancy</h3>
                  <textarea
                    value={resolveNote}
                    onChange={e => setResolveNote(e.target.value)}
                    placeholder="Add resolution notes..."
                    className="w-full px-3 py-2 rounded-lg bg-[var(--color-surface-100)] border border-[var(--color-surface-200)] text-sm text-[var(--color-surface-700)] placeholder:text-[var(--color-surface-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary-500)]/40 resize-none h-24"
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
                    className="mt-3 w-full py-2 rounded-lg bg-[var(--color-success-600)] text-white text-sm font-medium hover:bg-[var(--color-success-500)] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {isResolving ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Resolving...</>
                    ) : (
                      <><CheckCircle2 className="w-4 h-4 inline-block" /> Mark as Resolved</>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
