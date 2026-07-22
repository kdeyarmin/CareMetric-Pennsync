import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { format, isValid } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { buildAgingBoard, TIMELY_INITIATION_DAYS } from "./intakeToSocTracker";
import { parseLocalDate } from "@/lib/dateLocal";

// Referral dates can be AI-extracted free-text strings; guard every format the
// same way ReferralIntake does so a bad date can't crash the board. parseLocalDate
// reads a date-only YYYY-MM-DD on the local calendar (not UTC midnight, which
// rendered a day early) and falls back to Date parsing for free-text values.
const safeDate = (value) => {
  const d = parseLocalDate(value);
  return d && isValid(d) ? format(d, "MM/dd/yyyy") : null;
};

const BUCKET_ORDER = ["on_track", "due_soon", "overdue"];

const BUCKET_STYLES = {
  on_track: {
    label: "On Track",
    hint: `under ${TIMELY_INITIATION_DAYS} days old`,
    icon: CheckCircle2,
    panel: "border-emerald-200 bg-emerald-50/60",
    header: "text-emerald-800",
    chip: "bg-emerald-600 text-white",
    age: "text-emerald-700",
  },
  due_soon: {
    label: "Due Soon",
    hint: `day ${TIMELY_INITIATION_DAYS} — SOC due today`,
    icon: Clock,
    panel: "border-amber-200 bg-amber-50/60",
    header: "text-amber-800",
    chip: "bg-amber-500 text-white",
    age: "text-amber-700",
  },
  overdue: {
    label: "Overdue",
    hint: `past the ${TIMELY_INITIATION_DAYS}-day window`,
    icon: AlertTriangle,
    panel: "border-red-200 bg-red-50/60",
    header: "text-red-800",
    chip: "bg-red-600 text-white",
    age: "text-red-700",
  },
};

const MAX_ROWS = 6;
const MAX_ROWS_COMPACT = 3;

function EntryRow({ entry, ageClassName }) {
  return (
    <li className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-md px-2.5 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">
          {entry.patient_name || "Unknown patient"}
        </p>
        <p className="text-xs text-slate-500 truncate">
          {safeDate(entry.referral_date) || "No referral date"}
          {entry.status ? ` · ${String(entry.status).replace(/_/g, " ")}` : ""}
        </p>
      </div>
      <span className={cn("text-sm font-bold tabular-nums flex-shrink-0", ageClassName)}>
        {entry.age_days}d
      </span>
    </li>
  );
}

/**
 * ReferralAgingBoard — intake-queue workflow board for the referral→SOC clock.
 *
 * Pure presentation over `buildAgingBoard` (intakeToSocTracker.js): open
 * referrals without a start-of-care date are bucketed on-track / due-soon /
 * overdue against the CMS Timely Initiation of Care 2-day window, oldest first.
 * The referral pipeline lives entirely in this app, so this is safe workflow UI
 * in companion mode — it renders queue state only (no alerts, no toasts).
 *
 * @param {Array} referrals  Referral records (pass the page's existing query data)
 * @param {boolean} [compact]  Condensed single-card variant for secondary pages
 * @param {(string|Date)} [asOf]  Reference "today" (primarily for tests)
 * @param {string} [className]
 */
export default function ReferralAgingBoard({ referrals = [], compact = false, asOf, className }) {
  const board = useMemo(
    () => buildAgingBoard(referrals, asOf ? { asOf } : undefined),
    [referrals, asOf]
  );

  if (compact) {
    // Needs-attention list: overdue first, then due-soon (each already oldest-first).
    const attention = [...board.buckets.overdue, ...board.buckets.due_soon].slice(0, MAX_ROWS_COMPACT);
    return (
      <Card className={className}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2 flex-wrap">
            <Hourglass className="w-5 h-5 text-navy-600" />
            Referral aging
            <span className="flex gap-1 flex-wrap">
              {BUCKET_ORDER.map((key) => (
                <Badge key={key} className={cn("text-xs", BUCKET_STYLES[key].chip)}>
                  {board.counts[key]} {BUCKET_STYLES[key].label.toLowerCase()}
                </Badge>
              ))}
            </span>
          </CardTitle>
          <p className="text-xs text-slate-500">
            Open referrals still waiting on a start-of-care visit ({TIMELY_INITIATION_DAYS}-day timely-initiation window).
          </p>
        </CardHeader>
        <CardContent>
          {board.total_open === 0 ? (
            <p className="text-sm text-slate-600">No open referrals waiting on start of care.</p>
          ) : attention.length === 0 ? (
            <p className="text-sm text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Every open referral is on track.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {attention.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  ageClassName={BUCKET_STYLES[entry.aging_bucket]?.age}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 flex-wrap">
          <Hourglass className="w-5 h-5 text-navy-600" />
          Referral Aging — Intake to Start of Care
          <Badge variant="outline" className="text-xs font-normal">
            {board.total_open} open
          </Badge>
          {board.oldest_age_days != null && (
            <span className="text-xs font-normal text-slate-500">
              oldest: {board.oldest_age_days}d
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-slate-500">
          Open referrals waiting on a start-of-care visit, oldest first ({TIMELY_INITIATION_DAYS}-day timely-initiation window).
        </p>
      </CardHeader>
      <CardContent>
        {board.total_open === 0 ? (
          <p className="text-sm text-slate-600">No open referrals waiting on start of care.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {BUCKET_ORDER.map((key) => {
              const style = BUCKET_STYLES[key];
              const entries = board.buckets[key];
              const Icon = style.icon;
              return (
                <div key={key} className={cn("border rounded-lg p-3", style.panel)}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className={cn("text-xs font-semibold uppercase flex items-center gap-1.5", style.header)}>
                      <Icon className="w-4 h-4" aria-hidden="true" />
                      {style.label}
                    </p>
                    <Badge className={cn("text-xs", style.chip)}>{entries.length}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 mb-2">{style.hint}</p>
                  {entries.length === 0 ? (
                    <p className="text-xs text-slate-500">None</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {entries.slice(0, MAX_ROWS).map((entry) => (
                        <EntryRow key={entry.id} entry={entry} ageClassName={style.age} />
                      ))}
                      {entries.length > MAX_ROWS && (
                        <li className="text-xs text-slate-500 px-1">
                          + {entries.length - MAX_ROWS} more
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
