import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { ClipboardCheck, ShieldCheck, TrendingUp, Brain, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  buildFollowUpPlan,
  sortFollowUpItems,
  countFollowUpItems,
  toPersistedFollowUp,
} from "../components/referral/referralFollowUpEngine";
import ProviderFollowUpForm from "../components/referral/ProviderFollowUpForm";

const severityBadge = (severity) =>
  severity === "critical" ? "bg-red-600 text-white" : severity === "high" ? "bg-orange-500 text-white" : "bg-yellow-500 text-white";

/**
 * Referral Follow-Up — the intake QA worklist.
 *
 * For every processed referral, the deterministic follow-up engine (the
 * "30-year coder + QA nurse" rule set) lists what the PROVIDER still needs to
 * supply for full CMS compliance and maximum supportable PDGM reimbursement,
 * why each item matters (with the regulation / payment mechanism), and builds
 * a provider-ready information-request form (PDF / copyable text). An optional
 * AI pass, prompted with the same expert persona, can suggest additional
 * referral-specific gaps — clearly flagged and never auto-included.
 */
export default function ReferralFollowUp() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(searchParams.get("id") || null);
  const [excludedItemIds, setExcludedItemIds] = useState(new Set());
  const [aiItems, setAiItems] = useState([]);
  const [aiAssessment, setAiAssessment] = useState("");
  const [contactBackFax, setContactBackFax] = useState("");
  const [contactBackPhone, setContactBackPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const ai = useAICall({ timeoutMs: 60000, retries: 1 });

  const { data: referrals, isLoading } = useQuery({
    queryKey: ["referrals"],
    queryFn: () => base44.entities.Referral.list("-created_date", 200),
  });

  const { data: rateConfig } = useQuery({
    queryKey: ["pdgmRateConfig"],
    queryFn: () => base44.entities.PDGMRateConfig.list("-created_date", 1).then((rows) => rows?.[0] || null).catch(() => null),
  });

  const engineOpts = useMemo(
    () => ({ rates: rateConfig?.rates, icdGroups: rateConfig?.icd10_clinical_groups }),
    [rateConfig]
  );

  // Referrals that have been processed (extraction exists) and are still in an
  // actionable intake state.
  const reviewable = useMemo(
    () =>
      (referrals || []).filter(
        (r) => r.extracted_data && !["declined", "soc_completed"].includes(r.status)
      ),
    [referrals]
  );

  // Run the deterministic review for every reviewable referral (pure string
  // work — cheap even for a couple hundred rows).
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

  // Reset per-referral working state when the selection changes.
  useEffect(() => {
    setExcludedItemIds(new Set());
    setAiItems([]);
    setAiAssessment("");
  }, [selectedId]);

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
    setSelectedId(id);
    setSearchParams(id ? { id } : {}, { replace: true });
  };

  const runExpertAiReview = async () => {
    if (!selected || !selectedPlan) return;
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
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

  const saveAndMarkSent = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const persisted = toPersistedFollowUp(
        { items: includedItems, counts: countFollowUpItems(includedItems) },
        { generatedAt: new Date().toISOString(), status: "sent" }
      );
      await base44.entities.Referral.update(selected.id, { follow_up_requests: persisted });
      queryClient.invalidateQueries({ queryKey: ["referrals"] });
      toast.success("Follow-up request saved and marked sent on the referral.");
    } catch (error) {
      console.error("Error saving follow-up request:", error);
      toast.error("Couldn't save the follow-up request.");
    } finally {
      setSaving(false);
    }
  };

  const formHeader = selected
    ? {
        patientName: selected.patient_name || selected.extracted_data?.demographics?.full_name || "",
        patientDob: selected.patient_dob || selected.extracted_data?.demographics?.date_of_birth || "",
        referralDate: selected.referral_date || "",
        providerName: selected.extracted_data?.demographics?.referring_physician || "",
        agencyName: "our agency",
        contactBackFax,
        contactBackPhone,
      }
    : null;

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardCheck}
        eyebrow="Office"
        title="Referral Follow-Up"
        description="Expert coder/QA review of each referral: what the provider still needs to send for full CMS compliance and maximum supportable PDGM reimbursement — with a ready-to-send request form"
      />

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
                const plan = plans.get(r.id);
                const counts = plan?.counts;
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
                      <Badge variant="outline" className="text-xs mt-1 bg-blue-50 text-blue-700">
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
                  Select a referral to see what it still needs — and generate the provider request form.
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-4 flex items-center gap-3">
                      <ShieldCheck className="w-6 h-6 text-red-600 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-red-800 uppercase">Compliance gaps</p>
                        <p className="text-2xl font-bold text-red-900">{selectedPlan.counts.compliance}</p>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-navy-200 bg-navy-50">
                    <CardContent className="p-4 flex items-center gap-3">
                      <TrendingUp className="w-6 h-6 text-navy-600 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-navy-800 uppercase">Reimbursement gaps</p>
                        <p className="text-2xl font-bold text-navy-900">{selectedPlan.counts.reimbursement}</p>
                      </div>
                    </CardContent>
                  </Card>
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
                      <div key={it.id} className={`border rounded-lg p-3 ${it.source === "ai" ? "border-purple-300 bg-purple-50" : ""}`}>
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
                              {it.source === "ai" && <Badge className="bg-purple-600 text-white">AI-suggested — verify</Badge>}
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
                              <p className="text-xs text-purple-700 mt-0.5">
                                <span className="font-semibold">Based on:</span> {it.grounded_in}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {aiAssessment && (
                  <Alert className="bg-purple-50 border-purple-300">
                    <Brain className="w-4 h-4 text-purple-700" />
                    <AlertDescription className="text-sm text-purple-900">{aiAssessment}</AlertDescription>
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

                {/* Return-contact details for the form */}
                {includedItems.length > 0 && (
                  <>
                    <Card>
                      <CardContent className="p-4 grid sm:grid-cols-2 gap-3">
                        <div>
                          <Label htmlFor="fu-fax" className="text-xs">Return fax number (shown on the form)</Label>
                          <Input id="fu-fax" value={contactBackFax} onChange={(e) => setContactBackFax(e.target.value)} placeholder="(555) 555-0100" />
                        </div>
                        <div>
                          <Label htmlFor="fu-phone" className="text-xs">Questions phone number</Label>
                          <Input id="fu-phone" value={contactBackPhone} onChange={(e) => setContactBackPhone(e.target.value)} placeholder="(555) 555-0101" />
                        </div>
                      </CardContent>
                    </Card>

                    <ProviderFollowUpForm
                      header={formHeader}
                      items={includedItems}
                      onMarkSent={saveAndMarkSent}
                      markSentDisabled={saving}
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
