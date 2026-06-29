import { Badge } from "@/components/ui/badge";

const statusClasses = {
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  expired: "bg-red-100 text-red-800",
};

export default function PersonnelStatusBadge({ status }) {
  return <Badge className={statusClasses[status] || "bg-slate-100 text-slate-800"}>{status?.replace(/_/g, ' ') || 'unknown'}</Badge>;
}