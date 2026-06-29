import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageSquare, PhoneCall, Send, ShieldCheck, AlertTriangle, FileText, ChevronDown, Clock } from "lucide-react";
import { toast } from "sonner";
import { normalizeE164 } from "@/components/voice/phoneUtils";
import { isWithinBusinessHours, agencyHoursConfig } from "@/components/voice/businessHours";
import { smsSegments } from "@/components/messaging/smsUtils";
import { getQuickReplies } from "@/components/messaging/smsQuickReplies";
import { getTemplates, renderTemplate, buildTemplateContext } from "@/components/messaging/smsTemplates";
import ScheduleSendDialog from "@/components/messaging/ScheduleSendDialog";

/**
 * PatientContactActions — Text / Call buttons on the patient detail page.
 * Routes through the nurse's Telnyx work number so the nurse's personal cell is
 * never exposed. Disabled (with explanation) when the nurse has no work number.
 */
export default function PatientContactActions({ patient, currentUser }) {
  const queryClient = useQueryClient();
  const [textOpen, setTextOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentNote, setConsentNote] = useState("");

  const e164 = normalizeE164(patient?.phone);
  const hasWorkNumber = !!currentUser?.work_phone_number;

  const { data: consents = [] } = useQuery({
    queryKey: ["patient-consent", e164],
    queryFn: () => base44.entities.SmsConsent.filter({ phone_e164: e164 }, "-captured_at", 1),
    enabled: !!e164,
    initialData: [],
  });
  const consentStatus = consents[0]?.consent_status || "unknown";
  const optedOut = consentStatus === "opted_out";

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    staleTime: 5 * 60 * 1000,
    initialData: [],
  });
  // Warn (don't block) when the agency is outside its global calling/texting
  // hours — the send still goes through, but the patient may get an after-hours
  // auto-reply or transfer.
  const afterHours = !isWithinBusinessHours(new Date(), agencyHoursConfig(settingsArr[0])).open;
  const quickReplies = getQuickReplies(settingsArr[0]);
  const templates = getTemplates(settingsArr[0]);
  const templateContext = buildTemplateContext({ patient, user: currentUser, settings: settingsArr[0] });
  const insertReply = (text) =>
    setDraft((d) => (d.trim() ? `${d.replace(/\s*$/, "")} ${text}` : text));
  const applyTemplate = (body) => setDraft(renderTemplate(body, templateContext));

  const sendText = useMutation({
    mutationFn: (body) => base44.functions.invoke("sendSms", { to_number: patient.phone, body, patient_id: patient.id }),
    onSuccess: () => { setDraft(""); setTextOpen(false); toast.success("Text sent"); },
    onError: (err) => toast.error(err?.message || "Failed to send text"),
  });

  const startCall = useMutation({
    mutationFn: () => base44.functions.invoke("startMaskedCall", { patient_id: patient.id }),
    onSuccess: () => toast.success("Connecting… your phone will ring shortly, then we'll dial the patient."),
    onError: (err) => toast.error(err?.message || "Failed to start call"),
  });

  const recordConsent = useMutation({
    mutationFn: (consent_status) =>
      base44.functions.invoke("recordSmsConsent", {
        phone_e164: patient.phone, consent_status, patient_id: patient.id, notes: consentNote,
      }),
    onSuccess: (_res, consent_status) => {
      queryClient.invalidateQueries({ queryKey: ["patient-consent", e164] });
      toast.success(consent_status === "opted_in" ? "Texting consent recorded" : "Marked opted out");
      setConsentOpen(false);
      setConsentNote("");
    },
    onError: (err) => toast.error(err?.message || "Failed to record consent"),
  });

  const disabledReason = !hasWorkNumber
    ? "You need a work number assigned. Ask an administrator to provision one."
    : !e164
    ? "This patient has no valid phone number on file."
    : null;
  const disabled = !!disabledReason;

  const TextButton = (
    <Button variant="outline" className="flex-1" disabled={disabled || optedOut} onClick={() => setTextOpen(true)}>
      <MessageSquare className="w-4 h-4 mr-2" />
      Text
    </Button>
  );
  const CallButton = (
    <Button
      variant="outline"
      className="flex-1"
      disabled={disabled || startCall.isPending}
      onClick={() => startCall.mutate()}
    >
      <PhoneCall className="w-4 h-4 mr-2" />
      Call
    </Button>
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <PhoneCall className="w-4 h-4 text-blue-600" />
          Contact Patient Privately
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-slate-500">
          Calls and texts go through your work number — your personal cell is never shared.
        </p>

        {optedOut && (
          <Alert className="bg-red-50 border-red-300 py-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900 text-xs">
              Patient opted out of texts (replied STOP). Texting is disabled; calling is still allowed.
            </AlertDescription>
          </Alert>
        )}
        {!optedOut && consentStatus === "opted_in" && (
          <Badge className="bg-green-100 text-green-800 text-xs">
            <ShieldCheck className="w-3 h-3 mr-1" /> Texting consent on file
          </Badge>
        )}
        {e164 && (
          <button
            type="button"
            onClick={() => setConsentOpen(true)}
            className="text-xs text-blue-600 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {consentStatus === "opted_in" ? "Update texting consent" : optedOut ? "Update consent status" : "Record texting consent"}
          </button>
        )}
        {afterHours && (
          <Alert className="bg-amber-50 border-amber-200 py-2">
            <Clock className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-xs">
              Outside the agency's calling &amp; texting hours. Your message still sends, but the patient may
              receive an after-hours auto-reply or be transferred if they call back.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex gap-2">
          {disabled ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild><span className="flex-1">{TextButton}</span></TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild><span className="flex-1">{CallButton}</span></TooltipTrigger>
                <TooltipContent>{disabledReason}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <>
              {TextButton}
              {CallButton}
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={consentOpen} onOpenChange={setConsentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Texting consent — {patient?.first_name} {patient?.last_name}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Record the patient's texting consent (e.g. captured verbally or on a signed form). TCPA requires
            consent on file before texting. This is logged with your name and time.
          </p>
          <Textarea
            value={consentNote}
            onChange={(e) => setConsentNote(e.target.value)}
            rows={2}
            placeholder="Optional note (e.g. 'Verbal consent during 6/4 visit')"
            className="resize-none"
          />
          <DialogFooter>
            <Button
              variant="outline"
              className="text-red-700 border-red-200 hover:bg-red-50"
              disabled={recordConsent.isPending}
              onClick={() => recordConsent.mutate("opted_out")}
            >
              Mark opted out
            </Button>
            <Button
              className="bg-green-600 hover:bg-green-700"
              disabled={recordConsent.isPending}
              onClick={() => recordConsent.mutate("opted_in")}
            >
              <ShieldCheck className="w-4 h-4 mr-2" /> Record consent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={textOpen} onOpenChange={setTextOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Text {patient?.first_name} {patient?.last_name}
            </DialogTitle>
          </DialogHeader>
          {consentStatus === "unknown" && (
            <Alert className="bg-amber-50 border-amber-200 py-2">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-xs">
                No texting consent is recorded for this patient. Confirm they've agreed to receive texts before sending.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {templates.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs">
                    <FileText className="w-3.5 h-3.5 mr-1.5" /> Templates
                    <ChevronDown className="w-3 h-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-xs">
                  {templates.map((t, i) => (
                    <DropdownMenuItem key={i} onSelect={() => applyTemplate(t.body)} className="flex-col items-start">
                      <span className="text-xs font-medium">{t.label}</span>
                      <span className="text-[11px] text-slate-500 line-clamp-2">{renderTemplate(t.body, templateContext)}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {quickReplies.map((q, i) => (
              <button
                key={i}
                type="button"
                onClick={() => insertReply(q.text)}
                title={q.text}
                className="text-xs px-2 py-1 rounded-full border border-slate-200 bg-slate-50 text-slate-700 hover:bg-blue-50 hover:border-blue-300 transition-colors"
              >
                {q.label}
              </button>
            ))}
          </div>
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            placeholder="Type your message… Avoid clinical details / PHI."
            className="resize-none"
          />
          {(() => {
            const meta = smsSegments(draft);
            return meta.chars > 0 ? (
              <p className={`text-xs ${meta.segments > 1 ? "text-amber-600" : "text-slate-400"}`}>
                {`${meta.chars} chars · ${meta.segments} SMS${meta.segments > 1 ? ` (${meta.encoding})` : ""}`}
              </p>
            ) : null;
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setTextOpen(false)}>Cancel</Button>
            <ScheduleSendDialog
              toNumber={patient?.phone}
              patientId={patient?.id}
              body={draft}
              disabled={!draft.trim() || sendText.isPending || optedOut}
              onScheduled={() => { setDraft(""); setTextOpen(false); }}
            />
            <Button
              onClick={() => draft.trim() && sendText.mutate(draft.trim())}
              disabled={!draft.trim() || sendText.isPending}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Send className="w-4 h-4 mr-2" />
              Send Text
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
