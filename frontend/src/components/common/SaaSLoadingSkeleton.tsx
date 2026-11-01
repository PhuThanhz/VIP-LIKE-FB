import React from 'react';

export const CardSkeleton: React.FC<{ count?: number; className?: string }> = ({ count = 4, className = '' }) => {
  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl border border-slate-800/80 bg-slate-950/60 animate-pulse flex flex-col justify-between h-24"
        >
          <div className="h-3 w-1/2 bg-slate-800 rounded"></div>
          <div className="h-6 w-3/4 bg-slate-800/80 rounded mt-2"></div>
        </div>
      ))}
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number; columns?: number; className?: string }> = ({
  rows = 5,
  columns = 4,
  className = '',
}) => {
  return (
    <div className={`w-full rounded-xl border border-slate-800/80 bg-slate-950/60 p-4 space-y-3 ${className}`}>
      {/* Header skeleton */}
      <div className="grid grid-cols-12 gap-3 pb-3 border-b border-slate-800/60">
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="col-span-3 h-3 bg-slate-800/90 rounded animate-pulse"></div>
        ))}
      </div>
      {/* Row skeletons */}
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="grid grid-cols-12 gap-3 py-2.5 items-center border-b border-slate-800/30 last:border-none">
          <div className="col-span-3 h-4 bg-slate-800/60 rounded animate-pulse"></div>
          <div className="col-span-4 h-4 bg-slate-800/40 rounded animate-pulse"></div>
          <div className="col-span-3 h-4 bg-slate-800/50 rounded animate-pulse"></div>
          <div className="col-span-2 h-4 bg-slate-800/60 rounded animate-pulse"></div>
        </div>
      ))}
    </div>
  );
};

export const PageSkeleton: React.FC<{ title?: string }> = ({ title = 'Đang tải phân hệ...' }) => {
  return (
    <div className="space-y-4 p-4 sm:p-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800/60">
        <div className="space-y-2">
          <div className="h-6 w-48 bg-slate-800 rounded"></div>
          <div className="h-3 w-72 bg-slate-800/60 rounded"></div>
        </div>
        <div className="h-9 w-28 bg-slate-800/80 rounded-xl"></div>
      </div>

      {/* Metric Cards */}
      <CardSkeleton count={4} />

      {/* Main Table */}
      <TableSkeleton rows={6} columns={4} />
      
      <div className="text-center pt-2">
        <span className="text-xs text-slate-500 font-mono">{title}</span>
      </div>
    </div>
  );
};

export default PageSkeleton;
