import { useMemo, useState } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  addMonths,
  subMonths,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import TimeOffStatusBadge from "./TimeOffStatusBadge";
import { toISODate, requestsCoveringDate, typeLabel } from "./timeOffUtils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TYPE_DOT = {
  vacation: "bg-blue-500",
  sick: "bg-amber-500",
  personal: "bg-navy-500",
  bereavement: "bg-slate-500",
  jury_duty: "bg-slate-500",
  parental: "bg-gold-500",
  unpaid: "bg-slate-400",
  other: "bg-slate-400",
};

export default function TeamTimeOffCalendar({ requests = [] }) {
  const [cursor, setCursor] = useState(() => new Date());
  const [showPending, setShowPending] = useState(false);
  const [selectedDay, setSelectedDay] = useState(null);

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  // For a day: approved people (always) and, optionally, pending ones.
  const peopleOn = (day) => {
    const iso = toISODate(day);
    const approved = requestsCoveringDate(requests, iso);
    const pending = showPending
      ? requestsCoveringDate(requests, iso, { includePending: true }).filter((r) => r.status === "pending")
      : [];
    return { approved, pending, iso };
  };

  const selected = selectedDay
    ? requestsCoveringDate(requests, selectedDay, { includePending: true }).sort((a, b) =>
        (a.employee_name || "").localeCompare(b.employee_name || "")
      )
    : [];

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="w-5 h-5 text-blue-600" />
            Team Calendar
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => subMonths(c, 1))}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold text-slate-700 w-32 text-center">{format(cursor, "MMMM yyyy")}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => setCursor((c) => addMonths(c, 1))}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCursor(new Date())}>
              Today
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Switch id="show-pending" checked={showPending} onCheckedChange={setShowPending} />
          <Label htmlFor="show-pending" className="text-xs text-slate-500 font-normal cursor-pointer">
            Show pending
          </Label>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="bg-slate-50 text-center text-[11px] font-semibold text-slate-500 py-2 uppercase tracking-wide">
              {wd}
            </div>
          ))}
          {days.map((day) => {
            const inMonth = isSameMonth(day, cursor);
            const today = isToday(day);
            const { approved, pending, iso } = peopleOn(day);
            const total = approved.length + pending.length;
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => total > 0 && setSelectedDay(iso)}
                className={`min-h-[88px] p-1.5 text-left align-top transition-colors ${inMonth ? "bg-white" : "bg-slate-50/60"} ${
                  total > 0 ? "hover:bg-blue-50 cursor-pointer" : "cursor-default"
                } ${today ? "ring-2 ring-inset ring-blue-400" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${inMonth ? "text-slate-700" : "text-slate-300"} ${today ? "text-blue-600 font-bold" : ""}`}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-0.5 mt-1">
                  {approved.slice(0, 3).map((r) => (
                    <div
                      key={r.id}
                      className="flex items-center gap-1 text-[11px] text-slate-700 truncate"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${TYPE_DOT[r.request_type] || "bg-slate-400"}`} />
                      <span className="truncate">{(r.employee_name || r.employee_email || "").split(" ")[0]}</span>
                    </div>
                  ))}
                  {showPending &&
                    pending.slice(0, Math.max(0, 3 - approved.length)).map((r) => (
                      <div key={r.id} className="flex items-center gap-1 text-[11px] text-slate-400 italic truncate">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 border border-slate-400" />
                        <span className="truncate">{(r.employee_name || r.employee_email || "").split(" ")[0]}</span>
                      </div>
                    ))}
                  {total > 3 && <div className="text-[10px] text-slate-400 font-medium">+{total - 3} more</div>}
                </div>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
          {[
            ["Vacation", "bg-blue-500"],
            ["Sick", "bg-amber-500"],
            ["Personal", "bg-navy-500"],
            ["Parental", "bg-gold-500"],
            ["Other", "bg-slate-400"],
          ].map(([label, dot]) => (
            <span key={label} className="inline-flex items-center gap-1">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!selectedDay} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedDay
                ? new Date(`${selectedDay}T00:00:00`).toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })
                : ""}
            </DialogTitle>
            <DialogDescription>
              {selected.length} {selected.length === 1 ? "person" : "people"} off this day
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
            {selected.map((r) => (
              <li key={r.id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{r.employee_name || r.employee_email}</p>
                  <p className="text-xs text-slate-500">{typeLabel(r.request_type)}</p>
                </div>
                <TimeOffStatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
