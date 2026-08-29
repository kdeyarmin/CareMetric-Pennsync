import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { exportToPDF } from "@/components/utils/pdfExporter";
import {
  buildFollowUpPlan,
  buildProviderForm,
  sortFollowUpItems,
  countFollowUpItems,
} from "./referralFollowUpEngine.js";
import { followUpFormPdfContent } from "./ProviderFollowUpForm.jsx";
import { buildAnalyzerFaxItems } from "./providerFaxItems.js";
import { collectComorbidityCapture } from "./comorbidityCapture.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer, Send, FileDown, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

const severityBadge = (severity) =>
  severity === "critical"
    ? "bg-red-600 text-white"
    : severity === "high"
    ? "bg-orange-500 text-white"
    : "bg-yellow-500 text-white";

/**
 * Provider information-request fax, generated straight from the analyzed
 * referral: every compliance gap (missing/invalid F2F, orders, frequencies,
 * homebound support, certifier, meds, insurance) and reimbursement
 * clarification (uncoded diagnoses, unacceptable principal, per-condition
 * comorbidity confirmations, AI critical-missing items) becomes one itemized
 * request the provider answers in a single round trip.
 *
 * Reuses the referral follow-up engine + provider form + fax pipeline the
 * Referral Follow-Up page already uses — this card covers the analyze-first
 * flow where no Referral record exists yet, so there is no portal link or
 * response tracking here (that lives on the Referral Follow-Up page once a
 * referral is saved). Deterministic content; NO dollar amounts leave the
 * building.
 */
export default function ProviderFaxRequestCard({ referralData, analysis = null }) {
  const [excluded, setExcluded] = useState(() => new Set());
  const [providerFax, setProviderFax] = useState("");
  const [contactBackFax, setContactBackFax] = useState("");
  const [contactBackPhone, setContactBackPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(null);

  // PHI-misdirection guard: when the host switches to a DIFFERENT referral
  // without remounting this card, the previous patient's destination fax,
  // exclusions, and sent status must not carry over — otherwise the next send
  // could fax patient B's request to patient A's provider. (Render-time state
  // adjustment per React's "adjusting state when a prop changes" pattern; the
  // contact-back numbers are agency-level and correctly survive.)
  const [prevReferralData, setPrevReferralData] = useState(referralData);
  if (prevReferralData !== referralData) {
    setPrevReferralData(referralData);
    setExcluded(new Set());
    setProviderFax("");
    setSentAt(null);
  }

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const { data: ruleConfig } = useQuery({
    queryKey: ["followUpRuleConfig", currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerFollowUpRuleConfig } = await import("@/lib/agencySettings");
      return fetchCallerFollowUpRuleConfig(currentUser?.agency_name);
    },
    enabled: !!currentUser,
  });

  const { data: agencySettings } = useQuery({
    queryKey: ["agencySettings", currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerAgencySettings } = await import("@/lib/agencySettings");
      return fetchCallerAgencySettings(currentUser?.agency_name);
    },
    enabled: !!currentUser,
  });

  // Prefill return contact from AgencySettings once loaded (editable after).
  useEffect(() => {
    if (agencySettings) {
      setContactBackFax((v) => v || agencySettings.office_fax_number_e164 || "");
      setContactBackPhone((v) => v || agencySettings.main_office_number_e164 || "");
    }
  }, [agencySettings]);

  const items = useMemo(() => {
    if (!referralData) return [];
    const plan = buildFollowUpPlan(referralData, { ruleConfig: ruleConfig || undefined });
    const analyzerItems = buildAnalyzerFaxItems({
      comorbidityCapture: collectComorbidityCapture(referralData),
      analysis,
      existingItems: plan.items,
    });
    return sortFollowUpItems([...plan.items, ...analyzerItems]);
  }, [referralData, ruleConfig, analysis]);

  const included = items.filter((it) => !excluded.has(it.id));
  const counts = countFollowUpItems(included);

  const ex = referralData?.extracted_data || referralData || {};
  const header = {
    patientName: ex?.demographics?.full_name || "",
    patientDob: ex?.demographics?.date_of_birth || "",
    referralDate: ex?.admission_details?.referral_date || "",
    providerName: ex?.demographics?.referring_physician || "",
    agencyName: agencySettings?.office_name || "our agency",
    contactBackFax,
    contactBackPhone,
  };

  if (!referralData) return null;

  const toggle = (id) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const buildPdf = async ({ output }) => {
    const form = buildProviderForm(header, included);
    return exportToPDF({
      output,
      filename: `provider_information_request_${Date.now()}.pdf`,
      title: form.title,
      subtitle: `${header.patientName}${header.patientDob ? ` — DOB ${header.patientDob}` : ""}`,
      content: followUpFormPdfContent(form),
    });
  };

  const downloadPdf = async () => {
    if (included.length === 0) return;
    setBusy(true);
    try {
      await buildPdf({ output: "save" });
      toast.success("Provider request PDF downloaded.");
    } catch (error) {
      console.error("Provider request PDF failed:", error);
      toast.error("Couldn't generate the PDF. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const faxToProvider = async () => {
    if (included.length === 0) return;
    const to = providerFax.trim();
    if (!to) {
      toast.error("Enter the provider's fax number first.");
      return;
    }
    setBusy(true);
    try {
      const blob = await buildPdf({ output: "blob" });
      const file = new File([blob], "provider-information-request.pdf", { type: "application/pdf" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const { data } = await base44.functions.invoke("sendFax", {
        file_url,
        to_number: to,
        to_name: header.providerName || null,
        document_name: `Information request — ${header.patientName || "referral"}`,
        patient_id: null,
      });
      if (!data?.success) throw new Error(data?.error || "Fax send failed");
      setSentAt(new Date());
      toast.success("Information request faxed to the provider — delivery is tracked in the fax log.");
    } catch (error) {
      console.error("Provider request fax failed:", error);
      toast.error(error?.message || "Couldn't fax the request. Download the PDF and send manually.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-2 border-rose-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="w-5 h-5 text-rose-600" />
            Provider Information Request (Fax)
          </CardTitle>
          <div className="flex gap-1">
            {counts.critical > 0 && <Badge className="bg-red-600 text-white">{counts.critical} critical</Badge>}
            {counts.high > 0 && <Badge className="bg-orange-500 text-white">{counts.high} high</Badge>}
            {counts.medium > 0 && <Badge className="bg-yellow-500 text-white">{counts.medium} medium</Badge>}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Everything this referral still needs from the provider — F2F, orders and frequencies, homebound
          support, coding clarifications, per-condition comorbidity confirmations — as one itemized fax the
          provider completes and returns. Uncheck anything you don't want to request.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-green-800 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" />
            Nothing to request — the referral carries everything the review checks for.
          </p>
        ) : (
          <>
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {items.map((it) => (
                <label
                  key={it.id}
                  htmlFor={`pfr-item-${it.id}`}
                  className={`flex items-start gap-2 p-2 rounded border cursor-pointer ${
                    excluded.has(it.id) ? "bg-slate-50 border-slate-200 opacity-60" : "bg-rose-50 border-rose-200"
                  }`}
                >
                  <Checkbox
                    id={`pfr-item-${it.id}`}
                    checked={!excluded.has(it.id)}
                    onCheckedChange={() => toggle(it.id)}
                    aria-label={`Include: ${it.title}`}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                      {it.title}
                      <Badge className={severityBadge(it.severity)}>{it.severity}</Badge>
                      <Badge variant="outline" className="text-[10px]">{it.category}</Badge>
                    </span>
                    <span className="block text-xs text-slate-700">{it.provider_request?.question || it.needed}</span>
                  </span>
                </label>
              ))}
            </div>

            <div className="grid md:grid-cols-3 gap-2">
              <div>
                <label htmlFor="pfr-provider-fax" className="text-xs font-medium mb-1 block">Provider fax #</label>
                <Input
                  id="pfr-provider-fax"
                  value={providerFax}
                  onChange={(e) => setProviderFax(e.target.value)}
                  placeholder="(555) 555-0100"
                />
              </div>
              <div>
                <label htmlFor="pfr-return-fax" className="text-xs font-medium mb-1 block">Return fax (yours)</label>
                <Input id="pfr-return-fax" value={contactBackFax} onChange={(e) => setContactBackFax(e.target.value)} />
              </div>
              <div>
                <label htmlFor="pfr-return-phone" className="text-xs font-medium mb-1 block">Questions phone</label>
                <Input id="pfr-return-phone" value={contactBackPhone} onChange={(e) => setContactBackPhone(e.target.value)} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[11px] text-slate-500 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5" />
                {sentAt
                  ? `Faxed ${sentAt.toLocaleTimeString()} — delivery tracked in the fax log.`
                  : "For response tracking and the provider's secure online reply link, save the referral and use the Referral Follow-Up page."}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={downloadPdf} disabled={busy || included.length === 0}>
                  <FileDown className="w-4 h-4 mr-2" /> Download PDF
                </Button>
                <Button
                  type="button"
                  onClick={faxToProvider}
                  disabled={busy || included.length === 0}
                  className="bg-rose-600 hover:bg-rose-700"
                >
                  {busy ? (
                    <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Working…</span>
                  ) : (
                    <><Send className="w-4 h-4 mr-2" /> Fax to provider ({included.length})</>
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
