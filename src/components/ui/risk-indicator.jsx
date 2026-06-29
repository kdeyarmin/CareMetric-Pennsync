import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, CheckCircle } from "lucide-react";

export default function RiskIndicator({ level = "low", score, label, showIcon = true, size = "md" }) {
  const configs = {
    critical: {
      dot: "risk-indicator-critical",
      badge: "badge-critical",
      icon: AlertCircle,
      color: "text-red-600",
      bg: "bg-red-50"
    },
    high: {
      dot: "risk-indicator-high",
      badge: "badge-warning",
      icon: AlertTriangle,
      color: "text-amber-600",
      bg: "bg-amber-50"
    },
    moderate: {
      dot: "risk-indicator-moderate",
      badge: "badge-warning",
      icon: AlertTriangle,
      color: "text-yellow-600",
      bg: "bg-yellow-50"
    },
    medium: {
      dot: "risk-indicator-moderate",
      badge: "badge-warning",
      icon: AlertTriangle,
      color: "text-yellow-600",
      bg: "bg-yellow-50"
    },
    low: {
      dot: "risk-indicator-low",
      badge: "badge-success",
      icon: CheckCircle,
      color: "text-green-600",
      bg: "bg-green-50"
    }
  };

  const config = configs[level?.toLowerCase()] || configs.low;
  const Icon = config.icon;
  
  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
    lg: "px-4 py-1.5 text-base"
  };

  return (
    <div className={cn("inline-flex items-center gap-2", config.badge, sizeClasses[size])}>
      {showIcon && <Icon className="w-3.5 h-3.5" />}
      {label && <span className="font-medium">{label}</span>}
      {score !== undefined && (
        <span className="font-semibold ml-1">{Math.round(score)}</span>
      )}
    </div>
  );
}

export function RiskDot({ level = "low", className }) {
  const configs = {
    critical: "risk-indicator-critical",
    high: "risk-indicator-high",
    moderate: "risk-indicator-moderate",
    medium: "risk-indicator-moderate",
    low: "risk-indicator-low"
  };

  return <div className={cn(configs[level?.toLowerCase()] || configs.low, className)} />;
}