import { useQuery } from "@tanstack/react-query";
import { Video, Loader2, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";

function when(session) {
  const date = new Date(session.scheduled_at);
  return session.scheduled_at && !Number.isNaN(date.getTime()) ? format(date, "MMM d, h:mm a") : session.status;
}

/** The signed-in clinician's own upcoming telehealth visits in their agency. */
export default function UpcomingTelehealthWidget() {
  const { tenantContext } = useAuth();
  const agencyId = tenantContext?.agency_id || null;
  const { data, isLoading, isError } = useQuery({
    queryKey: ["myUpcomingTelehealth", agencyId],
    queryFn: async () => (await base44.functions.invoke("listMyUpcomingTelehealth", { agency_id: agencyId })).data,
    enabled: !!agencyId,
  });
  const sessions = data?.sessions || [];

  if (!agencyId) return null;

  return (
    <div className="modern-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <Video className="w-5 h-5 text-navy-600" aria-hidden="true" />
        <h2 className="text-base font-semibold">Upcoming telehealth</h2>
      </div>
      {isLoading && <Loader2 className="w-5 h-5 animate-spin text-slate-400" aria-label="Loading telehealth schedule" />}
      {isError && (
        <p className="flex items-center gap-2 text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Couldn&apos;t load your schedule. Try refreshing.
        </p>
      )}
      {!isLoading && !isError && sessions.length === 0 && (
        <p className="text-sm text-slate-500">No upcoming telehealth visits.</p>
      )}
      <ul className="space-y-2">
        {sessions.map((s) => (
          <li key={s.id} className="flex justify-between text-sm">
            <span className="font-medium">{s.patient_name || "Patient"}</span>
            <span className="text-slate-500">{when(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
