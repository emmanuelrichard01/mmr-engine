'use client';

// TODO: Replace mock data with API calls to /v1/reports/daily
// when the CBN report REST endpoint is implemented (P4.4)

import { useState, useMemo } from 'react';
import { formatCurrency, formatPercent, cn } from '@/lib/utils';
import {
  FileText, Download, Calendar, CheckCircle2,
  Clock, AlertTriangle, ChevronLeft, ChevronRight
} from 'lucide-react';

// Mock CBN report data
interface CBNReport {
  id: string;
  date: string;
  totalTransactions: number;
  volumeNgn: number;
  matchRate: number;
  crossBorderCount: number;
  suspiciousFlags: number;
  status: 'generated' | 'reviewed' | 'submitted' | 'missing';
  openDiscrepancies: number;
  exposureNgn: number;
}

function generateReportHistory(days: number): CBNReport[] {
  const reports: CBNReport[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const isFuture = i < 0;
    const isMissing = i === 3 || i === 17; // Simulate 2 missing reports

    if (isFuture) continue;

    reports.push({
      id: `CBN-${(1000 + days - i).toString(16).toUpperCase()}`,
      date: dateStr,
      totalTransactions: Math.floor(800 + Math.random() * 500),
      volumeNgn: Math.floor(40_000_000 + Math.random() * 25_000_000),
      matchRate: isMissing ? 0 : 96 + Math.random() * 4,
      crossBorderCount: Math.floor(10 + Math.random() * 40),
      suspiciousFlags: Math.floor(Math.random() * 3),
      status: isMissing ? 'missing' : i < 2 ? 'generated' : i < 7 ? 'reviewed' : 'submitted',
      openDiscrepancies: Math.floor(Math.random() * 5),
      exposureNgn: Math.floor(Math.random() * 500_000),
    });
  }
  return reports;
}

const STATUS_CONFIG = {
  generated:  { color: 'text-[var(--color-primary-400)]', bg: 'bg-[var(--color-primary-500)]/15', dot: 'bg-[var(--color-primary-400)]', icon: FileText },
  reviewed:   { color: 'text-[var(--color-warning-400)]', bg: 'bg-[var(--color-warning-500)]/15', dot: 'bg-[var(--color-warning-400)]', icon: Clock },
  submitted:  { color: 'text-[var(--color-success-400)]', bg: 'bg-[var(--color-success-500)]/15', dot: 'bg-[var(--color-success-400)]', icon: CheckCircle2 },
  missing:    { color: 'text-[var(--color-danger-400)]', bg: 'bg-[var(--color-danger-500)]/15', dot: 'bg-[var(--color-danger-400)]', icon: AlertTriangle },
};

export default function ReportsPage() {
  const reports = useMemo(() => generateReportHistory(30), []);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const selectedReport = reports.find(r => r.date === selectedDate) || null;
  const recentReports = reports.slice(0, 7);

  // Calendar grid — last 35 days (5 weeks)
  const calendarDays = useMemo(() => {
    const days: { date: string; dayNum: number; report?: CBNReport; isFuture: boolean }[] = [];
    const today = new Date();
    // Start from 34 days ago
    for (let i = 34; i >= -1; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      days.push({
        date: dateStr,
        dayNum: d.getDate(),
        report: reports.find(r => r.date === dateStr),
        isFuture: i < 0,
      });
    }
    return days;
  }, [reports]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-surface-900)]">CBN Daily Returns</h1>
        <p className="text-sm text-[var(--color-surface-500)] mt-1">
          Central Bank of Nigeria regulatory reports · Generated daily at 02:00 WAT
        </p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reports', value: reports.filter(r => r.status !== 'missing').length.toString(), sub: 'Last 30 days' },
          { label: 'Submitted', value: reports.filter(r => r.status === 'submitted').length.toString(), sub: 'To CBN' },
          { label: 'Pending Review', value: reports.filter(r => r.status === 'generated').length.toString(), sub: 'Awaiting review' },
          { label: 'Missing', value: reports.filter(r => r.status === 'missing').length.toString(), sub: 'Needs attention' },
        ].map((stat, i) => (
          <div key={stat.label} className="card animate-fade-in" style={{ animationDelay: `${i * 0.1}s` }}>
            <p className="text-xs text-[var(--color-surface-500)]">{stat.label}</p>
            <p className="text-2xl font-bold text-[var(--color-surface-900)] mt-1">{stat.value}</p>
            <p className="text-xs text-[var(--color-surface-400)] mt-0.5">{stat.sub}</p>
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-[var(--color-surface-900)] flex items-center gap-2">
            <Calendar className="w-4 h-4" /> Report Calendar
          </h3>
          <div className="flex items-center gap-4 text-xs text-[var(--color-surface-500)]">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full', config.dot)} />
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
            ))}
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <div key={day} className="text-center text-xs font-medium text-[var(--color-surface-500)] py-1">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 gap-2">
          {calendarDays.map((day, i) => {
            const status = day.isFuture ? null : (day.report?.status || 'missing');
            const config = status ? STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] : null;
            const isSelected = selectedDate === day.date;

            return (
              <button
                key={i}
                onClick={() => !day.isFuture && setSelectedDate(day.date)}
                disabled={day.isFuture}
                className={cn(
                  'relative aspect-square rounded-lg flex flex-col items-center justify-center text-sm transition-all',
                  day.isFuture && 'opacity-30 cursor-not-allowed',
                  !day.isFuture && 'cursor-pointer hover:bg-[var(--color-surface-200)]',
                  isSelected && 'ring-2 ring-[var(--color-primary-500)] bg-[var(--color-primary-500)]/10',
                  !isSelected && 'bg-[var(--color-surface-100)]'
                )}
              >
                <span className="text-[var(--color-surface-700)] font-medium">{day.dayNum}</span>
                {config && (
                  <span className={cn('w-2 h-2 rounded-full mt-1', config.dot)} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Report Detail */}
      {selectedReport && (
        <div className="card animate-fade-in border-l-4 border-l-[var(--color-primary-500)]">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-lg font-bold text-[var(--color-surface-900)]">
                  Report: {selectedReport.date}
                </h3>
                <span className={cn(
                  'badge',
                  STATUS_CONFIG[selectedReport.status].bg,
                  STATUS_CONFIG[selectedReport.status].color
                )}>
                  {selectedReport.status}
                </span>
              </div>
              <p className="text-xs text-[var(--color-surface-500)] mt-1 font-mono">{selectedReport.id}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => console.log('Download CSV:', selectedReport.id)}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-surface-200)] text-sm text-[var(--color-surface-700)] hover:bg-[var(--color-surface-300)] transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </button>
              <button
                onClick={() => console.log('Download JSON:', selectedReport.id)}
                className="px-3 py-1.5 rounded-lg bg-[var(--color-primary-600)] text-sm text-white hover:bg-[var(--color-primary-500)] transition-colors flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" /> JSON
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Transactions', value: selectedReport.totalTransactions.toLocaleString() },
              { label: 'Volume', value: formatCurrency(selectedReport.volumeNgn) },
              { label: 'Match Rate', value: formatPercent(selectedReport.matchRate) },
              { label: 'Cross-Border', value: selectedReport.crossBorderCount.toString() },
              { label: 'Open Issues', value: selectedReport.openDiscrepancies.toString() },
              { label: 'Exposure', value: formatCurrency(selectedReport.exposureNgn) },
              { label: 'Suspicious', value: selectedReport.suspiciousFlags.toString() },
              { label: 'Status', value: selectedReport.status },
            ].map(item => (
              <div key={item.label} className="bg-[var(--color-surface-100)] rounded-lg p-3">
                <p className="text-xs text-[var(--color-surface-500)]">{item.label}</p>
                <p className="text-sm font-bold text-[var(--color-surface-800)] mt-0.5 capitalize">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Reports Table */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.5s' }}>
        <h3 className="font-semibold text-[var(--color-surface-900)] mb-4">Recent Reports</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-surface-200)]">
                {['Date', 'Report ID', 'Transactions', 'Volume (₦)', 'Match Rate', 'Status', 'Download'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-[var(--color-surface-500)] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentReports.map((report, i) => {
                const config = STATUS_CONFIG[report.status];
                const StatusIcon = config.icon;
                return (
                  <tr
                    key={report.id}
                    className="border-b border-[var(--color-surface-200)]/50 hover:bg-[var(--color-surface-100)] transition-colors animate-fade-in"
                    style={{ animationDelay: `${0.6 + i * 0.05}s` }}
                  >
                    <td className="px-4 py-3 text-[var(--color-surface-700)]">{report.date}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--color-surface-500)]">{report.id}</td>
                    <td className="px-4 py-3 text-[var(--color-surface-700)]">{report.totalTransactions.toLocaleString()}</td>
                    <td className="px-4 py-3 font-medium text-[var(--color-surface-800)]">{formatCurrency(report.volumeNgn)}</td>
                    <td className="px-4 py-3">{formatPercent(report.matchRate)}</td>
                    <td className="px-4 py-3">
                      <span className={cn('badge flex items-center gap-1', config.bg, config.color)}>
                        <StatusIcon className="w-3 h-3" />
                        {report.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {report.status !== 'missing' && (
                        <button className="p-1.5 rounded hover:bg-[var(--color-surface-200)] transition-colors">
                          <Download className="w-4 h-4 text-[var(--color-surface-500)]" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
