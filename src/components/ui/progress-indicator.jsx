import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export function ProgressBar({ value = 0, max = 100, label, variant = "default", className }) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  
  const variants = {
    default: "from-blue-500 to-indigo-600",
    success: "from-green-500 to-emerald-600",
    warning: "from-amber-500 to-orange-600",
    critical: "from-red-500 to-red-600",
    ai: "from-navy-500 to-indigo-600"
  };

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-slate-700">{label}</span>
          <span className="text-slate-500">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className="progress-bar">
        <div 
          className={cn("progress-fill bg-gradient-to-r", variants[variant])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export function LoadingSpinner({ size = "default", text, className }) {
  const sizes = {
    sm: "w-4 h-4",
    default: "w-6 h-6",
    lg: "w-8 h-8"
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Loader2 className={cn("animate-spin text-blue-600", sizes[size])} />
      {text && <span className="text-sm text-slate-600">{text}</span>}
    </div>
  );
}

export function SkeletonCard({ lines = 3 }) {
  return (
    <div className="modern-card p-6 space-y-4">
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-full pulse-loader" />
        <div className="flex-1 space-y-2">
          <div className="h-4 pulse-loader rounded w-3/4" />
          <div className="h-3 pulse-loader rounded w-1/2" />
        </div>
      </div>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="h-3 pulse-loader rounded" style={{ width: `${Math.random() * 30 + 70}%` }} />
      ))}
    </div>
  );
}

export function CircularProgress({ value = 0, size = 80, strokeWidth = 8, variant = "default" }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const percentage = Math.min(Math.max(value, 0), 100);
  const offset = circumference - (percentage / 100) * circumference;

  const variants = {
    default: "stroke-blue-600",
    success: "stroke-green-600",
    warning: "stroke-amber-600",
    critical: "stroke-red-600",
    ai: "stroke-navy-600"
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="none"
          className="text-slate-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={cn("transition-all duration-500", variants[variant])}
        />
      </svg>
      <span className="absolute text-sm font-semibold text-slate-700">
        {Math.round(percentage)}%
      </span>
    </div>
  );
}