import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sun, CalendarClock } from "lucide-react";
import { toISODate, requestCoversDate, typeLabel, formatDateRange, parseISODate } from "./timeOffUtils";

function PersonRow({ request }) {
  const initials = (request.employee_name || request.employee_email || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-semibold flex items-center justify-center flex-shrink-0">
        {initials}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 truncate">
          {request.employee_name || request.employee_email}
        </p>
        <p className="text-xs text-slate-500 truncate">
          {typeLabel(request.request_type)} · {formatDateRange(request.start_date, request.end_date)}
        </p>
      </div>
    </li>
  );
}

export default function WhoIsOffPanel({ requests = [], windowDays = 14 }) {
  const { outToday, upcoming } = useMemo(() => {
    const approved = requests.filter((r) => r.status === "approved");
    const now = new Date();
    const todayIso = toISODate(now);
    const horizon = new Date(now.getFullYear(), now.getMonth(), now.getDate() + windowDays);

    const outToday = approved
      .filter((r) => requestCoversDate(r, todayIso))
      .sort((a, b) => (a.end_date || "").localeCompare(b.end_date || ""));

    const upcoming = approved
      .filter((r) => {
        const start = parseISODate(r.start_date);
        if (!start) return false;
        return start > now && start <= horizon;
      })
      .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || ""));

    return { outToday, upcoming };
  }, [requests, windowDays]);

  return (
    <div className="space-y-4">
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sun className="w-4 h-4 text-amber-500" />
            Out Today
            <span className="text-sm font-normal text-slate-400">({outToday.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {outToday.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">Everyone is in today.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {outToday.map((r) => (
                <PersonRow key={r.id} request={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="w-4 h-4 text-blue-500" />
            Upcoming (next {windowDays} days)
            <span className="text-sm font-normal text-slate-400">({upcoming.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">No approved time off coming up.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((r) => (
                <PersonRow key={r.id} request={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
