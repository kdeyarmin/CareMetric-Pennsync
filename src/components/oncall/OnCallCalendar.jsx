import { useMemo } from "react";
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  format,
  isSameMonth,
  isToday,
} from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { toISO, holidayNameFor, needsOvernight } from "./holidays";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Build the required coverage slot for a given day (or null if none needed).
// Holidays take precedence over the weekday overnight rule.
export function slotForDay(date) {
  const iso = toISO(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const holiday = holidayNameFor(date);
  if (holiday) {
    return {
      iso,
      coverage_type: "holiday",
      holiday_name: holiday,
      start_label: "All day",
      end_label: "All day",
    };
  }
  if (needsOvernight(date)) {
    return {
      iso,
      coverage_type: "overnight",
      holiday_name: "",
      start_label: "5:00 PM",
      end_label: "9:00 AM next day",
    };
  }
  return null;
}

export default function OnCallCalendar({ cursor, setCursor, shiftsByDate, isAdmin, onSelectSlot }) {
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 0 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 0 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const move = (delta) => {
    const next = new Date(cursor);
    next.setMonth(next.getMonth() + delta);
    setCursor(next);
  };

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
            On-Call Coverage
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-sm font-semibold text-slate-700 w-32 text-center">{format(cursor, "MMMM yyyy")}</span>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => move(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setCursor(new Date())}>
              Today
            </Button>
          </div>
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
            const slot = slotForDay(day);
            const shift = slot ? shiftsByDate[slot.iso] : null;
            const assigned = shift?.assigned_user_name;
            const clickable = !!slot && isAdmin;

            return (
              <button
                key={day.toISOString()}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelectSlot({ ...slot, shift })}
                className={`min-h-[92px] p-1.5 text-left align-top transition-colors ${inMonth ? "bg-white" : "bg-slate-50/60"} ${
                  clickable ? "hover:bg-blue-50 cursor-pointer" : "cursor-default"
                } ${today ? "ring-2 ring-inset ring-blue-400" : ""}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-medium ${inMonth ? "text-slate-700" : "text-slate-300"} ${today ? "text-blue-600 font-bold" : ""}`}>
                    {format(day, "d")}
                  </span>
                </div>

                {slot && (
                  <div className="mt-1 space-y-1">
                    {slot.coverage_type === "holiday" ? (
                      <span className="block text-[10px] font-semibold text-red-700 leading-tight truncate" title={slot.holiday_name}>
                        {slot.holiday_name}
                      </span>
                    ) : (
                      <span className="block text-[10px] text-slate-400 leading-tight">5p–9a</span>
                    )}

                    {assigned ? (
                      <div
                        className={`text-[11px] font-medium rounded px-1 py-0.5 truncate ${
                          slot.coverage_type === "holiday" ? "bg-red-50 text-red-800" : "bg-blue-50 text-blue-800"
                        }`}
                        title={assigned}
                      >
                        {assigned.split(" ")[0]}
                      </div>
                    ) : (
                      <div className="text-[11px] text-amber-600 font-medium truncate">Unassigned</div>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-red-600" /> Holiday (all day)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-blue-500" /> Overnight 5pm–9am (Mon–Thu)
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Unassigned
          </span>
        </div>
      </CardContent>
    </Card>
  );
}