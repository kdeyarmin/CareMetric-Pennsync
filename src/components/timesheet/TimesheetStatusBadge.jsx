import { CheckCircle2, XCircle, Hourglass, FileEdit } from "lucide-react";
import { timesheetStatusLabel } from "./timesheetUtils";

const STYLES = {
  draft: { className: "bg-slate-100 text-slate-600 border border-slate-200", Icon: FileEdit },
  submitted: { className: "bg-amber-100 text-amber-800 border border-amber-200", Icon: Hourglass },
  approved: { className: "bg-emerald-100 text-emerald-800 border border-emerald-200", Icon: CheckCircle2 },
  rejected: { className: "bg-red-100 text-red-800 border border-red-200", Icon: XCircle },
};

export default function TimesheetStatusBadge({ status, className = "" }) {
  const style = STYLES[status] || STYLES.draft;
  const Icon = style.Icon;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.className} ${className}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {timesheetStatusLabel(status)}
    </span>
  );
}
