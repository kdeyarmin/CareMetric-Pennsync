import React from 'react';
import { cn } from '@/lib/utils';

export function SkeletonCard({ className }) {
  return (
    <div className={cn('rounded-lg border border-slate-200 dark:border-slate-700 p-6 space-y-4', className)}>
      <div className="h-6 bg-slate-200 dark:bg-slate-700 rounded w-3/4 animate-pulse" />
      <div className="space-y-2">
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-full animate-pulse" />
        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6 animate-pulse" />
      </div>
    </div>
  );
}

export function SkeletonTable({ rows = 5 }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
      ))}
    </div>
  );
}

export function SkeletonList({ items = 4 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: items }).map((_, i) => (
        <div key={i} className="flex gap-4 p-4 rounded-lg border border-slate-200 dark:border-slate-700">
          <div className="h-12 w-12 bg-slate-200 dark:bg-slate-700 rounded-full animate-pulse flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4 animate-pulse" />
            <div className="h-3 bg-slate-200 dark:bg-slate-700 rounded w-1/2 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}