import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { canViewFinancials } from "@/lib/permissions";
import { isAdminLike } from "@/lib/superAdmin";
import { agencyQueryKey } from "@/lib/agencyRoster";
import { ALL_ROWS } from "@/lib/queryLimits";
import { fetchCallerPdgmRateConfig, fetchCallerPayerRateConfig } from "@/lib/agencySettings";
import { sendInAppNotification } from "@/lib/notify";
import { exportToPDF } from "@/components/utils/pdfExporter";
import { matchWageIndex } from "../pdgm/wageIndex.js";
import { buildClinicalManagerBrief, buildPdgmRequestFromReferral, isPdgmPricedPayer } from "./clinicalManagerBrief.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileBarChart2, Download, Send, ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Clinical-manager revenue brief for an analyzed referral — PDF + email.
 *
 * FINANCIAL SURFACE: renders only for canViewFinancials users (fail-closed
 * here AND wrapped in FinancialGate at the call site); the dollar figures come
 * from the server-gated calculatePDGM endpoint (which strips financials for
 * non-admin callers) and the agency's own imported payer table. Email
 * recipients are limited to ADMIN-tier staff in the caller's agency roster —
 * the brief carries reimbursement data a nurse must never receive.
 */
export default function ClinicalManagerBriefCard({
  referralData,
  analysis = null,
  sourceFileUrl = "",
  packetUrl = "",
}) {
  const [recipientEmail, setRecipientEmail] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [sentTo, setSentTo] = useState([]);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const financial = canViewFinancials(currentUser);

  // Imported payer reimbursement table (same key + signature as PayerRatesManager).
  const { data: payerConfig } = useQuery({
    queryKey: ["payerRateConfig", currentUser?.agency_name || "platform"],
    queryFn: () => fetchCallerPayerRateConfig(currentUser?.agency_name),
    enabled: financial && !!currentUser,
  });
  const payers = useMemo(
    () => (Array.isArray(payerConfig?.payers) ? payerConfig.payers : []),
    [payerConfig]
  );

  // PDGM applies to Medicare FFS (and payer rows configured as pdgm-model)
  // ONLY — every other payer is priced from the imported payer table, so the
  // calculatePDGM call is skipped entirely for them.
  const pdgmPriced = useMemo(
    () => (referralData ? isPdgmPricedPayer(referralData, payers) : false),
    [referralData, payers]
  );

  // Agency PDGM rate config (official CMS case-mix table → HIPPS; imported
  // CBSA wage-index table → per-address wage adjustment).
  const { data: rateConfig } = useQuery({
    queryKey: ["pdgmRateConfigRow", currentUser?.agency_name || "platform"],
    queryFn: () => fetchCallerPdgmRateConfig(currentUser?.agency_name),
    enabled: financial && !!currentUser && pdgmPriced,
  });

  // Patient-address CBSA match — sharpens the wage adjustment for
  // multi-county service areas. No match → calculatePDGM falls back to the
  // single agency-wide wage index exactly as before.
  const wageMatch = useMemo(() => {
    const ex = referralData?.extracted_data || referralData || {};
    return matchWageIndex(ex?.demographics?.address, rateConfig?.wage_index_table || null);
  }, [referralData, rateConfig]);

  // Canonical PDGM estimate (server-gated). Keyed on the request payload AND
  // the matched wage index so a late-loading CBSA table recomputes the figure.
  const pdgmRequest = useMemo(
    () => (referralData && pdgmPriced ? buildPdgmRequestFromReferral(referralData) : null),
    [referralData, pdgmPriced]
  );
  const { data: pdgmResponse, isError: pdgmError } = useQuery({
    queryKey: ["referral-pdgm-estimate", JSON.stringify(pdgmRequest), wageMatch?.wage_index ?? null],
    queryFn: async () => {
      const { data } = await base44.functions.invoke("calculatePDGM", {
        pdgmData: pdgmRequest,
        ...(wageMatch ? { wageIndex: wageMatch.wage_index } : {}),
      });
      return data;
    },
    enabled: financial && !!pdgmRequest,
    retry: 1,
  });

  // Agency roster (shared key/signature), narrowed to ADMIN-tier recipients.
  const { data: users = [] } = useQuery({
    queryKey: ["users", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list(undefined, ALL_ROWS);
      const { filterUsersByCallerAgency } = await import("@/lib/agencyScope");
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: financial && !!currentUser,
  });
  const recipients = useMemo(
    () =>
      users
        .filter((u) => u?.email && u.is_active !== false && isAdminLike(u))
        .sort((a, b) => String(a.full_name || a.email).localeCompare(String(b.full_name || b.email))),
    [users]
  );
  const recipient = recipients.find((u) => u.email === recipientEmail) || null;

  const brief = useMemo(
    () =>
      referralData && financial
        ? buildClinicalManagerBrief({
            referralData,
            analysis,
            pdgm: pdgmResponse?.financialsRestricted ? null : pdgmResponse || null,
            storedWeightTable: rateConfig?.case_mix_weight_table || null,
            wageIndexMatch: wageMatch,
            payers,
            visitCosts: payerConfig?.visit_costs || null,
            preparedBy: currentUser?.full_name || currentUser?.email || "",
            sourceFileUrl,
            packetUrl,
          })
        : null,
    [referralData, financial, analysis, pdgmResponse, rateConfig, wageMatch, payers, payerConfig, currentUser, sourceFileUrl, packetUrl]
  );

  // Fail closed: no financial visibility → no card at all.
  if (!financial || !referralData || !brief) return null;

  const original = pdgmResponse?.original || null;

  const pdfOptions = {
    filename: `referral_revenue_brief_${Date.now()}.pdf`,
    title: brief.pdfTitle,
    subtitle: brief.pdfSubtitle,
    content: brief.pdfContent,
  };

  const downloadPdf = async () => {
    setIsDownloading(true);
    try {
      await exportToPDF(pdfOptions);
      toast.success("Revenue brief PDF downloaded.");
    } catch (error) {
      console.error("Error generating revenue brief PDF:", error);
      toast.error("Failed to generate the PDF. Please try again.");
    } finally {
      setIsDownloading(false);
    }
  };

  const emailBrief = async () => {
    if (!recipient) {
      toast.error("Select the clinical manager first.");
      return;
    }
    setIsSending(true);
    try {
      // Generate the PDF and upload it so the email carries a durable link
      // (SendEmail has no attachment support). Non-identifying filename — no
      // patient name in file metadata.
      const blob = await exportToPDF({ ...pdfOptions, output: "blob" });
      const file = new File([blob], pdfOptions.filename, { type: "application/pdf" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });

      await base44.integrations.Core.SendEmail({
        to: recipient.email,
        subject: brief.subject,
        body: `${brief.emailBody}\n\n== PDF ==\nRevenue brief PDF: ${file_url}`,
      });
      try {
        await sendInAppNotification({
          user_email: recipient.email,
          title: "Referral revenue brief emailed to you",
          message: `${currentUser?.full_name || "Intake"} emailed you a referral revenue brief (coding, visit plan, and reimbursement estimate). Check your email for the PDF.`,
          type: "new_referral",
          priority: "medium",
        });
      } catch {
        /* notification is best-effort */
      }
      setSentTo((prev) => [...prev, recipient.full_name || recipient.email]);
      toast.success(`Revenue brief emailed to ${recipient.full_name || recipient.email}.`);
    } catch (error) {
      console.error("Error emailing revenue brief:", error);
      toast.error("Failed to email the revenue brief. Please try again.");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="border-2 border-violet-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileBarChart2 className="w-5 h-5 text-violet-600" />
            Clinical Manager Revenue Brief
          </CardTitle>
          <div className="flex items-center gap-2">
            {brief.hipps?.code && (
              <Badge className="bg-violet-600 text-white font-mono">HIPPS {brief.hipps.code}</Badge>
            )}
            {pdgmPriced && original && (
              <Badge className="bg-green-100 text-green-800">
                ≈ ${original.totalPayment.toFixed(2)} / 30-day period{pdgmResponse?.rateBasis?.isOfficial ? "" : " (draft)"}
              </Badge>
            )}
            {!pdgmPriced && brief.payerEstimate?.estimable && (
              <Badge className="bg-green-100 text-green-800">
                ≈ ${brief.payerEstimate.amount.toFixed(2)} / episode (contract est.)
              </Badge>
            )}
            {!pdgmPriced && <Badge variant="outline">non-PDGM payer</Badge>}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          PDF summary for the clinical manager: patient summary, best coding for maximum reimbursement,
          items to clarify, payer-optimized visit frequency, draft OASIS responses, and the revenue
          estimate — {pdgmPriced
            ? `PDGM HIPPS + draft rate${original ? "" : " (PDGM estimate pending)"}`
            : "from the imported payer reimbursement table (no HIPPS for non-Medicare payers)"}.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {pdgmError && (
          <Alert className="bg-yellow-50 border-yellow-300">
            <ShieldAlert className="w-4 h-4 text-yellow-700" />
            <AlertDescription className="text-xs text-yellow-900">
              The PDGM estimate could not be calculated — the brief still includes coding, clarifications,
              the visit plan, and OASIS drafts.
            </AlertDescription>
          </Alert>
        )}
        {brief.hipps?.mismatch && (
          <Alert className="bg-yellow-50 border-yellow-300">
            <ShieldAlert className="w-4 h-4 text-yellow-700" />
            <AlertDescription className="text-xs text-yellow-900">
              Derived HIPPS {brief.hipps.derived} disagrees with the official table's {brief.hipps.official} —
              verify the grouping inputs before relying on the estimate.
            </AlertDescription>
          </Alert>
        )}

        <div>
          <label htmlFor="brief-manager-recipient" className="text-sm font-medium mb-1 block">
            Clinical manager (admin-tier staff only)
          </label>
          <Select value={recipientEmail} onValueChange={setRecipientEmail}>
            <SelectTrigger id="brief-manager-recipient">
              <SelectValue placeholder={recipients.length === 0 ? "No admin-tier staff available…" : "Select the clinical manager…"} />
            </SelectTrigger>
            <SelectContent>
              {recipients.map((u) => (
                <SelectItem key={u.email} value={u.email}>
                  {u.full_name || u.email} — {u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex flex-wrap gap-1">
            {sentTo.map((name, i) => (
              <Badge key={i} className="bg-green-100 text-green-800 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Sent to {name}
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={downloadPdf} disabled={isDownloading}>
              {isDownloading ? (
                <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-slate-600 mr-2" />Generating…</span>
              ) : (
                <><Download className="w-4 h-4 mr-2" /> Download PDF</>
              )}
            </Button>
            <Button type="button" onClick={emailBrief} disabled={isSending || !recipient} className="bg-violet-600 hover:bg-violet-700">
              {isSending ? (
                <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Sending…</span>
              ) : (
                <><Send className="w-4 h-4 mr-2" /> Email PDF brief</>
              )}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Contains PHI and financial data — recipients are limited to admin-tier staff in your agency.
          Figures are draft planning estimates until official rates are loaded in PDGM Rate Settings.
        </p>
      </CardContent>
    </Card>
  );
}
