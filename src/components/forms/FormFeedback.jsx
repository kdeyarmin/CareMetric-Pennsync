import React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

export function FormError({ message, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-900 ${className}`}>
      <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-700 dark:text-red-300">{message}</p>
    </div>
  );
}

export function FormSuccess({ message, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-900 ${className}`}>
      <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-green-700 dark:text-green-300">{message}</p>
    </div>
  );
}

export function FormInfo({ message, className = '' }) {
  if (!message) return null;
  return (
    <div className={`flex items-start gap-2 p-3 rounded-lg bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-900 ${className}`}>
      <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-blue-700 dark:text-blue-300">{message}</p>
    </div>
  );
}