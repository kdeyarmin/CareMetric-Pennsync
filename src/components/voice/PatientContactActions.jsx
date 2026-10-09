import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageSquare, PhoneCall, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import ScheduleSendDialog from "@/components/messaging/ScheduleSendDialog";
import { smsSegments } from "@/components/messaging/smsUtils";
import { listAuthorizedPatients } from "@/functions/listAuthorizedPatients";
import { useAuth } from "@/lib/AuthContext";
import { formatPhoneDisplay, normalizeE164 } from "@/components/voice/phoneUtils";

const MAX_SMS_LENGTH = 1600;

/** The server's refusal text, or a fallback. Production replaces toast text, so outcomes render inline. */
function brokerMessage(error, fallback) {
  const data = error?.response?.data || error?.data;
  const message = data?.error || error?.message;
  return typeof message === "string" && message && !/status code \d+/.test(message) ? message : fallback;
}

/** A broker answer, or a thrown refusal. Function names stay literal at each call site. */
function brokerAnswer(response) {
  const data = response?.data ?? response;
  if (data?.error) throw new Error(data.error);
  return data;
}

/**
 * Call or text a patient from the chart (owner decision, 2026-10-08).
 *
 * The browser never decides who may contact whom:
 *   - the patient's number comes from the `contact` read purpose of
 *     listAuthorizedPatients for this one chart, which re-authorizes the
 *     caller's membership and care-team access (clinical roles only);
 *   - startMaskedCall rings the caller's own cell and bridges the patient,
 *     presenting the work number, after proving the line is the agency's bound
 *     line and the chart is open to the caller;
 *   - sendSms (now) and scheduleSms (later) send only from the caller's bound
 *     agency line, only with the patient's scoped consent on file, and refuse
 *     with a reason otherwise. Consent is not readable here, so nothing is
 *     guessed: the server's answer is shown as it is.
 */
export default function PatientContactActions({ patientId, agencyId }) {
  const { user: currentUser } = useAuth();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState(null);

  const contactQuery = useQuery({
    queryKey: ["patient-contact", agencyId, patientId],
    queryFn: async () => {
      const result = await listAuthorizedPatients({
        agencyId,
        mode: "ids",
        purpose: "contact",
        patientIds: [patientId],
      });
      return result.patients.find((row) => row.id === patientId) || null;
    },
    enabled: !!agencyId && !!patientId,
    retry: false,
  });
  const patientPhone = normalizeE164(contactQuery.data?.phone);

  const hasWorkNumber = !!normalizeE164(currentUser?.work_phone_number);
  const hasCell = !!normalizeE164(currentUser?.personal_cell_e164);

  const startCall = useMutation({
    mutationFn: async () => brokerAnswer(await base44.functions.invoke("startMaskedCall", { patient_id: patientId })),
    onMutate: () => setNotice(null),
    onSuccess: () => setNotice({ tone: "success", text: "Connecting… your phone will ring shortly, then we'll dial the patient." }),
    onError: (error) => setNotice({ tone: "error", text: brokerMessage(error, "The call could not be started.") }),
  });

  const sendText = useMutation({
    mutationFn: async (body) => brokerAnswer(await base44.functions.invoke("sendSms", { to_number: patientPhone, body, patient_id: patientId })),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setDraft("");
      setNotice({ tone: "success", text: "Text sent from your agency line." });
    },
    onError: (error) => setNotice({ tone: "error", text: brokerMessage(error, "The text could not be sent.") }),
  });

  const callDisabledReason = !hasWorkNumber || !hasCell
    ? "You need a work number and a personal cell on file. Ask an administrator to provision them."
    : contactQuery.isSuccess && !patientPhone
      ? "This patient has no valid phone number on file."
      : !contactQuery.isSuccess
        ? "The patient's contact details are not available."
        : null;
  const textDisabledReason = contactQuery.isSuccess && !patientPhone
    ? "This patient has no valid phone number on file."
    : !contactQuery.isSuccess
      ? "The patient's contact details are not available."
      : null;
  const trimmed = draft.trim();
  const segments = smsSegments(draft);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <PhoneCall className="h-4 w-4 text-blue-600" aria-hidden="true" />
          Contact Patient Privately
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          Calls and texts go through your agency line so your personal cell is never shared.
          {patientPhone ? ` Patient number: ${formatPhoneDisplay(patientPhone)}.` : ""}
        </p>
        {contactQuery.isError && (
          <p role="status" className="text-xs text-amber-800">
            {brokerMessage(contactQuery.error, "Contact details are not available for your role on this chart.")}
          </p>
        )}
        {notice && (
          <p
            role={notice.tone === "error" ? "alert" : "status"}
            className={`rounded-md border px-3 py-2 text-xs ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
          >
            {notice.text}
          </p>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={!!callDisabledReason || startCall.isPending}
          onClick={() => startCall.mutate()}
          title={callDisabledReason || undefined}
        >
          <PhoneCall className="mr-2 h-4 w-4" aria-hidden="true" />
          {startCall.isPending ? "Connecting…" : "Call through work number"}
        </Button>
        {callDisabledReason && <p className="text-[11px] text-slate-500">{callDisabledReason}</p>}

        <div className="space-y-2 border-t border-slate-100 pt-3">
          <Label htmlFor={`patient-text-${patientId}`} className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            Text the patient
          </Label>
          <Textarea
            id={`patient-text-${patientId}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value.slice(0, MAX_SMS_LENGTH))}
            placeholder="Type a message…"
            rows={3}
            disabled={!!textDisabledReason}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">
              {draft ? `${segments.chars} chars · ${segments.segments} segment${segments.segments === 1 ? "" : "s"}` : "Texting needs the patient's consent on file."}
            </span>
            <div className="flex gap-2">
              <ScheduleSendDialog
                toNumber={patientPhone}
                patientId={patientId}
                body={draft}
                disabled={!!textDisabledReason || !trimmed}
                onScheduled={() => {
                  setDraft("");
                  setNotice({ tone: "success", text: "Text scheduled. You can cancel it from Phone Center › Scheduled." });
                }}
              />
              <Button
                type="button"
                disabled={!!textDisabledReason || !trimmed || sendText.isPending}
                onClick={() => {
                  if (!sendText.isPending && trimmed) sendText.mutate(trimmed);
                }}
              >
                <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                {sendText.isPending ? "Sending…" : "Send now"}
              </Button>
            </div>
          </div>
          {textDisabledReason && <p className="text-[11px] text-slate-500">{textDisabledReason}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
