import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useAICall } from "@/hooks/useAICall";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  FileSearch,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  BookOpen,
  TrendingUp,
  Shield,
  Info,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  ListChecks
} from "lucide-react";
import { resolveCmsGuidelineLink, HH_QUALITY_REPORTING_URL } from "./cmsGuidelineLinks.js";
import { runOasisDeterministicChecks, deterministicChecksPromptBlock } from "./oasisDeterministicChecks.js";
import { buildActionItemsFromReview, actionItemKey } from "./reviewActionItems.js";
import { reviewFingerprint } from "./reviewFreshness.js";
import { isAICancellation } from "@/lib/aiScheduler";
import { computeAge } from "@/lib/age";

// Only the clinically relevant slice of the patient record goes to the LLM —
// contact info and direct identifiers (name, DOB, address, phone, email,
// emergency contacts) add nothing to compliance reasoning and don't belong in
// the prompt. Age is derived so the DOB itself never leaves the app.
function clinicalPatientContext(patient) {
  if (!patient) return {};
  const age = computeAge(patient.date_of_birth);
  return {
    ...(Number.isFinite(age) ? { age } : {}),
    ...(patient.gender ? { gender: patient.gender } : {}),
    ...(patient.primary_diagnosis ? { primary_diagnosis: patient.primary_diagnosis } : {}),
    ...(patient.secondary_diagnoses?.length ? { secondary_diagnoses: patient.secondary_diagnoses } : {}),
    ...(patient.allergies ? { allergies: patient.allergies } : {}),
    ...(patient.current_medications?.length ? { current_medications: patient.current_medications } : {}),
    ...(patient.care_type ? { care_type: patient.care_type } : {}),
    ...(patient.status ? { status: patient.status } : {}),
    ...(patient.admission_date ? { admission_date: patient.admission_date } : {}),
    ...(patient.admission_source ? { admission_source: patient.admission_source } : {}),
  };
}

// How many existing action items to scan when de-duplicating. An analysis
// accumulates a bounded number of findings; this is generous headroom.
const ACTION_ITEM_SCAN_LIMIT = 200;

// Findings render most-severe first regardless of the order the model emitted.
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const bySeverity = (key) => (a, b) =>
  (SEVERITY_RANK[a?.[key]] ?? 4) - (SEVERITY_RANK[b?.[key]] ?? 4);

// Reference link for a finding: official eCFR link derived from the citation,
// else the AI link when safe, else a curated topic page (see cmsGuidelineLinks).
function CmsGuidelineLink({ regulation, aiLink, fallback, children }) {
  const href = resolveCmsGuidelineLink(regulation, aiLink) || fallback || null;
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-indigo-600 hover:text-indigo-700 underline flex items-center gap-1"
    >
      <ExternalLink className="w-3 h-3" />
      {children}
    </a>
  );
}

export default function ComprehensiveOASISReviewer({
  oasisData,
  analysisResults,
  patientData,
  autoReview = true,
  savedReview = null,
  onReviewComplete,
  analysisId = null,
  patientName = "",
  onActionItemsCreated,
  // Fail-closed: the only place these records can be read, assigned or
  // rejected is OASISActionWorkflow, which renders revenue impact and so is
  // admin-gated. Offering creation to a user who cannot open that workflow
  // would file records they can never see or correct.
  canManageActionItems = false
}) {
  const ai = useAICall();
  const [reviewResults, setReviewResults] = useState(null);
  const [reviewError, setReviewError] = useState(false);
  const [actionItemsCreated, setActionItemsCreated] = useState(false);
  const [isCreatingActions, setIsCreatingActions] = useState(false);
  // When the current results were produced, and a fingerprint of the inputs they
  // ran against. A later correction — or a patient match landing after the fact —
  // changes the fingerprint, flagging the review stale. Unlike object identity
  // this survives persistence, so a rehydrated review is judged on its real
  // inputs rather than being assumed current.
  const [reviewedAt, setReviewedAt] = useState(null);
  const [reviewedFingerprint, setReviewedFingerprint] = useState(null);
  const [expandedSections, setExpandedSections] = useState(['compliance', 'quality', 'inconsistencies']);

  // Hold the completion callback in a ref so an inline parent callback doesn't
  // change performComprehensiveReview's identity every render.
  const onReviewCompleteRef = useRef(onReviewComplete);
  useEffect(() => {
    onReviewCompleteRef.current = onReviewComplete;
  }, [onReviewComplete]);

  // Rule-based checks are pure and instant, so they always reflect the CURRENT
  // oasisData — including in-place corrections — with no billed call and no
  // waiting on (or trusting) the LLM for rule-checkable problems.
  const deterministicChecks = useMemo(
    () => (oasisData ? runOasisDeterministicChecks(oasisData) : null),
    [oasisData]
  );

  // The exact inputs a review would run against right now.
  const patientContext = useMemo(() => clinicalPatientContext(patientData), [patientData]);
  const currentFingerprint = useMemo(
    () => reviewFingerprint(oasisData, patientContext),
    [oasisData, patientContext]
  );

  // Monotonic run id: a re-run (or a new assessment) supersedes any in-flight
  // review, so a slower earlier response can never overwrite newer findings.
  const runIdRef = useRef(0);
  // A review already in flight is allowed to finish (the scheduler only drops
  // QUEUED work), but once this card is gone its result must not be reported:
  // the parent clears its review state when a new document is selected, and a
  // late completion would be rehydrated as the NEXT assessment's saved review.
  // Set on (re)mount so StrictMode's dev remount cannot wedge it false.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // `interactive: true` for a review the user asked for by clicking — it jumps
  // ahead of the page's other auto-fired analyses in the app-wide AI budget.
  const performComprehensiveReview = useCallback(async ({ interactive = false } = {}) => {
    if (!oasisData || !analysisResults) return;

    const runId = (runIdRef.current += 1);
    // Clear prior findings immediately: while this review runs the UI must show
    // the loading state, never the PREVIOUS assessment's compliance findings.
    setReviewResults(null);
    setReviewError(false);
    setActionItemsCreated(false);
    try {
      const prompt = `You are a Medicare OASIS compliance expert. Perform a COMPREHENSIVE review of this OASIS assessment.

OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

ANALYSIS RESULTS:
${JSON.stringify(analysisResults, null, 2)}

${deterministicChecksPromptBlock(runOasisDeterministicChecks(oasisData))}

PATIENT CONTEXT (clinical fields only):
${JSON.stringify(patientContext, null, 2)}

PERFORM COMPREHENSIVE REVIEW IN 3 AREAS:

1. COMPLIANCE RISKS
Identify specific compliance violations or risks:
- Missing required M-items or skip patterns
- CMS CoP (Conditions of Participation) violations
- Medicare coverage requirement gaps
- Homebound status insufficiency
- Skilled need justification gaps
- Assessment timing issues
- Discharge planning deficiencies
- Patient rights documentation
- Infection control requirements
- Safety assessment gaps

For EACH compliance risk, provide:
- Risk description
- Severity level (critical/high/medium/low)
- Specific CMS regulation violated
- Official CMS guideline link (use real CMS.gov URLs from 42 CFR 484)
- Plain-language explanation (as if explaining to a non-clinician)
- Specific corrective action required
- Example of compliant documentation
- Timeline to fix (immediate/within 24hrs/within week)

2. QUALITY MEASURE IMPROVEMENTS
Analyze OASIS-based Quality Measures:
- Improvement in Ambulation (M1860)
- Improvement in Bed Transferring (M1850)
- Improvement in Bathing (M1830)
- Improvement in Dyspnea (M1400)
- Acute Care Hospitalization rates
- Discharge to Community
- Drug Education on All Medications
- Influenza Immunization
- Pneumococcal Immunization

For EACH quality measure opportunity, provide:
- Measure name and NQF number
- Current status (at-risk/missing/good)
- What data is missing or weak
- Impact on STAR ratings
- CMS Quality Reporting guideline link
- Plain-language explanation of the measure
- Specific documentation to add
- Expected improvement in score

3. DOCUMENTATION INCONSISTENCIES
Identify contradictions and logical errors:
- Functional scores vs narrative mismatches
- Comorbidity vs medication contradictions
- Wound status vs treatment plan conflicts
- Cognitive score vs independence contradictions
- Safety risk vs interventions mismatches
- Timeline/date inconsistencies
- Clinical group vs diagnosis conflicts

For EACH inconsistency, provide:
- Description of the contradiction
- Data points involved (specific M-items)
- Why it matters (revenue/audit/quality impact)
- Plain-language explanation
- Which data point is likely incorrect
- How to reconcile the inconsistency
- CMS guidance on proper documentation

Return detailed JSON with all findings.`;

      const result = await ai.run({
        model: "automatic",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            review_summary: { type: "string" },
            overall_risk_level: { type: "string", enum: ["critical", "high", "moderate", "low", "minimal"] },
            total_findings: { type: "number" },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_title: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  cms_regulation: { type: "string" },
                  cms_guideline_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  corrective_action: { type: "string" },
                  compliant_example: { type: "string" },
                  timeline_to_fix: { type: "string", enum: ["immediate", "within_24hrs", "within_week", "within_month"] },
                  affected_m_items: { type: "array", items: { type: "string" } },
                  audit_impact: { type: "string" },
                  revenue_impact: { type: "string" }
                }
              }
            },
            quality_measure_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  measure_name: { type: "string" },
                  nqf_number: { type: "string" },
                  current_status: { type: "string", enum: ["at_risk", "missing_data", "good", "needs_improvement"] },
                  what_is_missing: { type: "string" },
                  star_rating_impact: { type: "string" },
                  cms_quality_reporting_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  specific_documentation_needed: { type: "string" },
                  expected_score_improvement: { type: "string" },
                  implementation_priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  baseline_data_needed: { type: "boolean" },
                  discharge_data_needed: { type: "boolean" }
                }
              }
            },
            documentation_inconsistencies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  inconsistency_title: { type: "string" },
                  description: { type: "string" },
                  data_points_involved: { type: "array", items: { type: "string" } },
                  why_it_matters: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  likely_incorrect_value: { type: "string" },
                  how_to_reconcile: { type: "string" },
                  cms_guidance: { type: "string" },
                  cms_guidance_link: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  impact_on_revenue: { type: "string" },
                  impact_on_quality: { type: "string" },
                  impact_on_audit: { type: "string" }
                }
              }
            },
            critical_action_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  urgency: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } }
          }
        }
      }, {
        // An auto-fired review is background work and is dropped if it is still
        // queued when this card unmounts; a review the user clicked for jumps
        // the queue and always runs.
        priority: interactive ? "interactive" : "background",
        cancelOnUnmount: !interactive,
      });

      if (runId !== runIdRef.current) return; // superseded by a newer review
      if (!isMountedRef.current) return; // card is gone — see isMountedRef
      const reviewedAtIso = new Date().toISOString();
      const fingerprint = reviewFingerprint(oasisData, patientContext);
      setReviewResults(result);
      setReviewedAt(reviewedAtIso);
      setReviewedFingerprint(fingerprint);
      // Report upward so the caller can persist the review on the OASISUpload
      // record and restore it (instead of re-billing) when the upload reopens.
      // The fingerprint travels with it so a rehydrated review is judged
      // against the data it actually ran on.
      onReviewCompleteRef.current?.({ results: result, reviewed_at: reviewedAtIso, fingerprint });
    } catch (error) {
      if (runId !== runIdRef.current) return; // superseded by a newer review
      if (!isMountedRef.current) return; // card is gone — nobody to show it to
      // A queued review dropped because this card unmounted was never sent —
      // there is no failure to report, and nobody left to read a toast.
      if (isAICancellation(error)) return;
      console.error('Comprehensive review error:', error);
      setReviewError(true);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, oasisData, patientData]);

  // ONCE per loaded assessment: restore the persisted review when the caller
  // supplies one, otherwise auto-run. `analysisResults` gets a fresh object
  // only when a new document is analyzed, whereas `oasisData` (pdgmData) is
  // replaced in place on every applied correction / Smart Note import — keying
  // on it re-fired a full billed LLM review per correction, with overlapping
  // runs racing each other. After in-place data edits the user re-runs
  // explicitly via the "Re-run Comprehensive Review" button.
  const lastAutoReviewedRef = useRef(null);
  useEffect(() => {
    if (!oasisData || !analysisResults) return;
    if (lastAutoReviewedRef.current === analysisResults) return;
    lastAutoReviewedRef.current = analysisResults;
    if (savedReview?.results) {
      runIdRef.current += 1; // supersede any in-flight run
      setReviewResults(savedReview.results);
      setReviewedAt(savedReview.reviewed_at || null);
      // Trust the fingerprint stored WITH the review, not the data in front of
      // us: a review saved before a correction must rehydrate as stale, not be
      // silently re-blessed as current.
      setReviewedFingerprint(savedReview.fingerprint || null);
      setReviewError(false);
      setActionItemsCreated(false);
      return;
    }
    if (autoReview) performComprehensiveReview();
  }, [autoReview, oasisData, analysisResults, savedReview, performComprehensiveReview]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-400';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-400';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-400';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-400';
      default: return 'bg-slate-100 text-slate-800 border-slate-400';
    }
  };

  const getRiskLevelColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-700 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-green-600 text-white';
      case 'minimal': return 'bg-green-700 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const getTimelineIcon = (timeline) => {
    switch (timeline) {
      case 'immediate': return '🚨';
      case 'within_24hrs': return '⏰';
      case 'within_week': return '📅';
      case 'within_month': return '🗓️';
      default: return '⏱️';
    }
  };

  // The Strengths accordion only renders when the review reported strengths, so
  // "Expand/Collapse All" must count the sections actually on screen.
  const allSections = reviewResults?.strengths?.length > 0
    ? ['compliance', 'quality', 'inconsistencies', 'strengths']
    : ['compliance', 'quality', 'inconsistencies'];
  const allExpanded = allSections.every((s) => expandedSections.includes(s));

  const complianceRisks = [...(reviewResults?.compliance_risks || [])].sort(bySeverity('severity'));
  const qualityMeasures = [...(reviewResults?.quality_measure_opportunities || [])].sort(bySeverity('implementation_priority'));
  const inconsistencies = [...(reviewResults?.documentation_inconsistencies || [])].sort(bySeverity('severity'));

  // Correctable findings → OASISActionItem payloads (built pure; created on demand).
  const actionItemPayloads = useMemo(
    () =>
      buildActionItemsFromReview({
        reviewResults,
        deterministicFindings: deterministicChecks?.findings || [],
        analysisId,
        patientName,
      }),
    [reviewResults, deterministicChecks, analysisId, patientName]
  );

  const createActionItems = async () => {
    if (!actionItemPayloads.length || isCreatingActions) return;
    setIsCreatingActions(true);
    try {
      // Duplicate guard, per finding. This analysis may already carry items from
      // an earlier run of this button or from the action workflow's own
      // "Generate Actions" — but those are usually DIFFERENT findings, so an
      // all-or-nothing check would silently file none of ours.
      const existing = await base44.entities.OASISActionItem.filter(
        { analysis_id: analysisId },
        undefined,
        ACTION_ITEM_SCAN_LIMIT
      );
      const seen = new Set((existing || []).map(actionItemKey));
      const fresh = actionItemPayloads.filter((item) => !seen.has(actionItemKey(item)));
      if (fresh.length === 0) {
        setActionItemsCreated(true);
        toast.info("These findings are already filed as action items — see the action workflow.");
        return;
      }
      await base44.entities.OASISActionItem.bulkCreate(fresh);
      setActionItemsCreated(true);
      const skipped = actionItemPayloads.length - fresh.length;
      toast.success(
        `${fresh.length} action item${fresh.length === 1 ? "" : "s"} created for the action workflow.`
        + (skipped > 0 ? ` ${skipped} already filed.` : "")
      );
      onActionItemsCreated?.(fresh.length);
    } catch (error) {
      console.error("Failed to create action items:", error);
      toast.error("Couldn't create action items. Please try again.");
    } finally {
      setIsCreatingActions(false);
    }
  };

  // Findings computed against different inputs — corrected M-items, or a patient
  // match that resolved after the review ran — may no longer hold. A review with
  // no recorded fingerprint (persisted before this was tracked) is left alone
  // rather than being labelled stale on no evidence.
  const dataChangedSinceReview = !!(
    reviewResults && reviewedFingerprint && currentFingerprint && currentFingerprint !== reviewedFingerprint
  );

  return (
    <Card className="border-2 border-indigo-400 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-indigo-600" />
            Comprehensive OASIS Review
            {ai.loading && <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />}
          </CardTitle>
          {reviewResults && (
            <Badge className={getRiskLevelColor(reviewResults.overall_risk_level)}>
              {reviewResults.overall_risk_level?.toUpperCase()} RISK
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* Deterministic checks — instant, free, and always current (they track
            every in-place data correction live, unlike the AI review) */}
        {deterministicChecks && (
          <div
            className={`mb-4 rounded-lg border-2 p-3 ${
              deterministicChecks.failed > 0
                ? 'bg-amber-50 border-amber-300'
                : 'bg-green-50 border-green-300'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <p className="font-semibold text-sm text-slate-900 flex items-center gap-2">
                <ListChecks className="w-4 h-4" />
                Deterministic Checks
              </p>
              <Badge variant="outline" className="bg-white">
                {deterministicChecks.passed}/{deterministicChecks.total} passed
              </Badge>
            </div>
            {deterministicChecks.failed === 0 ? (
              <p className="text-sm text-green-800 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" />
                All rule-based checks passed — item ranges, required PDGM items, internal consistency, diagnosis code format, and assessment dates.
              </p>
            ) : (
              <ul className="space-y-1.5 mt-1">
                {deterministicChecks.findings.map((finding) => (
                  <li key={finding.check} className="flex items-start gap-2 text-sm">
                    <Badge className={getSeverityColor(finding.severity)}>{finding.severity}</Badge>
                    <span className="text-slate-800">
                      <span className="font-mono text-xs mr-1">{finding.m_items.join('/')}</span>
                      {finding.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-16 h-16 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-indigo-700 font-medium mb-2">AI performing comprehensive OASIS review...</p>
            <p className="text-sm text-slate-600">Analyzing compliance, quality measures, and documentation consistency</p>
          </div>
        )}

        {!ai.loading && !reviewResults && (
          <div className="text-center py-8">
            {reviewError ? (
              <>
                <XCircle className="w-16 h-16 text-red-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-4">The comprehensive review didn't complete. Run it again below.</p>
              </>
            ) : (
              <>
                <FileSearch className="w-16 h-16 text-indigo-300 mx-auto mb-4" />
                <p className="text-slate-600 mb-4">Click below to perform a comprehensive AI review</p>
              </>
            )}
            <Button onClick={() => performComprehensiveReview({ interactive: true })} className="bg-indigo-600 hover:bg-indigo-700">
              <FileSearch className="w-4 h-4 mr-2" />
              {reviewError ? 'Retry Comprehensive Review' : 'Start Comprehensive Review'}
            </Button>
          </div>
        )}

        {reviewResults && (
          <div className="space-y-4">
            {/* Stale-data notice — assessment edited since this review ran */}
            {dataChangedSinceReview && (
              <Alert className="bg-amber-50 border-amber-400">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <AlertDescription>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-sm text-amber-900 font-medium">
                      Assessment data has changed since this review — the findings below may be outdated.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => performComprehensiveReview({ interactive: true })}
                      disabled={ai.loading}
                    >
                      Re-run review
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Review Summary */}
            <Alert className={
              reviewResults.overall_risk_level === 'critical' || reviewResults.overall_risk_level === 'high'
                ? 'bg-red-100 border-red-400'
                : reviewResults.overall_risk_level === 'moderate'
                ? 'bg-yellow-100 border-yellow-400'
                : 'bg-green-100 border-green-400'
            }>
              <AlertDescription>
                <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
                  <p className="font-semibold text-slate-900">Review Summary</p>
                  <div className="flex items-center gap-2">
                    {reviewedAt && (
                      <span className="text-xs text-slate-600">
                        Reviewed {new Date(reviewedAt).toLocaleString()}
                      </span>
                    )}
                    <Badge variant="outline">{reviewResults.total_findings} findings</Badge>
                  </div>
                </div>
                <p className="text-sm text-slate-800">{reviewResults.review_summary}</p>
              </AlertDescription>
            </Alert>

            {/* Critical Action Items */}
            {reviewResults.critical_action_items?.length > 0 && (
              <Alert className="bg-red-50 border-red-400">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <AlertDescription>
                  <p className="font-semibold text-red-900 mb-3">🚨 Critical Actions Required</p>
                  <div className="space-y-2">
                    {reviewResults.critical_action_items.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-lg border border-red-300">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                            {idx + 1}
                          </span>
                          <p className="font-semibold text-red-900">{item.action}</p>
                        </div>
                        <Badge className="text-xs mb-2">{item.urgency}</Badge>
                        <p className="text-sm text-slate-700">{item.expected_outcome}</p>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <Accordion type="multiple" value={expandedSections} onValueChange={setExpandedSections} className="space-y-3">
              {/* Compliance Risks */}
              <AccordionItem value="compliance" className="border-2 border-red-400 rounded-lg bg-red-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-red-600" />
                    <span className="font-semibold text-red-900">
                      Compliance Risks ({complianceRisks.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {complianceRisks.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">No compliance risks detected</p>
                    </div>
                  ) : (
                    // Native overflow scrolling: Radix ScrollArea's h-full viewport
                    // cannot resolve against a max-h (auto-height) root, which
                    // silently CLIPPED findings past 600px with no scrollbar.
                    <div className="max-h-[600px] overflow-y-auto pr-1">
                      <div className="space-y-4">
                        {complianceRisks.map((risk, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-red-300 p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-semibold text-red-900">{risk.risk_title}</h4>
                                  <Badge className={getSeverityColor(risk.severity)}>
                                    {risk.severity}
                                  </Badge>
                                  <span className="text-xl">{getTimelineIcon(risk.timeline_to_fix)}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {risk.timeline_to_fix?.replace('_', ' ')}
                                  </Badge>
                                </div>
                                {risk.affected_m_items?.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {risk.affected_m_items.map((item, i) => (
                                      <Badge key={i} variant="outline" className="text-xs font-mono">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <p className="text-sm text-slate-800 mb-3">{risk.description}</p>

                            {/* Plain Language Explanation */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <div className="flex items-center gap-2 mb-1">
                                <Info className="w-4 h-4 text-blue-600" />
                                <p className="font-semibold text-xs text-blue-900">Plain English</p>
                              </div>
                              <p className="text-sm text-blue-800">{risk.plain_language_explanation}</p>
                            </div>

                            {/* CMS Regulation Reference */}
                            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300 mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <BookOpen className="w-4 h-4 text-indigo-600" />
                                <p className="font-semibold text-xs text-indigo-900">CMS Regulation</p>
                              </div>
                              <p className="text-sm text-indigo-800 mb-2">{risk.cms_regulation}</p>
                              <CmsGuidelineLink regulation={risk.cms_regulation} aiLink={risk.cms_guideline_link}>
                                View Official CMS Guideline
                              </CmsGuidelineLink>
                            </div>

                            {/* Impact Analysis */}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {risk.audit_impact && (
                                <div className="bg-orange-50 p-2 rounded border border-orange-200">
                                  <p className="text-xs text-orange-700 font-semibold mb-1">📋 Audit Impact</p>
                                  <p className="text-xs text-orange-800">{risk.audit_impact}</p>
                                </div>
                              )}
                              {risk.revenue_impact && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="text-xs text-green-700 font-semibold mb-1">💰 Revenue Impact</p>
                                  <p className="text-xs text-green-800">{risk.revenue_impact}</p>
                                </div>
                              )}
                            </div>

                            {/* Corrective Action */}
                            <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                              <p className="font-semibold text-xs text-yellow-900 mb-1">🔧 Corrective Action Required</p>
                              <p className="text-sm text-yellow-800">{risk.corrective_action}</p>
                            </div>

                            {/* Compliant Example */}
                            {risk.compliant_example && (
                              <div className="bg-green-50 p-3 rounded-lg border border-green-300">
                                <p className="font-semibold text-xs text-green-900 mb-1">✓ Compliant Example</p>
                                <p className="text-sm text-green-800 italic">"{risk.compliant_example}"</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Quality Measure Opportunities */}
              <AccordionItem value="quality" className="border-2 border-navy-400 rounded-lg bg-navy-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-navy-600" />
                    <span className="font-semibold text-navy-900">
                      Quality Measure Opportunities ({qualityMeasures.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {qualityMeasures.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">All quality measures well-documented</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {qualityMeasures.map((measure, idx) => (
                        <div key={idx} className="bg-white rounded-lg border-2 border-navy-300 p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="font-semibold text-navy-900">{measure.measure_name}</h4>
                              {measure.nqf_number && (
                                <Badge variant="outline" className="text-xs mt-1">
                                  {measure.nqf_number}
                                </Badge>
                              )}
                            </div>
                            <div className="text-right">
                              <Badge className={
                                measure.current_status === 'at_risk' ? 'bg-red-600 text-white' :
                                measure.current_status === 'missing_data' ? 'bg-orange-600 text-white' :
                                measure.current_status === 'needs_improvement' ? 'bg-yellow-600 text-white' :
                                'bg-green-600 text-white'
                              }>
                                {measure.current_status?.replace('_', ' ')}
                              </Badge>
                              <Badge className={getSeverityColor(measure.implementation_priority)}>
                                {measure.implementation_priority} priority
                              </Badge>
                            </div>
                          </div>

                          {/* Plain Language Explanation */}
                          <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Info className="w-4 h-4 text-blue-600" />
                              <p className="font-semibold text-xs text-blue-900">What This Measure Means</p>
                            </div>
                            <p className="text-sm text-blue-800">{measure.plain_language_explanation}</p>
                          </div>

                          {/* Missing Data */}
                          <div className="bg-orange-50 p-3 rounded-lg border border-orange-300 mb-3">
                            <p className="font-semibold text-xs text-orange-900 mb-1">⚠️ What's Missing</p>
                            <p className="text-sm text-orange-800">{measure.what_is_missing}</p>
                          </div>

                          {/* STAR Rating Impact */}
                          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                            <p className="font-semibold text-xs text-yellow-900 mb-1">⭐ STAR Rating Impact</p>
                            <p className="text-sm text-yellow-800">{measure.star_rating_impact}</p>
                          </div>

                          {/* CMS Quality Reporting Link — always resolvable: the
                              official HH QRP page backs any missing/unsafe AI link */}
                          <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300 mb-3">
                            <div className="flex items-center gap-2 mb-2">
                              <BookOpen className="w-4 h-4 text-indigo-600" />
                              <p className="font-semibold text-xs text-indigo-900">CMS Quality Reporting</p>
                            </div>
                            <CmsGuidelineLink
                              regulation={measure.measure_name}
                              aiLink={measure.cms_quality_reporting_link}
                              fallback={HH_QUALITY_REPORTING_URL}
                            >
                              View Quality Measure Specifications
                            </CmsGuidelineLink>
                          </div>

                          {/* Specific Documentation Needed */}
                          <div className="bg-green-50 p-3 rounded-lg border border-green-300 mb-3">
                            <p className="font-semibold text-xs text-green-900 mb-1">📝 Documentation to Add</p>
                            <p className="text-sm text-green-800">{measure.specific_documentation_needed}</p>
                          </div>

                          {/* Data Requirements */}
                          <div className="flex gap-2">
                            {measure.baseline_data_needed && (
                              <Badge className="bg-blue-600 text-white text-xs">
                                Baseline Data Required
                              </Badge>
                            )}
                            {measure.discharge_data_needed && (
                              <Badge className="bg-navy-600 text-white text-xs">
                                Discharge Data Required
                              </Badge>
                            )}
                          </div>

                          {/* Expected Improvement */}
                          {measure.expected_score_improvement && (
                            <div className="mt-3 bg-gradient-to-r from-green-50 to-emerald-50 p-2 rounded border border-green-300">
                              <p className="text-xs text-green-700 font-semibold">
                                📈 Expected Improvement: {measure.expected_score_improvement}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Documentation Inconsistencies */}
              <AccordionItem value="inconsistencies" className="border-2 border-orange-400 rounded-lg bg-orange-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-orange-600" />
                    <span className="font-semibold text-orange-900">
                      Documentation Inconsistencies ({inconsistencies.length})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {inconsistencies.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">No documentation inconsistencies found</p>
                    </div>
                  ) : (
                    <div className="max-h-[600px] overflow-y-auto pr-1">
                      <div className="space-y-4">
                        {inconsistencies.map((inconsistency, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-orange-300 p-4">
                            <div className="flex items-start justify-between mb-3">
                              <h4 className="font-semibold text-orange-900 flex-1">{inconsistency.inconsistency_title}</h4>
                              <Badge className={getSeverityColor(inconsistency.severity)}>
                                {inconsistency.severity}
                              </Badge>
                            </div>

                            {/* Data Points Involved */}
                            {inconsistency.data_points_involved?.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs text-slate-600 mb-1">Data Points Involved:</p>
                                <div className="flex flex-wrap gap-1">
                                  {inconsistency.data_points_involved.map((point, i) => (
                                    <Badge key={i} variant="outline" className="text-xs font-mono bg-white">
                                      {point}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            <p className="text-sm text-slate-800 mb-3">{inconsistency.description}</p>

                            {/* Plain Language Explanation */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <div className="flex items-center gap-2 mb-1">
                                <Info className="w-4 h-4 text-blue-600" />
                                <p className="font-semibold text-xs text-blue-900">What This Means</p>
                              </div>
                              <p className="text-sm text-blue-800">{inconsistency.plain_language_explanation}</p>
                            </div>

                            {/* Why It Matters */}
                            <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                              <p className="font-semibold text-xs text-yellow-900 mb-1">⚠️ Why It Matters</p>
                              <p className="text-sm text-yellow-800">{inconsistency.why_it_matters}</p>
                            </div>

                            {/* Impact Analysis */}
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {inconsistency.impact_on_revenue && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="text-xs text-green-700 font-semibold mb-1">💰 Revenue</p>
                                  <p className="text-xs text-green-800">{inconsistency.impact_on_revenue}</p>
                                </div>
                              )}
                              {inconsistency.impact_on_quality && (
                                <div className="bg-navy-50 p-2 rounded border border-navy-200">
                                  <p className="text-xs text-navy-700 font-semibold mb-1">⭐ Quality</p>
                                  <p className="text-xs text-navy-800">{inconsistency.impact_on_quality}</p>
                                </div>
                              )}
                              {inconsistency.impact_on_audit && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="text-xs text-red-700 font-semibold mb-1">🔍 Audit</p>
                                  <p className="text-xs text-red-800">{inconsistency.impact_on_audit}</p>
                                </div>
                              )}
                            </div>

                            {/* Likely Incorrect Value */}
                            {inconsistency.likely_incorrect_value && (
                              <div className="bg-red-50 p-2 rounded border border-red-300 mb-3">
                                <p className="text-xs text-red-700 font-semibold mb-1">❌ Likely Incorrect</p>
                                <p className="text-sm text-red-800">{inconsistency.likely_incorrect_value}</p>
                              </div>
                            )}

                            {/* How to Reconcile */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <p className="font-semibold text-xs text-blue-900 mb-1">🔧 How to Fix</p>
                              <p className="text-sm text-blue-800">{inconsistency.how_to_reconcile}</p>
                            </div>

                            {/* CMS Guidance */}
                            {inconsistency.cms_guidance && (
                              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300">
                                <div className="flex items-center gap-2 mb-2">
                                  <BookOpen className="w-4 h-4 text-indigo-600" />
                                  <p className="font-semibold text-xs text-indigo-900">CMS Guidance</p>
                                </div>
                                <p className="text-sm text-indigo-800 mb-2">{inconsistency.cms_guidance}</p>
                                <CmsGuidelineLink
                                  regulation={inconsistency.cms_guidance}
                                  aiLink={inconsistency.cms_guidance_link}
                                >
                                  View CMS Documentation Guidance
                                </CmsGuidelineLink>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Strengths */}
              {reviewResults.strengths?.length > 0 && (
                <AccordionItem value="strengths" className="border-2 border-green-400 rounded-lg bg-green-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="font-semibold text-green-900">
                        Documentation Strengths ({reviewResults.strengths.length})
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="bg-white p-4 rounded-lg border border-green-300">
                      <ul className="space-y-2">
                        {reviewResults.strengths.map((strength, idx) => (
                          <li key={idx} className="text-sm text-green-800 flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            {strength}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t flex-wrap">
              {canManageActionItems && analysisId && actionItemPayloads.length > 0 && (
                <Button
                  onClick={createActionItems}
                  disabled={isCreatingActions || actionItemsCreated}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  {actionItemsCreated ? (
                    <><CheckCircle2 className="w-4 h-4 mr-2" /> Action items created</>
                  ) : isCreatingActions ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating action items...</>
                  ) : (
                    <><ClipboardList className="w-4 h-4 mr-2" /> Create action items ({actionItemPayloads.length})</>
                  )}
                </Button>
              )}
              <Button
                onClick={() => performComprehensiveReview({ interactive: true })}
                variant="outline"
                disabled={ai.loading}
                className="flex-1"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Re-reviewing...</>
                ) : (
                  'Re-run Comprehensive Review'
                )}
              </Button>
              <Button
                onClick={() => {
                  setExpandedSections(allExpanded ? [] : allSections);
                }}
                variant="outline"
              >
                {allExpanded ? (
                  <><ChevronUp className="w-4 h-4 mr-2" /> Collapse All</>
                ) : (
                  <><ChevronDown className="w-4 h-4 mr-2" /> Expand All</>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}