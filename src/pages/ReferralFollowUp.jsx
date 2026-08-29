import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { isAdminView } from "@/lib/roles";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import StatCard from "@/components/ui/stat-card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ClipboardCheck, ShieldCheck, TrendingUp, Brain, Sparkles, CheckCircle2,
  AlertTriangle, LinkIcon, Printer, Settings2, FileDown, DollarSign, Inbox,
} from "lucide-react";
import { toast } from "sonner";
import {
  buildFollowUpPlan,
  sortFollowUpItems,
  countFollowUpItems,
  toPersistedFollowUp,
  buildProviderForm,
  FOLLOW_UP_RULES,
  SEVERITIES,
} from "../components/referral/referralFollowUpEngine";
import ProviderFollowUpForm, { followUpFormPdfContent } from "../components/referral/ProviderFollowUpForm";
import ScannedResponseUpload from "../components/referral/ScannedResponseUpload";
import ReferralAgingBoard from "../components/referral/ReferralAgingBoard";
import { estimateFollowUpRevenueImpact, fmtUsd } from "../components/referral/followUpRevenueImpact";
import { exportToPDF } from "@/components/utils/pdfExporter";
import { isSafeExternalUrl } from "@/components/utils/security";

const severityBadge = (severity) =>
  severity === "critical" ? "bg-red-600 text-white" : severity === "high" ? "bg-orange-500 text-white" : "bg-yellow-500 text-white";

const normName = (s) => String(s || "").toLowerCase().replace(/\bdr\.?\b/g, "").replace(/[^a-z]/g, "");

/**
 * Referral Follow-Up — the intake QA worklist.
 *
 * Deterministic coder/QA review of every fully processed referral, provider
 * request generation (PDF, copy, one-click FAX with a secure online response
 * link), response tracking with per-item resolution, and agency-tunable rules.
 *
 * VISIBILITY POLICY: revenue/dollar figures (followUpRevenueImpact) render
 * ONLY for admin-level users (isAdminView) and are never persisted or put on
 * the provider form. Nurses see the clinical/compliance review only.
 */
export default function ReferralFollowUp() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  // The selection IS the ?id= param (selectReferral writes it, deep links from
  // ReferralIntake/OverdueFollowUpsWidget set it, back/forward restores it) —
  // a mount-time useState snapshot froze the page on the first referral when
  // the URL later changed without a remount.
  const selectedId = searchParams.get("id") || null;
  const [excludedItemIds, setExcludedItemIds] = useState(new Set());
  const [aiItems, setAiItems] = useState([]);
  const [aiAssessment, setAiAssessment] = useState("");
  const [contactBackFax, setContactBackFax] = useState("");
  const [contactBackPhone, setContactBackPhone] = useState("");
  const [providerFax, setProviderFax] = useState("");
  const [portalLink, setPortalLink] = useState("");
  const [saving, setSaving] = useState(false);
  const [faxing, setFaxing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const ai = useAICall({ timeoutMs: 60000, retries: 1 });

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const adminView = isAdminView(currentUser);

  const { data: referrals, isLoading } = useQuery({
    queryKey: ["referrals", 200],
    queryFn: () => base44.entities.Referral.list("-created_date", 200),
  });

  const { data: rateConfig } = useQuery({
    queryKey: ["pdgm-rate-config", currentUser?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerPdgmRateConfig } = await import("@/lib/agencySettings");
      return fetchCallerPdgmRateConfig(currentUser?.agency_name);
    },
    enabled: !!currentUser,
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

  const { data: physicians } = useQuery({
    queryKey: ["physicians", "all", "-created_date", 300],
    queryFn: () => base44.entities.Physician.list("-created_date", 300).catch(() => []),
  });

  const engineOpts = useMemo(
    () => ({ rates: rateConfig?.rates, icdGroups: rateConfig?.icd10_clinical_groups, ruleConfig: ruleConfig || undefined }),
    [rateConfig, ruleConfig]
  );

  // Referrals that finished FULL processing and are still in an actionable
  // intake state. `analysis_results` is written only by the full-extraction
  // path (handleProcessingComplete); quick-scan uploads persist a partial
  // extracted_data while status is still "new", and reviewing that shape would
  // fire false "missing F2F/orders/meds" provider requests.
  const reviewable = useMemo(
    () =>
      (referrals || []).filter(
        (r) =>
          r.extracted_data &&
          r.analysis_results &&
          !["declined", "soc_completed"].includes(r.status)
      ),
    [referrals]
  );

  const plans = useMemo(() => {
    const map = new Map();
    for (const r of reviewable) {
      try {
        map.set(r.id, buildFollowUpPlan(r.extracted_data, { ...engineOpts, socDate: r.estimated_start_date }));
      } catch (error) {
        console.error("Follow-up review failed for referral", r.id, error);
      }
    }
    return map;
  }, [reviewable, engineOpts]);

  const selected = reviewable.find((r) => r.id === selectedId) || null;
  const selectedPlan = selected ? plans.get(selected.id) : null;
  const tracking = selected?.follow_up_requests || null;

  // Revenue impact — computed on demand, admin eyes only, never persisted.
  const revenue = useMemo(
    () => (adminView && selectedPlan ? estimateFollowUpRevenueImpact(selectedPlan, { rates: rateConfig?.rates }) : null),
    [adminView, selectedPlan, rateConfig]
  );

  // Reset per-referral working state when the selection changes.
  useEffect(() => {
    setExcludedItemIds(new Set());
    setAiItems([]);
    setAiAssessment("");
    // The plaintext link is deliberately NOT persisted (capability-token
    // hygiene) — legacy rows may still carry one; prefer it if present so old
    // links stay copyable, otherwise staff rotate to mint a fresh link.
    setPortalLink(selected?.follow_up_requests?.portal_link || "");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps -- selected derives from selectedId

  // Prefill return contact from AgencySettings once loaded (editable after).
  useEffect(() => {
    if (agencySettings) {
      setContactBackFax((v) => v || agencySettings.office_fax_number_e164 || "");
      setContactBackPhone((v) => v || agencySettings.main_office_number_e164 || "");
    }
  }, [agencySettings]);

  // Prefill the provider's fax from the Physician directory (best name match).
  // ALWAYS reset on selection change — a stale number from the previous
  // referral must never survive into a new patient's send (wrong-recipient
  // fax = PHI disclosure).
  // Depend on the derived NAME, not on `selected`: any ['referrals'] refetch
  // (e.g. persisting follow_up_requests) mints a new object identity and used to
  // re-run this, wiping or silently reverting a fax the user had just typed.
  const referringPhysicianName = selected
    ? normName(selected.extracted_data?.demographics?.referring_physician)
    : "";
  useEffect(() => {
    const refName = referringPhysicianName;
    if (!refName) {
      setProviderFax("");
      return;
    }
    const match = (physicians || []).find((p) => {
      const n = normName(p.full_name);
      return n && (n.includes(refName) || refName.includes(n));
    });
    setProviderFax(match?.fax_number || "");
  }, [selectedId, referringPhysicianName, physicians]);

  const allItems = useMemo(
    () => sortFollowUpItems([...(selectedPlan?.items || []), ...aiItems]),
    [selectedPlan, aiItems]
  );
  const includedItems = allItems.filter((it) => !excludedItemIds.has(it.id));

  const toggleItem = (id) => {
    setExcludedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectReferral = (id) => {
    setSearchParams(id ? { id } : {}, { replace: true });
  };

  const runExpertAiReview = async () => {
    if (!selected || !selectedPlan) return;
    try {
      const result = await ai.run({
        model: "automatic",
        prompt: `You are a home health coding specialist (HCS-D certified) and quality assurance nurse with 30 years of experience reviewing referrals for Medicare home health agencies. You know exactly which missing or vague documentation causes claim denials, RTPs, ADR takebacks, and underpaid PDGM case-mix — and how to ask a busy referring provider for it so it comes back right the first time.

A deterministic rule engine has ALREADY flagged the following issues on this referral (do NOT repeat these):
${selectedPlan.items.map((i) => `- ${i.title}`).join("\n")}

Review the referral data below and identify ADDITIONAL follow-up items the provider should be asked for, beyond the list above. Rules you must follow:
- Ground every item in what is actually present, absent, vague, or contradictory in THIS referral. Quote or reference the specific referral content in "grounded_in".
- Never invent clinical facts, diagnoses, or ICD-10 codes. You may ask the provider to supply or clarify them.
- Each item needs: what exactly the provider must send back, why it matters (regulation, PDGM payment mechanism, or QA/denial pattern), and a provider-facing question a busy office can answer quickly.
- Only include items with real compliance or reimbursement consequence. If the referral is genuinely complete beyond the flagged list, return an empty list — do not pad.

Referral data: ${JSON.stringify(selected.extracted_data)}`,
        response_json_schema: {
          type: "object",
          properties: {
            additional_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string", enum: ["compliance", "reimbursement"] },
                  severity: { type: "string", enum: ["critical", "high", "medium"] },
                  title: { type: "string" },
                  needed: { type: "string" },
                  why: { type: "string" },
                  citation: { type: "string" },
                  impact: { type: "string" },
                  provider_question: { type: "string" },
                  grounded_in: { type: "string" },
                },
              },
            },
            overall_assessment: { type: "string" },
          },
        },
      });

      const existingTitles = new Set(selectedPlan.items.map((i) => i.title.toLowerCase()));
      const additions = (result?.additional_items || [])
        .filter((a) => a?.title && !existingTitles.has(a.title.toLowerCase()))
        .map((a, idx) => ({
          id: `ai_${idx}_${a.title.slice(0, 24).replace(/\W+/g, "_")}`,
          // Explicit seq AFTER every rule/agency item so AI additions append
          // within their severity/category band instead of jumping ahead.
          seq: 10000 + idx,
          source: "ai",
          category: a.category === "reimbursement" ? "reimbursement" : "compliance",
          severity: ["critical", "high", "medium"].includes(a.severity) ? a.severity : "medium",
          title: a.title,
          needed: a.needed || a.provider_question || "",
          why: a.why || "",
          citation: a.citation || "AI-suggested — verify",
          impact: a.impact || "",
          grounded_in: a.grounded_in || "",
          provider_request: { question: a.provider_question || a.needed || "", response_type: "text", hint: "" },
        }));
      setAiItems(additions);
      setAiAssessment(result?.overall_assessment || "");
      toast.success(
        additions.length > 0
          ? `Expert AI review added ${additions.length} suggestion(s) — review before including.`
          : "Expert AI review found nothing beyond the rule-based checklist."
      );
    } catch (error) {
      console.error("Expert AI review failed:", error);
      toast.error("Expert AI review failed. The rule-based checklist is unaffected.");
    }
  };

  const formHeader = selected
    ? {
        patientName: selected.patient_name || selected.extracted_data?.demographics?.full_name || "",
        patientDob: selected.patient_dob || selected.extracted_data?.demographics?.date_of_birth || "",
        referralDate: selected.referral_date || "",
        providerName: selected.extracted_data?.demographics?.referring_physician || "",
        agencyName: agencySettings?.office_name || "our agency",
        contactBackFax,
        contactBackPhone,
        portalLink: portalLink || null,
      }
    : null;

  // Mint a fresh portal token. The backend deactivates any prior active token
  // for the referral, so every mint ROTATES the link — a re-send always
  // invalidates a previously mailed/leaked link.
  const mintPortalLink = async () => {
    if (!selected) return null;
    try {
      const { data } = await base44.functions.invoke("generateFollowUpPortalToken", {
        referral_id: selected.id,
        provider_name: formHeader?.providerName || null,
      });
      if (data?.portalLink) {
        setPortalLink(data.portalLink);
        return data.portalLink;
      }
      toast.error("Couldn't generate the online response link.");
      return null;
    } catch (error) {
      console.error("Portal link generation failed:", error);
      toast.error("Couldn't generate the online response link.");
      return null;
    }
  };

  const persistRequest = async ({ status, sentVia, faxLogId, link }) => {
    const persisted = toPersistedFollowUp(
      { items: includedItems, counts: countFollowUpItems(includedItems) },
      { generatedAt: new Date().toISOString(), status, sentVia, faxLogId, portalLink: link || portalLink || null }
    );
    // A re-send must not silently discard responses the provider already gave:
    // carry answered/resolved state forward for items that survive the re-send.
    if (tracking?.items?.length) {
      const prior = new Map(tracking.items.map((it) => [it.id, it]));
      persisted.items = persisted.items.map((it) => {
        const old = prior.get(it.id);
        return old && old.item_status !== "open"
          ? { ...it, item_status: old.item_status, response: old.response, answered_at: old.answered_at }
          : it;
      });
    }
    await base44.entities.Referral.update(selected.id, { follow_up_requests: persisted });
    queryClient.invalidateQueries({ queryKey: ["referrals"] });
    return persisted;
  };

  // "Generate online response link" must leave a WORKING link behind:
  // validateFollowUpToken rejects tokens whose referral carries no
  // follow_up_requests items, so persist the request (status stays open —
  // nothing has been sent yet) in the same action as the mint.
  const generateAndPersistPortalLink = async () => {
    const link = await mintPortalLink();
    if (!link) return null;
    try {
      await persistRequest({ status: tracking?.status || "open", sentVia: tracking?.sent_via || null, faxLogId: tracking?.fax_log_id || null, link });
    } catch (error) {
      console.error("Persisting the portal link failed:", error);
      toast.error("Link generated but not saved — re-generate before sending.");
      return null;
    }
    return link;
  };

  const saveAndMarkSent = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      // Always rotate the link on send (old links deactivate server-side).
      const link = await mintPortalLink();
      await persistRequest({ status: "sent", sentVia: "manual", faxLogId: null, link });
      toast.success("Follow-up request saved and marked sent.");
    } catch (error) {
      console.error("Error saving follow-up request:", error);
      toast.error("Couldn't save the follow-up request.");
    } finally {
      setSaving(false);
    }
  };

  const faxToProvider = async () => {
    if (!selected || includedItems.length === 0) return;
    const to = providerFax.trim();
    if (!to) {
      toast.error("Enter the provider's fax number first.");
      return;
    }
    setFaxing(true);
    try {
      // Rotate the portal link on every send, and persist the request BEFORE
      // faxing so the link on the outgoing form is live the moment the fax
      // lands (a fax failure leaves a valid open request, which is harmless).
      const link = await mintPortalLink();
      await persistRequest({ status: "open", sentVia: null, faxLogId: null, link });
      const form = buildProviderForm({ ...formHeader, portalLink: link }, includedItems);
      const blob = await exportToPDF({
        output: "blob",
        title: form.title,
        subtitle: `${formHeader.patientName}${formHeader.patientDob ? ` — DOB ${formHeader.patientDob}` : ""}`,
        content: followUpFormPdfContent(form),
      });
      const file = new File([blob], "referral-follow-up-request.pdf", { type: "application/pdf" });
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const { data } = await base44.functions.invoke("sendFax", {
        file_url,
        to_number: to,
        to_name: formHeader.providerName || null,
        document_name: `Follow-up request — ${formHeader.patientName || "referral"}`,
        patient_id: selected.patient_id || null,
      });
      if (!data?.success) {
        throw new Error(data?.error || "Fax send failed");
      }
      await persistRequest({ status: "sent", sentVia: "fax", faxLogId: data.log_id || null, link });
      toast.success("Faxed to the provider — delivery is tracked in the fax log.");
    } catch (error) {
      console.error("Fax to provider failed:", error);
      toast.error(error?.message || "Couldn't fax the form. Download the PDF and send manually.");
    } finally {
      setFaxing(false);
    }
  };

  const markItemResolved = async (itemId) => {
    if (!selected || !tracking) return;
    try {
      const items = tracking.items.map((it) => (it.id === itemId ? { ...it, item_status: "resolved" } : it));
      const allResolved = items.every((it) => it.item_status === "resolved");
      await base44.entities.Referral.update(selected.id, {
        follow_up_requests: { ...tracking, items, status: allResolved ? "resolved" : tracking.status },
      });
      queryClient.invalidateQueries({ queryKey: ["referrals"] });
    } catch (error) {
      console.error("Error resolving item:", error);
      toast.error("Couldn't update the item.");
    }
  };

  const batchDownloadCritical = async () => {
    const critical = reviewable.filter((r) => (plans.get(r.id)?.counts.critical || 0) > 0);
    if (critical.length === 0) {
      toast.info("No referrals with critical follow-up items right now.");
      return;
    }
    try {
      const content = critical.flatMap((r, idx) => {
        const plan = plans.get(r.id);
        const form = buildProviderForm(
          {
            patientName: r.patient_name || r.extracted_data?.demographics?.full_name || "",
            patientDob: r.patient_dob || "",
            referralDate: r.referral_date || "",
            agencyName: agencySettings?.office_name || "our agency",
            contactBackFax,
            contactBackPhone,
          },
          plan.items
        );
        return [
          ...(idx > 0 ? [{ type: "pageBreak" }] : []),
          { type: "heading", text: `${form.title} — ${r.patient_name || "Unknown patient"}`, size: 14 },
          ...followUpFormPdfContent(form),
        ];
      });
      await exportToPDF({
        filename: "referral-follow-up-requests-critical.pdf",
        title: "Provider Information Requests — Critical Referrals",
        subtitle: `${critical.length} referral(s)`,
        content,
      });
      toast.success(`Generated forms for ${critical.length} referral(s).`);
    } catch (error) {
      console.error("Batch form generation failed:", error);
      toast.error("Couldn't generate the batch PDF.");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="Office"
        title="Referral Follow-Up"
        description="Expert coder/QA review of each referral: what the provider still needs to send for full CMS compliance — with a ready-to-send request form and online provider response"
        actions={
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={batchDownloadCritical}>
              <FileDown className="w-4 h-4 mr-1" /> Batch: critical forms
            </Button>
            {adminView && (
              <Button type="button" variant="outline" size="sm" onClick={() => setShowSettings((s) => !s)}>
                <Settings2 className="w-4 h-4 mr-1" /> Review settings
              </Button>
            )}
          </div>
        }
      />

      {adminView && showSettings && (
        <RuleSettingsCard
          // Remount when the async config (or a save) lands so the local edit
          // state re-seeds from the saved values — otherwise a card opened
          // before the fetch resolves would save empty defaults over the
          // agency's existing configuration.
          key={ruleConfig ? `${ruleConfig.id}-${ruleConfig.updated_date || ""}` : "unloaded"}
          ruleConfig={ruleConfig}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["followUpRuleConfig"] })}
        />
      )}

      {/* Intake→SOC aging at a glance — same board as Referral Intake, compact.
          Reuses this page's ['referrals'] query data; no extra fetch. */}
      {!isLoading && <ReferralAgingBoard referrals={referrals || []} compact className="mb-4" />}

      {isLoading ? (
        <LoadingState label="Loading referrals..." />
      ) : reviewable.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-slate-600">
            No processed referrals to review yet. Process a referral in Referral Intake first.
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-3 gap-4 items-start">
          {/* Referral worklist */}
          <Card className="lg:col-span-1">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Referrals needing follow-up</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {reviewable.map((r) => {
                const counts = plans.get(r.id)?.counts;
                const sentStatus = r.follow_up_requests?.status;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => selectReferral(r.id)}
                    className={`w-full text-left border-2 rounded-lg p-3 transition-all ${
                      selectedId === r.id ? "border-navy-600 bg-navy-50" : "border-slate-200 bg-white hover:border-navy-300"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-slate-900 truncate">
                        {r.patient_name || r.extracted_data?.demographics?.full_name || "Unknown patient"}
                      </p>
                      {counts && counts.total === 0 ? (
                        <Badge className="bg-green-600 text-white">Complete</Badge>
                      ) : (
                        counts && (
                          <span className="flex gap-1 flex-shrink-0">
                            {counts.critical > 0 && <Badge className="bg-red-600 text-white">{counts.critical}</Badge>}
                            {counts.high > 0 && <Badge className="bg-orange-500 text-white">{counts.high}</Badge>}
                            {counts.medium > 0 && <Badge className="bg-yellow-500 text-white">{counts.medium}</Badge>}
                          </span>
                        )
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {r.referral_source || "Unknown source"}
                      {r.referral_date ? ` · ${r.referral_date}` : ""}
                    </p>
                    {sentStatus && (
                      <Badge variant="outline" className={`text-xs mt-1 ${sentStatus === "received" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"}`}>
                        Request {sentStatus}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* Detail: what's needed and why */}
          <div className="lg:col-span-2 space-y-4">
            {!selected || !selectedPlan ? (
              <Card>
                <CardContent className="p-8 text-center text-slate-600">
                  Select a referral to see what it still needs — and send the provider request.
                </CardContent>
              </Card>
            ) : (
              <>
                {/* Request tracking: responses + per-item resolution */}
                {tracking && (
                  <Card className="border-2 border-blue-300">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        <Inbox className="w-5 h-5 text-blue-600" />
                        Sent request — {tracking.status}
                        {tracking.sent_via && <Badge variant="outline">via {tracking.sent_via}</Badge>}
                        {tracking.generated_at && (
                          <span className="text-xs font-normal text-slate-500">{new Date(tracking.generated_at).toLocaleString()}</span>
                        )}
                      </CardTitle>
                      {(portalLink || tracking.portal_link) ? (
                        <button
                          type="button"
                          className="text-xs text-blue-700 underline flex items-center gap-1 w-fit"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(portalLink || tracking.portal_link);
                              toast.success("Portal link copied.");
                            } catch {
                              toast.error("Couldn't copy the link.");
                            }
                          }}
                        >
                          <LinkIcon className="w-3 h-3" /> Copy provider response link
                        </button>
                      ) : tracking.portal_link_active ? (
                        <span className="text-xs text-slate-500 flex items-center gap-1 w-fit">
                          <LinkIcon className="w-3 h-3" /> Online response link active — rotate below to copy a fresh one
                        </span>
                      ) : null}
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {tracking.fax_back && (
                        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm">
                          <p className="font-semibold text-blue-900 flex items-center gap-1">
                            <Printer className="w-4 h-4" /> Provider responded by fax
                            <span className="text-xs font-normal text-blue-700">
                              (auto-matched: {(tracking.fax_back.matched_signals || []).join(", ")})
                            </span>
                          </p>
                          <p className="text-xs text-blue-800 mt-1">
                            Review the faxed document and mark the answered items resolved below.
                          </p>
                          {tracking.fax_back.document_url && isSafeExternalUrl(tracking.fax_back.document_url) && (
                            <a
                              href={tracking.fax_back.document_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-700 underline"
                            >
                              Open faxed response document
                            </a>
                          )}
                        </div>
                      )}
                      {tracking.response_scan && (
                        <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm">
                          <p className="font-semibold text-teal-900 flex items-center gap-1">
                            Provider response scanned in
                            {typeof tracking.response_scan.auto_answered_count === "number" && (
                              <span className="text-xs font-normal text-teal-700">
                                ({tracking.response_scan.auto_answered_count} item(s) auto-answered — verify and resolve)
                              </span>
                            )}
                          </p>
                          {tracking.response_scan.document_url && isSafeExternalUrl(tracking.response_scan.document_url) && (
                            <a
                              href={tracking.response_scan.document_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-teal-700 underline"
                            >
                              Open scanned response document
                            </a>
                          )}
                        </div>
                      )}
                      {/* Manual counterpart to the fax auto-ingestion: scan the
                          returned paper form, preview the extracted answers, apply. */}
                      <ScannedResponseUpload
                        referral={selected}
                        tracking={tracking}
                        onApplied={() => queryClient.invalidateQueries({ queryKey: ["referrals"] })}
                      />
                      {(tracking.items || []).map((it) => (
                        <div key={it.id} className={`border rounded-lg p-3 ${it.item_status === "resolved" ? "bg-green-50 border-green-200" : it.item_status === "answered" ? "bg-blue-50 border-blue-200" : ""}`}>
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm text-slate-900">{it.title}</span>
                              <Badge className={severityBadge(it.severity)}>{it.severity}</Badge>
                              <Badge variant="outline" className={it.item_status === "resolved" ? "text-green-700" : it.item_status === "answered" ? "text-blue-700" : "text-slate-600"}>
                                {it.item_status || "open"}
                              </Badge>
                            </div>
                            {/* Portal answers arrive per-item ("answered"); fax-backs
                                arrive per-document, so any unresolved item is resolvable
                                once the staff has the faxed response in hand. */}
                            {it.item_status !== "resolved" && (tracking.fax_back || tracking.response_scan || it.item_status === "answered") && (
                              <Button type="button" size="sm" variant="outline" onClick={() => markItemResolved(it.id)}>
                                <CheckCircle2 className="w-4 h-4 mr-1" /> Mark resolved
                              </Button>
                            )}
                          </div>
                          {it.response?.text && (
                            <div className="mt-2 bg-white border rounded p-2 text-sm text-slate-800">
                              <p className="text-xs font-semibold text-slate-500 mb-1">
                                Provider response{it.response.completed_by ? ` — ${it.response.completed_by}${it.response.credential ? `, ${it.response.credential}` : ""}` : ""}
                                {it.answered_at ? ` · ${new Date(it.answered_at).toLocaleString()}` : ""}
                              </p>
                              {it.response.text}
                            </div>
                          )}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                <div className={`grid ${adminView && revenue ? "grid-cols-3" : "grid-cols-2"} gap-3`}>
                  <StatCard
                    title="Compliance gaps"
                    value={selectedPlan.counts.compliance}
                    icon={ShieldCheck}
                    tone="amber"
                  />
                  <StatCard
                    title="Reimbursement gaps"
                    value={selectedPlan.counts.reimbursement}
                    icon={TrendingUp}
                    tone="emerald"
                  />
                  {/* Revenue exposure — ADMIN ONLY by policy */}
                  {adminView && revenue && (
                    <Card className="border-emerald-200 bg-emerald-50">
                      <CardContent className="p-4 flex items-center gap-3">
                        <DollarSign className="w-6 h-6 text-emerald-600 flex-shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-emerald-800 uppercase">Est. exposure (admin)</p>
                          <p className="text-lg font-bold text-emerald-900">
                            {revenue.totalAtRisk > 0 ? `${fmtUsd(revenue.totalAtRisk)} at risk` : "—"}
                          </p>
                          {revenue.totalUpsideHigh > 0 && (
                            <p className="text-xs text-emerald-800">
                              +{fmtUsd(revenue.totalUpsideLow)}–{fmtUsd(revenue.totalUpsideHigh)} upside
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Item checklist */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <CardTitle className="text-base">What this referral still needs — and why</CardTitle>
                      <Button type="button" variant="outline" size="sm" onClick={runExpertAiReview} disabled={ai.loading}>
                        {ai.loading ? (
                          <>
                            <Sparkles className="w-4 h-4 mr-1 animate-spin" /> Reviewing…
                          </>
                        ) : (
                          <>
                            <Brain className="w-4 h-4 mr-1" /> Expert AI review
                          </>
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-slate-500">
                      Rule-based review with CMS citations; uncheck anything you don't want on the provider form.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {allItems.length === 0 && (
                      <p className="text-sm text-green-800 flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4" /> This referral has everything the review checks for.
                      </p>
                    )}
                    {allItems.map((it) => (
                      <div key={it.id} className={`border rounded-lg p-3 ${it.source === "ai" ? "border-gold-300 bg-gold-50" : it.source === "agency" ? "border-navy-200 bg-navy-50" : ""}`}>
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={`item-${it.id}`}
                            checked={!excludedItemIds.has(it.id)}
                            onCheckedChange={() => toggleItem(it.id)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <Label htmlFor={`item-${it.id}`} className="flex items-center gap-2 flex-wrap cursor-pointer">
                              <span className="font-semibold text-sm text-slate-900">{it.title}</span>
                              <Badge className={severityBadge(it.severity)}>{it.severity}</Badge>
                              <Badge variant="outline">{it.category}</Badge>
                              {it.source === "ai" && <Badge variant="gold">AI-suggested — verify</Badge>}
                              {it.source === "agency" && <Badge variant="info">agency rule</Badge>}
                              {/* Dollar figures: admin eyes only, by policy */}
                              {adminView && revenue?.perItem[it.id] && (
                                <Badge className="bg-emerald-100 text-emerald-800">
                                  {revenue.perItem[it.id].type === "at_risk"
                                    ? `${fmtUsd(revenue.perItem[it.id].high)} at risk`
                                    : `+${fmtUsd(revenue.perItem[it.id].low)}${revenue.perItem[it.id].high !== revenue.perItem[it.id].low ? `–${fmtUsd(revenue.perItem[it.id].high)}` : ""} est.`}
                                </Badge>
                              )}
                            </Label>
                            <p className="text-sm text-slate-800 mt-1">
                              <span className="font-semibold">Needed:</span> {it.needed}
                            </p>
                            <p className="text-xs text-slate-600 mt-1">
                              <span className="font-semibold">Why:</span> {it.why}{" "}
                              <span className="text-slate-500">({it.citation})</span>
                            </p>
                            <p className="text-xs text-slate-600 mt-0.5">
                              <span className="font-semibold">If not fixed:</span> {it.impact}
                            </p>
                            {it.grounded_in && (
                              <p className="text-xs text-gold-700 mt-0.5">
                                <span className="font-semibold">Based on:</span> {it.grounded_in}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {selectedPlan.internal_notes?.length > 0 && (
                  <Alert className="bg-slate-50 border-slate-300">
                    <AlertTriangle className="w-4 h-4 text-slate-600" />
                    <AlertDescription className="text-sm text-slate-700">
                      <p className="font-semibold mb-1">Agency-side notes (not sent to the provider):</p>
                      <ul className="space-y-0.5">
                        {selectedPlan.internal_notes.map((note, i) => (
                          <li key={i}>• {note}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {aiAssessment && (
                  <Alert className="bg-gold-50 border-gold-300">
                    <Brain className="w-4 h-4 text-gold-700" />
                    <AlertDescription className="text-sm text-navy-900">{aiAssessment}</AlertDescription>
                  </Alert>
                )}

                {allItems.length > 0 && includedItems.length === 0 && (
                  <Alert className="bg-yellow-50 border-yellow-300">
                    <AlertTriangle className="w-4 h-4 text-yellow-700" />
                    <AlertDescription className="text-sm">
                      All items are unchecked — check at least one to build the provider form.
                    </AlertDescription>
                  </Alert>
                )}

                {/* Send details + the form */}
                {includedItems.length > 0 && (
                  <>
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="grid sm:grid-cols-3 gap-3">
                          <div>
                            <Label htmlFor="fu-provider-fax" className="text-xs flex items-center gap-1">
                              <Printer className="w-3 h-3" /> Provider fax (from directory)
                            </Label>
                            <Input id="fu-provider-fax" value={providerFax} onChange={(e) => setProviderFax(e.target.value)} placeholder="+15555550123" />
                          </div>
                          <div>
                            <Label htmlFor="fu-fax" className="text-xs">Return fax (on the form)</Label>
                            <Input id="fu-fax" value={contactBackFax} onChange={(e) => setContactBackFax(e.target.value)} placeholder="(555) 555-0100" />
                            {!agencySettings?.fax_receiving_enabled && (
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                Faxed replies arrive at the office machine on paper — mark items resolved here when
                                they do. (The online response link updates this page automatically.)
                              </p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="fu-phone" className="text-xs">Questions phone</Label>
                            <Input id="fu-phone" value={contactBackPhone} onChange={(e) => setContactBackPhone(e.target.value)} placeholder="(555) 555-0101" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <Button type="button" variant="outline" size="sm" onClick={generateAndPersistPortalLink}>
                            <LinkIcon className="w-4 h-4 mr-1" />
                            {portalLink ? "Rotate online response link" : "Generate online response link"}
                          </Button>
                          {portalLink && (
                            <span className="text-xs text-slate-500 truncate max-w-[360px]">{portalLink}</span>
                          )}
                        </div>
                      </CardContent>
                    </Card>

                    <ProviderFollowUpForm
                      header={formHeader}
                      items={includedItems}
                      onMarkSent={saveAndMarkSent}
                      markSentDisabled={saving}
                      onFax={faxToProvider}
                      faxDisabled={faxing || !providerFax.trim()}
                      faxLabel={faxing ? "Faxing…" : "Fax to provider"}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}

/** Admin settings: enable/disable rules, override severities, add agency items. */
function RuleSettingsCard({ ruleConfig, onSaved }) {
  const [disabled, setDisabled] = useState(new Set(ruleConfig?.disabled_rules || []));
  const [overrides, setOverrides] = useState(ruleConfig?.severity_overrides || {});
  const [customItems, setCustomItems] = useState(ruleConfig?.custom_items || []);
  const [draft, setDraft] = useState({ title: "", question: "", category: "compliance", severity: "medium", why: "" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await base44.functions.invoke("saveFollowUpRuleConfig", {
        disabled_rules: [...disabled],
        severity_overrides: overrides,
        custom_items: customItems,
      });
      if (!data?.success) throw new Error(data?.error || "Save failed");
      toast.success("Review settings saved.");
      onSaved?.();
    } catch (error) {
      console.error("Saving rule config failed:", error);
      toast.error("Couldn't save the review settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mb-4 border-2 border-slate-300">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-slate-600" /> Review settings (agency-wide)
        </CardTitle>
        <p className="text-xs text-slate-500">
          The built-in rules are the compliance floor — disable only what genuinely doesn't apply to your agency.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid md:grid-cols-2 gap-2">
          {FOLLOW_UP_RULES.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between gap-2 border rounded p-2">
              <div className="flex items-center gap-2 min-w-0">
                <Checkbox
                  id={`rule-${rule.id}`}
                  checked={!disabled.has(rule.id)}
                  onCheckedChange={() =>
                    setDisabled((prev) => {
                      const next = new Set(prev);
                      if (next.has(rule.id)) next.delete(rule.id);
                      else next.add(rule.id);
                      return next;
                    })
                  }
                />
                <Label htmlFor={`rule-${rule.id}`} className="text-xs truncate cursor-pointer">{rule.label}</Label>
              </div>
              <Select
                value={overrides[rule.id] || rule.defaultSeverity}
                onValueChange={(v) =>
                  setOverrides((prev) => {
                    const next = { ...prev };
                    if (v === rule.defaultSeverity) delete next[rule.id];
                    else next[rule.id] = v;
                    return next;
                  })
                }
              >
                <SelectTrigger className="w-[110px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Agency-defined request items</p>
          {customItems.map((c, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 text-xs bg-navy-50 border border-navy-200 rounded p-2">
              <span className="truncate"><strong>{c.title}</strong> — {c.question}</span>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCustomItems((prev) => prev.filter((_, i) => i !== idx))}>
                Remove
              </Button>
            </div>
          ))}
          <div className="grid sm:grid-cols-2 gap-2">
            <Input placeholder="Title (e.g. Wound photos)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            <Input placeholder="Provider question" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} />
            <Input placeholder="Why it's needed (shown on the form)" value={draft.why} onChange={(e) => setDraft({ ...draft, why: e.target.value })} className="sm:col-span-2" />
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="compliance">compliance</SelectItem>
                <SelectItem value="reimbursement">reimbursement</SelectItem>
              </SelectContent>
            </Select>
            <Select value={draft.severity} onValueChange={(v) => setDraft({ ...draft, severity: v })}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!draft.title.trim() || !draft.question.trim()}
            onClick={() => {
              setCustomItems((prev) => [...prev, draft]);
              setDraft({ title: "", question: "", category: "compliance", severity: "medium", why: "" });
            }}
          >
            Add item
          </Button>
        </div>

        <Button type="button" onClick={save} disabled={saving} className="bg-navy-600 hover:bg-navy-700">
          {saving ? "Saving…" : "Save review settings"}
        </Button>
      </CardContent>
    </Card>
  );
}
