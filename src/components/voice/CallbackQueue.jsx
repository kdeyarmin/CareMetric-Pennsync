import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PhoneCall, Voicemail, CheckCircle2, Clock, PhoneMissed, ArrowRightCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatPhoneDisplay, last10 } from "@/components/voice/phoneUtils";
import { buildCallbackQueue } from "@/components/voice/callbackQueue";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";
import { PhoneEmptyState } from "@/components/phone/PhoneFrame";

const REASON_STYLES = {
  "Callback requested": "bg-navy-100 text-navy-800",
  "Voicemail": "bg-indigo-100 text-indigo-800",
  "Follow-up needed": "bg-amber-100 text-amber-800",
  "Missed call": "bg-red-100 text-red-800",
};

const ReasonIcon = ({ reason }) => {
  if (reason === "Voicemail") return <Voicemail className="h-4 w-4 text-indigo-600" />;
  if (reason === "Callback requested") return <ArrowRightCircle className="h-4 w-4 text-navy-600" />;
  return <PhoneMissed className="h-4 w-4 text-red-600" />;
};

/**
 * CallbackQueue — a nurse's prioritized "needs a call back" worklist (missed
 * masked calls, requested callbacks, follow-ups, and voicemails), rendered as a
 * phone screen with one-tap masked call-back and a way to mark an item resolved.
 */
export default function CallbackQueue() {
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });

  const { data: calls = [], isLoading } = useQuery({
    queryKey: ["call-logs", user?.email],
    queryFn: () => base44.entities.CallLog.filter({ nurse_email: user.email }, "-created_date", 200),
    enabled: !!user?.email,
    refetchInterval: 30000,
    initialData: [],
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["callback-patients", user?.email],
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

  const queue = useMemo(() => buildCallbackQueue(calls), [calls]);

  const callBack = useMutation({
    mutationFn: ({ patient_id, to_number }) => base44.functions.invoke("startMaskedCall", { patient_id: patient_id || undefined, to_number: to_number || undefined }),
    onSuccess: () => toast.success("Connecting… your phone will ring shortly, then we'll dial the patient."),
    onError: (err) => toast.error(err?.message || "Failed to start call"),
  });

  const resolve = useMutation({
    mutationFn: (id) => base44.entities.CallLog.update(id, { disposition: "resolved" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call-logs", user?.email] });
      toast.success("Marked resolved");
    },
    onError: (err) => toast.error(err?.message || "Failed to update"),
  });

  const otherNumberOf = (call) => (call.direction === "outbound" ? call.to_number : call.from_number);
  const patientOf = (call) =>
    (call.patient_id && patientById[call.patient_id]) || patientByPhone[last10(otherNumberOf(call))] || null;
  const labelFor = (call) => {
    const p = patientOf(call);
    return p ? `${p.first_name} ${p.last_name}` : formatPhoneDisplay(otherNumberOf(call));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar
        title="Callbacks"
        large
        accessory={queue.length > 0 ? <Badge className="bg-red-500 text-white">{queue.length}</Badge> : null}
      />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : queue.length === 0 ? (
          <PhoneEmptyState icon={CheckCircle2} title="You're all caught up" hint="No calls need a callback." />
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {queue.map((call) => (
              <li key={call.id} className="px-3 py-3">
                <div className="flex items-start gap-3">
                  <ContactAvatar name={patientOf(call) ? labelFor(call) : null} number={otherNumberOf(call)} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold text-slate-900">{labelFor(call)}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <Badge className={`flex items-center gap-1 text-[11px] ${REASON_STYLES[call.reason] || "bg-slate-100 text-slate-700"}`}>
                        <ReasonIcon reason={call.reason} />
                        {call.reason}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Clock className="h-3 w-3" />
                        {format(new Date(call.created_date), "MMM d, h:mm a")}
                      </span>
                    </div>
                    {call.note && <p className="mt-1 text-xs text-slate-600">{call.note}</p>}
                    {call.has_voicemail && call.voicemail_url && (
                      <audio controls preload="none" src={call.voicemail_url} className="mt-2 h-8 w-full" />
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-8 rounded-full bg-green-600 px-4 hover:bg-green-700"
                        disabled={callBack.isPending}
                        onClick={() => callBack.mutate({ patient_id: call.patient_id, to_number: otherNumberOf(call) })}
                      >
                        <PhoneCall className="mr-1.5 h-3.5 w-3.5" /> Call back
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-3 text-xs text-slate-600"
                        disabled={resolve.isPending}
                        onClick={() => resolve.mutate(call.id)}
                      >
                        <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Resolve
                      </Button>
                    </div>
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
