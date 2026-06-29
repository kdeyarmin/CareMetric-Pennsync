import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Video, Calendar, Clock, ArrowRight } from "lucide-react";
import { formatEastern } from "@/components/utils/timezone";

// Dashboard reminder of telehealth visits the user has scheduled. Pulls
// upcoming (scheduled/active) sessions and surfaces the soonest few so the
// clinician is reminded to join. Hidden entirely when nothing is scheduled.
export default function UpcomingTelehealthWidget() {
  const { data: sessions = [] } = useQuery({
    queryKey: ["telehealth-sessions"],
    queryFn: () => base44.entities.TelehealthSession.list("-created_date", 50),
    refetchInterval: 60000,
    initialData: [],
  });

  const upcoming = sessions
    .filter((s) => s.status === "scheduled" || s.status === "active")
    .sort((a, b) => new Date(a.scheduled_at || 0) - new Date(b.scheduled_at || 0));

  if (upcoming.length === 0) return null;

  return (
    <Card className="bg-white">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-navy-50 text-navy-700 ring-1 ring-inset ring-navy-200">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Scheduled Telehealth</h3>
              <p className="text-xs text-slate-500">{upcoming.length} upcoming visit{upcoming.length > 1 ? "s" : ""}</p>
            </div>
          </div>
          <Link to="/Telehealth">
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          </Link>
        </div>

        <div className="space-y-2">
          {upcoming.slice(0, 4).map((s) => (
            <Link
              key={s.id}
              to={`/Telehealth?room=${encodeURIComponent(s.room_name)}`}
              className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 hover:border-navy-200 hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{s.patient_name || "Patient"}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {s.scheduled_at ? formatEastern(new Date(s.scheduled_at), "MMM d") : "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {s.scheduled_at ? formatEastern(new Date(s.scheduled_at), "h:mm a") : "—"}
                  </span>
                </div>
              </div>
              {s.status === "active" ? (
                <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Live</Badge>
              ) : (
                <Badge className="bg-blue-100 text-blue-700 border-blue-200">Scheduled</Badge>
              )}
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}