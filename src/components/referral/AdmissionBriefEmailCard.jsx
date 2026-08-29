import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from "@/lib/agencyRoster";
import { ALL_ROWS } from "@/lib/queryLimits";
import { sendInAppNotification } from "@/lib/notify";
import { buildAdmissionBriefEmail } from "./admissionBriefEmail.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Mail, Send, ShieldAlert, RotateCcw, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

/**
 * Email the admitting nurse a complete admission briefing for an analyzed
 * referral — patient snapshot, alerts, orders, payer-optimized visit plan,
 * draft OASIS responses, sample admission narrative, and the referral document
 * links — so the nurse doesn't have to read the entire referral.
 *
 * PHI containment: recipients are limited to the caller's AGENCY ROSTER
 * (no free-typed addresses — a typo would mail PHI outside the agency), the
 * subject carries patient initials only, and the body opens with a
 * confidentiality banner (see admissionBriefEmail.js).
 */
export default function AdmissionBriefEmailCard({
  referralData,
  analysis = null,
  sourceFileUrl = "",
  packetUrl = "",
  admissionNote = "",
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [editedBody, setEditedBody] = useState(null); // null = use the generated body
  const [showPreview, setShowPreview] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sentTo, setSentTo] = useState([]);

  // PHI-misdirection guard: when the host switches to a DIFFERENT referral
  // without remounting this card, the previous patient's edited briefing
  // text, chosen recipient, and sent status must not carry over — otherwise
  // Send could email patient A's briefing under patient B's subject. (Render-
  // time state adjustment per React's "adjusting state when a prop changes"
  // pattern.)
  const [prevReferralData, setPrevReferralData] = useState(referralData);
  if (prevReferralData !== referralData) {
    setPrevReferralData(referralData);
    setRecipientEmail("");
    setEditedBody(null);
    setSentTo([]);
  }

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  // Same key AND same data signature as the app's other agency-scoped user
  // lists (see queryKeyContract.test.js — shared keys must produce identical
  // data): full list, then the caller-agency filter, failing closed to [].
  const { data: users = [] } = useQuery({
    queryKey: ["users", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list(undefined, ALL_ROWS);
      const { filterUsersByCallerAgency } = await import("@/lib/agencyScope");
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: !!currentUser,
  });

  const recipients = useMemo(
    () =>
      users
        .filter((u) => u?.email && u.is_active !== false)
        .sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email))),
    [users]
  );
  const recipient = recipients.find((u) => u.email === recipientEmail) || null;

  const generated = useMemo(
    () =>
      referralData
        ? buildAdmissionBriefEmail({
            referralData,
            analysis,
            admissionNote,
            sourceFileUrl,
            packetUrl,
            nurseName: recipient?.full_name || "",
            senderName: currentUser?.full_name || currentUser?.email || "",
          })
        : null,
    [referralData, analysis, admissionNote, sourceFileUrl, packetUrl, recipient, currentUser]
  );

  if (!referralData || !generated) return null;

  const body = editedBody ?? generated.body;
  const isEdited = editedBody !== null && editedBody !== generated.body;

  const handleSend = async () => {
    if (!recipient) {
      toast.error("Select the admitting nurse first.");
      return;
    }
    setIsSending(true);
    try {
      await base44.integrations.Core.SendEmail({
        to: recipient.email,
        subject: generated.subject,
        body,
      });
      // Best-effort in-app notification — the email is the deliverable, so a
      // notification failure must not surface as a send failure. PHI-light on
      // purpose: notifications render in shared surfaces.
      try {
        await sendInAppNotification({
          user_email: recipient.email,
          title: "Admission briefing emailed to you",
          message: `${currentUser?.full_name || "Intake"} emailed you an admission briefing for a new home health referral. Check your email for the full brief and referral documents.`,
          type: "new_referral",
          priority: "high",
        });
      } catch {
        /* notification is best-effort */
      }
      setSentTo((prev) => [...prev, { email: recipient.email, name: recipient.full_name || recipient.email }]);
      toast.success(`Admission briefing emailed to ${recipient.full_name || recipient.email}.`);
    } catch (error) {
      console.error("Error emailing admission briefing:", error);
      toast.error("Failed to send the briefing email. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="border-2 border-sky-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="w-5 h-5 text-sky-600" />
          Email Admission Briefing to the Admitting Nurse
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          Sends the full briefing — patient snapshot, alerts, orders, payer-optimized visit plan, draft
          OASIS responses, sample admission narrative, and the referral document links.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Alert className="bg-sky-50 border-sky-300">
          <ShieldAlert className="w-4 h-4 text-sky-700" />
          <AlertDescription className="text-xs text-sky-900">
            Contains PHI. Recipients are limited to your agency's staff roster; the subject line carries
            patient initials only. Review the preview before sending.
          </AlertDescription>
        </Alert>

        <div>
          <label htmlFor="brief-recipient" className="text-sm font-medium mb-1 block">
            Admitting nurse
          </label>
          <Select
            value={recipientEmail}
            onValueChange={(email) => {
              // A hand-edited body carries the previous recipient's "To:" line
              // and personalization — switching nurses regenerates the briefing
              // for the new recipient instead of sending the stale edit.
              const discardEdit = email !== recipientEmail && editedBody !== null;
              setRecipientEmail(email);
              if (discardEdit) {
                setEditedBody(null);
                toast.info("Recipient changed — the briefing was regenerated for the new recipient (your edits were discarded).");
              }
            }}
          >
            <SelectTrigger id="brief-recipient">
              <SelectValue placeholder={recipients.length === 0 ? "No agency staff available…" : "Select the admitting nurse…"} />
            </SelectTrigger>
            <SelectContent>
              {recipients.map((u) => (
                <SelectItem key={u.email} value={u.email}>
                  {u.full_name || u.email}
                  {u.credential_type ? `, ${u.credential_type}` : ""} — {u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!analysis && (
          <p className="text-xs text-slate-500">
            The AI analysis is still running — the briefing already includes the referral's documented
            content and will pick up the patient summary and visit estimates once analysis completes.
          </p>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-xs text-slate-600">
            <strong>Subject:</strong> {generated.subject}
          </p>
          <div className="flex items-center gap-2">
            {isEdited && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditedBody(null)}>
                <RotateCcw className="w-3 h-3 mr-1" /> Reset to generated
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => setShowPreview((v) => !v)}>
              {showPreview ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
              {showPreview ? "Hide preview" : "Preview & edit"}
            </Button>
          </div>
        </div>

        {showPreview && (
          <Textarea
            aria-label="Briefing email body"
            value={body}
            onChange={(e) => setEditedBody(e.target.value)}
            rows={18}
            className="font-mono text-xs"
          />
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1">
            {sentTo.map((s, i) => (
              <Badge key={i} className="bg-green-100 text-green-800 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Sent to {s.name}
              </Badge>
            ))}
          </div>
          <Button type="button" onClick={handleSend} disabled={isSending || !recipient} className="bg-sky-600 hover:bg-sky-700">
            {isSending ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Sending…
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Email briefing
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
