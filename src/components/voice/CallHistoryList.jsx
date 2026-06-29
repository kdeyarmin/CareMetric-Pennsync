import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  PhoneIncoming, PhoneOutgoing, PhoneForwarded, PhoneMissed, Voicemail, Info, PhoneCall,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatPhoneDisplay, last10 } from "@/components/voice/phoneUtils";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";
import { PhoneEmptyState } from "@/components/phone/PhoneFrame";

const MODE_LABEL = {
  masked_bridge: "Incoming",
  off_duty_transfer: "Off-duty transfer",
  outbound_clicktocall: "Outgoing",
};

// Post-call disposition options the nurse can tag a call with.
const DISPOSITIONS = [
  { value: "resolved", label: "Resolved" },
  { value: "follow_up_needed", label: "Follow-up needed" },
  { value: "callback_requested", label: "Callback requested" },
  { value: "left_voicemail", label: "Left voicemail" },
  { value: "no_action", label: "No action" },
];
const DISPOSITION_LABEL = Object.fromEntries(DISPOSITIONS.map((d) => [d.value, d.label]));

function formatDuration(seconds) {
  if (!seconds && seconds !== 0) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Missed/failed inbound calls read in red like a real Recents list.
function isMissed(call) {
  return call.direction !== "outbound" && (call.status === "no_answer" || call.status === "failed");
}

function CallTypeIcon({ call }) {
  if (call.call_mode === "off_duty_transfer") return <PhoneForwarded className="h-3.5 w-3.5 text-navy-600" />;
  if (call.direction === "outbound") return <PhoneOutgoing className="h-3.5 w-3.5 text-slate-500" />;
  if (isMissed(call)) return <PhoneMissed className="h-3.5 w-3.5 text-red-500" />;
  return <PhoneIncoming className="h-3.5 w-3.5 text-green-600" />;
}

/**
 * CallHistoryList — the nurse's masked call log shown like a phone's Recents
 * screen: tinted avatars, red "missed" rows, an info button per call to add a
 * disposition + note, and inline voicemail playback.
 */
export default function CallHistoryList() {
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
    queryKey: ["call-patients", user?.email],
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

  const [editing, setEditing] = useState(null); // the CallLog row being annotated
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState("");

  const callBack = useMutation({
    mutationFn: ({ patient_id, to_number }) =>
      base44.functions.invoke("startMaskedCall", { patient_id: patient_id || undefined, to_number: to_number || undefined }),
    onSuccess: () => toast.success("Connecting… your phone will ring shortly, then we'll dial the patient."),
    onError: (err) => toast.error(err?.message || "Failed to start call"),
  });

  const saveAnnotation = useMutation({
    mutationFn: ({ id, note: n, disposition: d }) => base44.entities.CallLog.update(id, { note: n, disposition: d || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["call-logs", user?.email] });
      setEditing(null);
      toast.success("Call updated");
    },
    onError: (err) => toast.error(err?.message || "Failed to update call"),
  });

  const openEditor = (call) => {
    setEditing(call);
    setNote(call.note || "");
    setDisposition(call.disposition || "");
  };

  const sorted = useMemo(
    () => [...calls].sort((a, b) => new Date(b.created_date) - new Date(a.created_date)),
    [calls]
  );

  const otherNumberOf = (call) => (call.direction === "outbound" ? call.to_number : call.from_number);
  const patientOf = (call) =>
    (call.patient_id && patientById[call.patient_id]) || patientByPhone[last10(otherNumberOf(call))] || null;
  const labelFor = (call) => {
    const p = patientOf(call);
    return p ? `${p.first_name} ${p.last_name}` : formatPhoneDisplay(otherNumberOf(call));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar title="Recents" large />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : sorted.length === 0 ? (
          <PhoneEmptyState icon={PhoneCall} title="No recent calls" hint="Masked calls will appear here." />
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {sorted.map((call) => {
              const active = call.status === "ringing" || call.status === "initiated";
              const missed = isMissed(call);
              const dur = formatDuration(call.duration_seconds);
              return (
                <li key={call.id} className={active ? "bg-blue-50" : ""}>
                  <div className="flex items-center gap-3 px-3 py-3">
                    <ContactAvatar name={patientOf(call) ? labelFor(call) : null} number={otherNumberOf(call)} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-[15px] font-semibold ${missed ? "text-red-600" : "text-slate-900"}`}>
                        {labelFor(call)}
                      </p>
                      <div className="flex items-center gap-1.5 text-[13px] text-slate-500">
                        <CallTypeIcon call={call} />
                        <span className="truncate">{MODE_LABEL[call.call_mode] || (call.status || "").replace(/_/g, " ")}</span>
                        {call.has_voicemail && (
                          <Badge className="bg-indigo-100 px-1.5 py-0 text-[10px] text-indigo-700">
                            <Voicemail className="mr-0.5 h-2.5 w-2.5" /> VM
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
                      <span className="text-[11px] text-slate-400">{format(new Date(call.created_date), "MMM d")}</span>
                      <span className="text-[11px] text-slate-400">{format(new Date(call.created_date), "h:mm a")}</span>
                      {dur && <span className="text-[10px] text-slate-300">{dur}</span>}
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-0.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-blue-600 hover:bg-blue-50"
                        title="Call back"
                        disabled={callBack.isPending}
                        onClick={() => callBack.mutate({ patient_id: call.patient_id, to_number: otherNumberOf(call) })}
                      >
                        <PhoneCall className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 rounded-full text-slate-400 hover:bg-slate-100"
                        onClick={() => openEditor(call)}
                        title="Call details"
                      >
                        <Info className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {call.has_voicemail && call.voicemail_url && (
                    <audio controls preload="none" src={call.voicemail_url} className="mb-2 h-8 w-[calc(100%-1.5rem)] px-3" />
                  )}
                  {call.voicemail_transcription && (
                    <p className="mb-2 px-3 pl-[4.25rem] text-[13px] italic text-slate-600">
                      “{call.voicemail_transcription}”
                    </p>
                  )}
                  {(call.disposition || call.note) && (
                    <div className="flex items-start gap-2 px-3 pb-2 pl-[4.25rem]">
                      {call.disposition && (
                        <Badge variant="outline" className="text-[11px]">{DISPOSITION_LABEL[call.disposition] || call.disposition}</Badge>
                      )}
                      {call.note && <p className="text-xs text-slate-500">{call.note}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Call notes</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Disposition</p>
              <div className="flex flex-wrap gap-1.5">
                {DISPOSITIONS.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDisposition((cur) => (cur === d.value ? "" : d.value))}
                    className={`rounded-full border px-2 py-1 text-xs transition-colors ${
                      disposition === d.value
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300"
                    }`}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-slate-600">Note (avoid clinical detail / PHI)</p>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} className="resize-none" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              className="bg-blue-600 hover:bg-blue-700"
              disabled={saveAnnotation.isPending}
              onClick={() => saveAnnotation.mutate({ id: editing.id, note: note.trim(), disposition })}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
