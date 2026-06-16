import { Inbox, AlertCircle, RotateCw } from 'lucide-react';

export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-slate-500/15 ${className}`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between mb-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="w-7 h-7 rounded-lg" />
      </div>
      <Skeleton className="h-7 w-16" />
    </div>
  );
}

export function ChartSkeleton({ height = 260 }) {
  return <div className="animate-pulse rounded-xl bg-slate-500/10 w-full" style={{ height }} />;
}

export function TableRowSkeleton({ cols = 5 }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="py-3 pr-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action = null }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-full bg-slate-500/10 flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-slate-500" />
      </div>
      <p className="text-sm font-semibold font-heading text-[var(--text-primary)]">{title}</p>
      {description && <p className="text-xs text-[var(--text-secondary-2)] mt-1 max-w-sm">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3">
        <AlertCircle className="w-5 h-5 text-[var(--accent-red)]" />
      </div>
      <p className="text-sm font-semibold font-heading text-[var(--accent-red)]">Something went wrong</p>
      {message && <p className="text-xs text-[var(--text-secondary-2)] mt-1 max-w-sm">{message}</p>}
      {onRetry && (
        <button onClick={onRetry}
          className="mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white/[0.04] hover:bg-white/[0.08] text-[var(--text-primary)] transition">
          <RotateCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}
