import { useMemo } from "react";
import StatCard from "@/components/ui/stat-card";
import { Hourglass, CalendarCheck, CalendarClock } from "lucide-react";
import { approvedDaysInYear, isUpcoming, totalRequestedDays } from "./timeOffUtils";

export default function TimeOffSummaryCards({ requests = [] }) {
  const stats = useMemo(() => {
    const year = new Date().getFullYear();
    const pending = requests.filter((r) => r.status === "pending");
    const upcoming = requests.filter((r) => r.status === "approved" && isUpcoming(r));
    const upcomingDays = upcoming.reduce(
      (sum, r) => sum + (Number(r.total_days) || totalRequestedDays(r.start_date, r.end_date, r.half_day)),
      0
    );
    return {
      pendingCount: pending.length,
      upcomingCount: upcoming.length,
      upcomingDays,
      usedThisYear: approvedDaysInYear(requests, year),
      year,
    };
  }, [requests]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard
        icon={Hourglass}
        label="Awaiting approval"
        value={stats.pendingCount}
        sub={stats.pendingCount === 1 ? "1 request pending" : `${stats.pendingCount} requests pending`}
        accent="#d97706"
      />
      <StatCard
        icon={CalendarClock}
        label="Upcoming time off"
        value={stats.upcomingCount}
        sub={`${stats.upcomingDays} day${stats.upcomingDays === 1 ? "" : "s"} scheduled`}
        accent="#264491"
      />
      <StatCard
        icon={CalendarCheck}
        label={`Days off in ${stats.year}`}
        value={stats.usedThisYear}
        sub="Approved this calendar year"
        accent="#059669"
      />
    </div>
  );
}
