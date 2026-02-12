import React from "react";
import { Lightbulb, AlertTriangle, Info } from "lucide-react";

export default function DocTip({ type = "tip", children }) {
  const config = {
    tip: { icon: Lightbulb, bg: "bg-emerald-50 dark:bg-emerald-900/20", border: "border-emerald-300 dark:border-emerald-700", iconColor: "text-emerald-600", label: "Pro Tip" },
    warning: { icon: AlertTriangle, bg: "bg-amber-50 dark:bg-amber-900/20", border: "border-amber-300 dark:border-amber-700", iconColor: "text-amber-600", label: "Important" },
    info: { icon: Info, bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-300 dark:border-blue-700", iconColor: "text-blue-600", label: "Note" },
  };

  const { icon: Icon, bg, border, iconColor, label } = config[type];

  return (
    <div className={`${bg} ${border} border rounded-lg p-4 my-4 flex gap-3`}>
      <Icon className={`h-5 w-5 ${iconColor} flex-shrink-0 mt-0.5`} />
      <div>
        <span className={`text-xs font-bold uppercase ${iconColor}`}>{label}</span>
        <p className="text-sm text-slate-700 dark:text-slate-300 mt-1 leading-relaxed">{children}</p>
      </div>
    </div>
  );
}