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

const STATUS_CONFIG: Record<string, { className: string; dot: string; icon: typeof FileText }> = {
  generated:  { className: 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)] border border-[var(--color-primary-100)]', dot: 'bg-[var(--color-primary-500)]', icon: FileText },
  reviewed:   { className: 'bg-[var(--color-warning-50)] text-[var(--color-warning-600)] border border-[var(--color-warning-100)]', dot: 'bg-[var(--color-warning-500)]', icon: Clock },
  submitted:  { className: 'bg-[var(--color-success-50)] text-[var(--color-success-600)] border border-[var(--color-success-100)]', dot: 'bg-[var(--color-success-500)]', icon: CheckCircle2 },
  missing:    { className: 'bg-[var(--color-danger-50)] text-[var(--color-danger-600)] border border-[var(--color-danger-100)]', dot: 'bg-[var(--color-danger-500)]', icon: AlertTriangle },
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
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-display">CBN Daily Returns</h1>
          <p className="text-[12px] text-[var(--color-surface-400)] font-medium mt-0.5">
            Regulatory reports · Generated daily at 02:00 WAT
          </p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Reports', value: reports.filter(r => r.status !== 'missing').length.toString(), sub: 'Last 30 days', icon: FileText, iconBg: 'bg-[var(--color-primary-50)] text-[var(--color-primary-600)]' },
          { label: 'Submitted', value: reports.filter(r => r.status === 'submitted').length.toString(), sub: 'To CBN', icon: CheckCircle2, iconBg: 'bg-[var(--color-success-50)] text-[var(--color-success-600)]' },
          { label: 'Pending Review', value: reports.filter(r => r.status === 'generated').length.toString(), sub: 'Awaiting review', icon: Clock, iconBg: 'bg-[var(--color-warning-50)] text-[var(--color-warning-600)]' },
          { label: 'Missing', value: reports.filter(r => r.status === 'missing').length.toString(), sub: 'Needs attention', icon: AlertTriangle, iconBg: 'bg-[var(--color-danger-50)] text-[var(--color-danger-600)]' },
        ].map((stat, i) => {
          const StatIcon = stat.icon;
          return (
            <div key={stat.label} className="card flex items-center gap-3 animate-fade-in" style={{ animationDelay: `${i * 0.08}s` }}>
              <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center shrink-0", stat.iconBg)}>
                <StatIcon className="w-4 h-4" />
              </div>
              <div>
                <p className="text-overline">{stat.label}</p>
                <p className="text-[20px] font-bold text-[var(--color-surface-900)] leading-tight">{stat.value}</p>
                <p className="text-[11px] text-[var(--color-surface-400)] font-medium mt-0.5">{stat.sub}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Calendar Grid */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.3s' }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <h3 className="font-bold text-[var(--color-surface-800)] text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-primary-500)]" /> Report Calendar
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--color-surface-500)] font-medium">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className={cn('w-2 h-2 rounded-full shadow-sm', config.dot)} />
                <span className="capitalize">{status}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 gap-2 mb-2">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
            <div key={day} className="text-center text-xs font-bold text-[var(--color-surface-400)] py-1 uppercase tracking-wider">
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
                  'relative aspect-square rounded-lg flex flex-col items-center justify-center text-xs transition-all border font-medium',
                  day.isFuture
                    ? 'bg-[var(--color-surface-100)]/50 border-transparent text-[var(--color-surface-300)] opacity-40 cursor-not-allowed'
                    : isSelected
                    ? 'ring-2 ring-[var(--color-primary-500)] border-transparent bg-[var(--color-primary-50)]/60 text-[var(--color-primary-600)] shadow-sm'
                    : 'bg-[var(--color-surface-100)] border-[var(--color-surface-200)]/70 hover:bg-[var(--color-surface-100)]/80 hover:border-[var(--color-surface-300)] text-[var(--color-surface-600)] cursor-pointer'
                )}
              >
                <span className="font-bold">{day.dayNum}</span>
                {config && (
                  <span className={cn('w-2 h-2 rounded-full mt-1.5 shadow-sm', config.dot)} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Report Detail */}
      {selectedReport && (
        <div className="card animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-base font-bold text-[var(--color-surface-800)]">
                  Report: {selectedReport.date}
                </h3>
                <span className={cn(
                  'badge flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold',
                  STATUS_CONFIG[selectedReport.status].className
                )}>
                  {selectedReport.status}
                </span>
              </div>
              <p className="text-xs text-[var(--color-surface-400)] mt-1 font-mono font-medium">{selectedReport.id}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => console.log('Download CSV:', selectedReport.id)}
                className="flex items-center gap-1.5 border border-[var(--color-surface-200)] hover:border-[var(--color-surface-300)] text-[var(--color-surface-600)] bg-[var(--color-surface-50)] hover:bg-[var(--color-surface-100)] font-bold px-3 py-2 rounded-lg text-xs transition-all shadow-sm cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV</span>
              </button>
              <button
                onClick={() => console.log('Download JSON:', selectedReport.id)}
                className="flex items-center gap-1.5 bg-[var(--color-primary-500)] hover:bg-[var(--color-primary-600)] text-white font-bold px-3 py-2 rounded-lg text-xs transition-all shadow-sm cursor-pointer active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
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
              <div key={item.label} className="bg-[var(--color-surface-100)]/60 border border-[var(--color-surface-200)] rounded-lg p-3.5">
                <p className="text-[10px] text-[var(--color-surface-400)] font-semibold uppercase tracking-wider">{item.label}</p>
                <p className="text-base font-extrabold text-[var(--color-surface-800)] mt-1 capitalize">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Reports Table */}
      <div className="card animate-fade-in" style={{ animationDelay: '0.5s' }}>
        <h3 className="font-bold text-[var(--color-surface-800)] text-base mb-4">Recent Reports</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-surface-200)]">
                {['Date', 'Report ID', 'Transactions', 'Volume (₦)', 'Match Rate', 'Status', 'Download'].map(h => (
                  <th key={h} className="px-4 py-3.5 text-left text-[10px] font-bold text-[var(--color-surface-400)] uppercase tracking-wider">
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
                    className="border-b border-[var(--color-surface-200)]/40 hover:bg-[var(--color-surface-100)]/50 transition-colors animate-fade-in"
                    style={{ animationDelay: `${0.6 + i * 0.05}s` }}
                  >
                    <td className="px-4 py-3.5 text-[var(--color-surface-700)] font-medium">{report.date}</td>
                    <td className="px-4 py-3.5 font-mono text-xs text-[var(--color-surface-400)]">{report.id}</td>
                    <td className="px-4 py-3.5 text-[var(--color-surface-600)] font-medium">{report.totalTransactions.toLocaleString()}</td>
                    <td className="px-4 py-3.5 font-bold text-[var(--color-surface-800)]">{formatCurrency(report.volumeNgn)}</td>
                    <td className="px-4 py-3.5 font-medium text-[var(--color-surface-600)]">{formatPercent(report.matchRate)}</td>
                    <td className="px-4 py-3.5">
                      <span className={cn('badge flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold', config.className)}>
                        <StatusIcon className="w-3.5 h-3.5" />
                        <span className="capitalize">{report.status}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      {report.status !== 'missing' && (
                        <button className="p-2 rounded-lg border border-transparent hover:border-[var(--color-surface-300)] hover:bg-[var(--color-surface-100)] transition-colors cursor-pointer text-[var(--color-surface-400)] hover:text-[var(--color-surface-600)]">
                          <Download className="w-4 h-4" />
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
