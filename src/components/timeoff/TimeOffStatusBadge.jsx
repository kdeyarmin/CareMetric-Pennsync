import { CheckCircle2, XCircle, Hourglass, Ban } from "lucide-react";
import { statusLabel } from "./timeOffUtils";

const STYLES = {
  pending: { className: "bg-amber-100 text-amber-800 border border-amber-200", Icon: Hourglass },
  approved: { className: "bg-emerald-100 text-emerald-800 border border-emerald-200", Icon: CheckCircle2 },
  denied: { className: "bg-red-100 text-red-800 border border-red-200", Icon: XCircle },
  cancelled: { className: "bg-slate-100 text-slate-600 border border-slate-200", Icon: Ban },
};

export default function TimeOffStatusBadge({ status, className = "" }) {
  const style = STYLES[status] || STYLES.pending;
  const Icon = style.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {statusLabel(status)}
    </span>
  );
}
