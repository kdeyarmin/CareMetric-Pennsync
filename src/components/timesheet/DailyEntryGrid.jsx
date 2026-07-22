import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  VISIT_TYPES,
  DAILY_HOUR_FIELDS,
  toNumber,
  pointFieldFor,
} from "./timesheetUtils";
import { parseISODate } from "../timeoff/timeOffUtils";

/**
 * Per-day entry grid for a pay period. The nurse fills the days they worked;
 * columns depend on the service line (home health adds the visit-type point
 * columns, hospice adds on-call Visits). A footer row shows the rolled-up
 * totals (and total points for home health). Values live in the parent form.
 *
 * @param {string[]} days   pay-period days (YYYY-MM-DD)
 * @param {string} serviceType
 * @param {object} visitPointConfig
 * @param {object} value    { [date]: { regular_hours, soc, … } } (flat per day)
 * @param {(date: string, key: string, val: string) => void} onCell
 */
export default function DailyEntryGrid({ days = [], serviceType, earnsPoints = false, visitPointConfig, value = {}, onCell }) {
  const columns = useMemo(() => {
    const hourCols = DAILY_HOUR_FIELDS.map((f) => ({ ...f, step: "0.25" }));
    const visitCols = earnsPoints
      ? VISIT_TYPES.map((vt) => ({ key: vt.key, label: vt.label, step: "1", isVisit: true }))
      : [];
    const tailCols = serviceType === "hospice" ? [{ key: "on_call_visits", label: "Visits", step: "1" }] : [];
    return [...visitCols, ...hourCols, ...tailCols];
  }, [earnsPoints, serviceType]);

  const totals = useMemo(() => {
    const t = {};
    for (const col of columns) t[col.key] = 0;
    for (const d of days) {
      for (const col of columns) t[col.key] += toNumber(value?.[d]?.[col.key]);
    }
    return t;
  }, [columns, days, value]);

  const totalPoints = useMemo(() => {
    if (!earnsPoints) return 0;
    let p = 0;
    for (const vt of VISIT_TYPES) p += toNumber(totals[vt.key]) * toNumber(visitPointConfig?.[pointFieldFor(vt.key)]);
    return Math.round(p * 100) / 100;
  }, [earnsPoints, totals, visitPointConfig]);

  const dayLabel = (iso) => {
    const d = parseISODate(iso);
    if (!d) return iso;
    return d.toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
  };
  const isWeekend = (iso) => {
    const d = parseISODate(iso);
    return d && (d.getDay() === 0 || d.getDay() === 6);
  };

  const fmt = (n) => {
    const r = Math.round(toNumber(n) * 100) / 100;
    return r === 0 ? "" : String(r);
  };

  // <Table> provides its own overflow-auto scroll wrapper (the sticky Day
  // column anchors to it); the outer div only draws the border frame.
  return (
    <div className="border border-slate-200 rounded-lg">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 bg-slate-50 border-r border-slate-200">
              Day
            </TableHead>
            {columns.map((col) => (
              <TableHead key={col.key} className="text-center">
                {col.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {days.map((d) => (
            <TableRow key={d} className={isWeekend(d) ? "bg-slate-50/40" : ""}>
              <TableCell className={`sticky left-0 z-10 border-r border-slate-200 px-2 py-1 text-slate-600 ${isWeekend(d) ? "bg-slate-100" : "bg-white"}`}>
                {dayLabel(d)}
              </TableCell>
              {columns.map((col) => (
                <TableCell key={col.key} className="px-1 py-0.5">
                  <Input
                    type="number"
                    min="0"
                    step={col.step}
                    inputMode="decimal"
                    aria-label={`${dayLabel(d)} ${col.label}`}
                    className="h-8 w-16 text-center px-1"
                    value={value?.[d]?.[col.key] ?? ""}
                    onChange={(e) => onCell(d, col.key, e.target.value)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
        <tfoot>
          <tr className="bg-slate-100 font-semibold">
            <td className="sticky left-0 z-10 bg-slate-100 border-t border-r border-slate-200 px-2 py-1.5 text-slate-800">
              Total{earnsPoints ? ` · ${totalPoints} pts` : ""}
            </td>
            {columns.map((col) => (
              <td key={col.key} className="border-t border-slate-200 px-1.5 py-1.5 text-center tabular-nums text-slate-800">
                {fmt(totals[col.key])}
              </td>
            ))}
          </tr>
        </tfoot>
      </Table>
    </div>
  );
}
