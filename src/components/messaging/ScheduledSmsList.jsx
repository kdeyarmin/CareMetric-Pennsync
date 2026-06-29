import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, X, CheckCircle2, XCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatPhoneDisplay, last10 } from "@/components/voice/phoneUtils";
import { canCancel } from "@/components/messaging/scheduledSms";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";
import { PhoneEmptyState } from "@/components/phone/PhoneFrame";

const STATUS_STYLES = {
  pending: "bg-blue-100 text-blue-800",
  sending: "bg-amber-100 text-amber-800",
  sent: "bg-green-100 text-green-800",
  failed: "bg-red-100 text-red-800",
  canceled: "bg-slate-200 text-slate-600",
};

/**
 * ScheduledSmsList — a nurse's upcoming and recent scheduled texts as a phone
 * screen. Pending ones can be canceled before they send; sent/failed/canceled
 * stay as a record.
 */
export default function ScheduledSmsList() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["scheduled-sms", user?.email],
    queryFn: () => base44.entities.ScheduledSms.filter({ nurse_email: user.email }, "send_at", 200),
    enabled: !!user?.email,
    refetchInterval: 30000,
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["scheduled-patients", user?.email],
    queryFn: () => base44.entities.Patient.filter({ assigned_nurses: user.email }, "-created_date", 500),
    enabled: !!user?.email,
    initialData: [],
  });
  const patientById = useMemo(() => Object.fromEntries(patients.map((p) => [p.id, p])), [patients]);
  const patientByPhone = useMemo(() => {
    const map = {};
    patients.forEach((p) => { const k = last10(p.phone); if (k) map[k] = p; });
    return map;
  }, [patients]);

  const cancel = useMutation({
    mutationFn: (id) => base44.functions.invoke("cancelScheduledSms", { scheduled_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scheduled-sms", user?.email] });
      toast.success("Scheduled message canceled");
    },
    onError: (err) => toast.error(err?.message || "Failed to cancel"),
  });

  const sorted = useMemo(() => {
    const rank = { pending: 0, sending: 1, failed: 2, sent: 3, canceled: 4 };
    return [...rows].sort((a, b) => {
      const r = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
      return r !== 0 ? r : new Date(a.send_at) - new Date(b.send_at);
    });
  }, [rows]);

  const patientOf = (row) => (row.patient_id && patientById[row.patient_id]) || patientByPhone[last10(row.to_number)] || null;
  const labelFor = (row) => {
    const p = patientOf(row);
    return p ? `${p.first_name} ${p.last_name}` : formatPhoneDisplay(row.to_number);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar title="Scheduled" large />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : sorted.length === 0 ? (
          <PhoneEmptyState
            icon={CalendarClock}
            title="No scheduled texts"
            hint="Use the clock icon while composing a text to schedule one."
          />
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {sorted.map((row) => (
              <li key={row.id} className="px-3 py-3">
                <div className="flex items-start gap-3">
                  <ContactAvatar name={patientOf(row) ? labelFor(row) : null} number={row.to_number} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-[15px] font-semibold text-slate-900">{labelFor(row)}</p>
                      <Badge className={`flex-shrink-0 text-[11px] ${STATUS_STYLES[row.status] || "bg-slate-100 text-slate-700"}`}>
                        {row.status}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-[13px] text-slate-600">{row.body}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                      <CalendarClock className="h-3 w-3" />
                      {format(new Date(row.send_at), "EEE MMM d, h:mm a")}
                      {row.status === "sent" && <CheckCircle2 className="ml-1 h-3 w-3 text-green-600" />}
                      {row.status === "failed" && <XCircle className="ml-1 h-3 w-3 text-red-600" />}
                    </p>
                    {row.status === "failed" && row.failure_reason && (
                      <p className="mt-0.5 text-[11px] text-red-700">{row.failure_reason}</p>
                    )}
                    {canCancel(row) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1.5 h-7 rounded-full px-3 text-xs text-red-600 hover:bg-red-50"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(row.id)}
                      >
                        <X className="mr-1 h-3.5 w-3.5" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
