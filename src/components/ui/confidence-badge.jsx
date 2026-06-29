import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, AlertTriangle } from "lucide-react";

export default function ConfidenceBadge({ confidence, showIcon = true, size = "default" }) {
  const getConfidenceConfig = (score) => {
    if (score >= 90) {
      return {
        label: "High Confidence",
        color: "bg-green-100 text-green-800 border-green-300",
        icon: CheckCircle2,
        iconColor: "text-green-600"
      };
    } else if (score >= 70) {
      return {
        label: "Medium Confidence",
        color: "bg-yellow-100 text-yellow-800 border-yellow-300",
        icon: AlertTriangle,
        iconColor: "text-yellow-600"
      };
    } else {
      return {
        label: "Low Confidence",
        color: "bg-red-100 text-red-800 border-red-300",
        icon: AlertCircle,
        iconColor: "text-red-600"
      };
    }
  };

  const config = getConfidenceConfig(confidence);
  const Icon = config.icon;
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-2.5 py-1";

  return (
    <Badge variant="outline" className={`${config.color} ${sizeClasses} flex items-center gap-1 border`}>
      {showIcon && <Icon className={`w-3 h-3 ${config.iconColor}`} />}
      {confidence}% {config.label}
    </Badge>
  );
}

export function ConfidenceProgressBar({ confidence, label }) {
  const getColor = (score) => {
    if (score >= 90) return "bg-green-500";
    if (score >= 70) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-600">{confidence}%</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div
          className={`${getColor(confidence)} h-2 rounded-full transition-all duration-500`}
          style={{ width: `${confidence}%` }}
        />
      </div>
    </div>
  );
}