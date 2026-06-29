import { useMemo, useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MessageSquare, Info, Ban } from "lucide-react";
import SmsThreadView from "@/components/messaging/SmsThreadView";
import PhoneTopBar from "@/components/phone/PhoneTopBar";
import ContactAvatar from "@/components/phone/ContactAvatar";
import { PhoneEmptyState } from "@/components/phone/PhoneFrame";
import { shortAgo } from "@/components/phone/timeUtils";
import { last10, formatPhoneDisplay } from "@/components/voice/phoneUtils";

/**
 * SmsConversationList — a nurse's text inbox styled like a phone Messages app.
 * Groups SmsMessage rows into patient conversations with tinted avatars, unread
 * dots and relative times, and pushes into a full-screen thread when tapped.
 */
export default function SmsConversationList() {
  const queryClient = useQueryClient();
  const [selectedThreadId, setSelectedThreadId] = useState(null);

  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["sms-messages", user?.email],
    queryFn: () => base44.entities.SmsMessage.filter({ nurse_email: user.email }, "-created_date", 300),
    enabled: !!user?.email,
    refetchInterval: 30000,
  });

  const { data: patients = [] } = useQuery({
    queryKey: ["sms-patients", user?.email],
    queryFn: () => base44.entities.Patient.filter({ assigned_nurses: user.email }, "-created_date", 500),
    enabled: !!user?.email,
    initialData: [],
  });

  const { data: consents = [] } = useQuery({
    queryKey: ["sms-consents"],
    queryFn: () => base44.entities.SmsConsent.list("-captured_at", 500),
    initialData: [],
  });

  // phone (last10) -> latest opt-out flag
  const optOutByPhone = useMemo(() => {
    const map = {};
    consents.forEach((c) => {
      const key = last10(c.phone_e164);
      if (!(key in map)) map[key] = c.consent_status === "opted_out"; // list is already newest-first
    });
    return map;
  }, [consents]);

  const patientById = useMemo(() => Object.fromEntries(patients.map((p) => [p.id, p])), [patients]);
  const patientByPhone = useMemo(() => {
    const map = {};
    patients.forEach((p) => { const k = last10(p.phone); if (k) map[k] = p; });
    return map;
  }, [patients]);

  const threads = useMemo(() => {
    const grouped = {};
    messages.forEach((m) => {
      const key = m.thread_id || m.id;
      (grouped[key] = grouped[key] || []).push(m);
    });
    return Object.entries(grouped)
      .map(([threadId, msgs]) => {
        const sorted = msgs.sort((a, b) => new Date(a.created_date) - new Date(b.created_date));
        const last = sorted[sorted.length - 1];
        const otherNumber = last.direction === "outbound" ? last.to_number : last.from_number;
        const pid = sorted.find((m) => m.patient_id)?.patient_id || null;
        const patient = (pid && patientById[pid]) || patientByPhone[last10(otherNumber)] || null;
        const label = patient ? `${patient.first_name} ${patient.last_name}` : formatPhoneDisplay(otherNumber);
        return {
          threadId,
          messages: sorted,
          lastMessage: last,
          otherNumber,
          patientId: patient?.id || pid,
          label,
          unreadCount: sorted.filter((m) => m.direction === "inbound" && !m.is_read).length,
          optedOut: !!optOutByPhone[last10(otherNumber)],
          patient,
        };
      })
      .sort((a, b) => new Date(b.lastMessage.created_date) - new Date(a.lastMessage.created_date));
  }, [messages, patientById, patientByPhone, optOutByPhone]);

  const selected = threads.find((t) => t.threadId === selectedThreadId) || null;

  // Mark inbound messages read while a thread is open. Keyed on the set of
  // unread ids so it also fires when new messages arrive via polling — not only
  // when the thread is first selected.
  const selectedUnreadKey = (selected?.messages || [])
    .filter((m) => m.direction === "inbound" && !m.is_read)
    .map((m) => m.id)
    .join(",");
  useEffect(() => {
    if (!user?.email || !selectedUnreadKey) return;
    Promise.all(
      selectedUnreadKey.split(",").map((id) => base44.entities.SmsMessage.update(id, { is_read: true }))
    )
      .then(() => queryClient.invalidateQueries({ queryKey: ["sms-messages", user?.email] }))
      .catch((e) => console.warn("Failed to mark SMS read:", e?.message));
  }, [selectedUnreadKey, user?.email, queryClient]);

  if (!user?.work_phone_number) {
    return (
      <>
        <PhoneTopBar title="Messages" large />
        <div className="p-4">
          <Alert className="border-amber-200 bg-amber-50">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              You don't have a work number assigned yet. Ask an administrator to provision one before you can
              send or receive patient texts.
            </AlertDescription>
          </Alert>
        </div>
      </>
    );
  }

  // Drilled-in conversation screen.
  if (selected) {
    return (
      <SmsThreadView
        thread={selected}
        otherPartyLabel={selected.label}
        otherPartyNumber={selected.otherNumber}
        patientId={selected.patientId}
        patient={selected.patient}
        currentUser={user}
        optedOut={selected.optedOut}
        onBack={() => setSelectedThreadId(null)}
        onSent={() => queryClient.invalidateQueries({ queryKey: ["sms-messages", user?.email] })}
      />
    );
  }

  // Inbox screen.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PhoneTopBar title="Messages" large />
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading…</p>
        ) : threads.length === 0 ? (
          <PhoneEmptyState icon={MessageSquare} title="No conversations yet" hint="Patient texts will show up here." />
        ) : (
          <ul className="divide-y divide-slate-100 bg-white">
            {threads.map((t) => (
              <li key={t.threadId}>
                <button
                  type="button"
                  onClick={() => setSelectedThreadId(t.threadId)}
                  className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 active:bg-slate-100"
                >
                  <div className="relative">
                    <ContactAvatar name={t.patient ? t.label : null} number={t.otherNumber} size="md" />
                    {t.unreadCount > 0 && (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-blue-500 px-1 text-[10px] font-bold text-white">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className={`truncate text-[15px] ${t.unreadCount > 0 ? "font-bold text-slate-900" : "font-semibold text-slate-800"}`}>
                        {t.label}
                      </p>
                      <span className="flex-shrink-0 text-[11px] text-slate-400">{shortAgo(t.lastMessage.created_date)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {t.optedOut && <Ban className="h-3 w-3 flex-shrink-0 text-red-500" />}
                      <p className={`truncate text-[13px] ${t.unreadCount > 0 ? "text-slate-700" : "text-slate-500"}`}>
                        {t.lastMessage.direction === "outbound" ? "You: " : ""}
                        {t.lastMessage.body}
                      </p>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
