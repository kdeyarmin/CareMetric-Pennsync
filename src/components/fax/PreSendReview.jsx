import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, CheckCircle2, Shield, Phone, FileText,
  User, X, ChevronRight, Sparkles
} from "lucide-react";

const SEVERITY_CONFIG = {
  error: { bg: "bg-red-50 border-red-200", icon: AlertTriangle, iconColor: "text-red-500", badge: "bg-red-100 text-red-700" },
  warning: { bg: "bg-amber-50 border-amber-200", icon: AlertTriangle, iconColor: "text-amber-500", badge: "bg-amber-100 text-amber-700" },
  info: { bg: "bg-blue-50 border-blue-200", icon: Sparkles, iconColor: "text-blue-500", badge: "bg-blue-100 text-blue-700" },
  success: { bg: "bg-green-50 border-green-200", icon: CheckCircle2, iconColor: "text-green-500", badge: "bg-green-100 text-green-700" },
};

export default function PreSendReview({ items, onDismiss, onApplyFix }) {
  if (!items || items.length === 0) return null;

  const grouped = {
    error: items.filter(i => i.severity === "error"),
    warning: items.filter(i => i.severity === "warning"),
    info: items.filter(i => i.severity === "info"),
    success: items.filter(i => i.severity === "success"),
  };

  const errorCount = grouped.error.length;
  const warningCount = grouped.warning.length;

  return (
    <div className="space-y-2">
      {/* Header summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-purple-600" />
          <span className="text-xs font-semibold text-purple-900">Pre-Send Review</span>
        </div>
        <div className="flex items-center gap-1.5">
          {errorCount > 0 && <Badge className="text-[9px] bg-red-100 text-red-700">{errorCount} issue{errorCount > 1 ? "s" : ""}</Badge>}
          {warningCount > 0 && <Badge className="text-[9px] bg-amber-100 text-amber-700">{warningCount} warning{warningCount > 1 ? "s" : ""}</Badge>}
          {errorCount === 0 && warningCount === 0 && <Badge className="text-[9px] bg-green-100 text-green-700">All clear</Badge>}
        </div>
      </div>

      {/* Items */}
      {["error", "warning", "info", "success"].map(severity => (
        grouped[severity].map((item, idx) => {
          const config = SEVERITY_CONFIG[severity];
          const Icon = config.icon;
          return (
            <div key={`${severity}-${idx}`} className={`rounded-lg border p-2.5 ${config.bg}`}>
              <div className="flex items-start gap-2">
                <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${config.iconColor}`} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Badge className={`text-[8px] px-1 py-0 ${config.badge}`}>{item.area}</Badge>
                    <span className="text-[11px] font-medium text-slate-800">{item.title}</span>
                  </div>
                  <p className="text-[10px] text-slate-600 leading-relaxed">{item.message}</p>
                  {item.fix && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[10px] px-1.5 gap-0.5 text-blue-700 hover:bg-blue-100 p-0"
                      onClick={() => onApplyFix(item)}
                    >
                      <ChevronRight className="w-2.5 h-2.5" /> {item.fix.label}
                    </Button>
                  )}
                </div>
                <button onClick={() => onDismiss(item.id)} className="flex-shrink-0 mt-0.5">
                  <X className="w-3 h-3 text-slate-400 hover:text-slate-600" />
                </button>
              </div>
            </div>
          );
        })
      ))}
    </div>
  );
}