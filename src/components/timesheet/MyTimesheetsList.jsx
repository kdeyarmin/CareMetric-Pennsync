import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, MessageSquare, Pencil } from "lucide-react";
import TimesheetStatusBadge from "./TimesheetStatusBadge";
import {
  payPeriodLabel,
  serviceTypeLabel,
  totalPaidHours,
  effectiveVacationHours,
  toNumber,
  paysByPoints,
} from "./timesheetUtils";

export default function MyTimesheetsList({ timesheets = [], onEdit }) {
  const sorted = useMemo(
    () =>
      [...timesheets].sort((a, b) => (b.pay_period_start || "").localeCompare(a.pay_period_start || "")),
    [timesheets]
  );

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardList className="w-5 h-5 text-slate-600" />
          My Timesheets
          <span className="text-sm font-normal text-slate-400">({sorted.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">You haven't submitted any timesheets yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((t) => {
              const hours = totalPaidHours(t);
              const vacation = effectiveVacationHours(t);
              const canEdit = t.status === "draft" || t.status === "rejected";
              return (
                <li key={t.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900">
                        {payPeriodLabel(t.pay_period_start, t.pay_period_end)}
                      </span>
                      <TimesheetStatusBadge status={t.status} />
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {serviceTypeLabel(t.service_type)} · {hours} hrs
                      {paysByPoints(t.service_type) && toNumber(t.regular_points) > 0
                        ? ` · ${toNumber(t.regular_points)} pts`
                        : ""}
                      {vacation > 0 ? ` · ${vacation} PTO hrs` : ""}
                    </p>
                    {toNumber(t.auto_pto_hours) > 0 && (
                      <p className="text-xs text-emerald-700 mt-0.5">
                        Includes {toNumber(t.auto_pto_hours)} hrs carried from approved PTO.
                      </p>
                    )}
                    {t.review_notes && (
                      <p className="text-sm text-slate-600 mt-1 flex items-start gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-slate-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{t.reviewer_name || "Reviewer"}:</span> {t.review_notes}
                        </span>
                      </p>
                    )}
                  </div>
                  {canEdit && onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-500 hover:text-blue-600 flex-shrink-0"
                      onClick={() => onEdit(t)}
                    >
                      <Pencil className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
