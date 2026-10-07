import { useQuery } from "@tanstack/react-query";
import { Video, Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";

// Shows the signed-in clinician's own upcoming telehealth visits.
export default function UpcomingTelehealthWidget() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["myUpcomingTelehealth"],
    queryFn: async () => (await base44.functions.invoke("listMyUpcomingTelehealth", {})).data,
  });
  const sessions = data?.sessions || [];

  return (
    <div className="modern-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Video className="w-5 h-5 text-navy-600" />
        <h3 className="text-base font-semibold">Upcoming telehealth</h3>
      </div>
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-slate-400" />}
      {isError && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4" /> Couldn't load your schedule. Try refreshing.
        </p>
      )}
      {!isLoading && !isError && sessions.length === 0 && (
        <p className="text-sm text-slate-500">No upcoming telehealth visits.</p>
      )}
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex justify-between text-sm">
            <span className="font-medium">{s.patient_name || "Patient"}</span>
            <span className="text-slate-500">
              {s.scheduled_at ? format(new Date(s.scheduled_at), "MMM d, h:mm a") : s.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}