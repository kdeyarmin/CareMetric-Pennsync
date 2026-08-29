import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  MapPin,
  User,
  Calendar,
  XCircle,
  AlertCircle,
  TrendingUp,
  Brain,
  ShieldCheck,
  ShieldAlert,
  FileText
} from "lucide-react";
import { toast } from 'sonner';
import { referralToF2FInput, validateFaceToFace } from "./faceToFaceValidator.js";
import { classifyPayer } from "./visitPlanEstimator.js";
import DiagnosisCodeGenerator from "./DiagnosisCodeGenerator.jsx";
import VisitPlanCard from "./VisitPlanCard.jsx";
import MedicareEligibilityCard from "./MedicareEligibilityCard.jsx";

export default function ReferralAnalyzer({ referralData, onAnalysisComplete }) {
  const [analysis, setAnalysis] = useState(null);
  const ai = useAICall();
  const [analysisError, setAnalysisError] = useState(false);

  // Deterministic Face-to-Face (F2F) validation from the uploaded referral only
  // (42 CFR 424.22). Pure — never an AI/LLM call, and never surfaced in the
  // patient chart or Smart Note. Renders only when the referral carries an F2F.
  const f2fValidation = useMemo(() => {
    const input = referralToF2FInput(referralData);
    return input ? validateFaceToFace(input) : null;
  }, [referralData]);

  // Hold the completion callback in a ref so an inline (per-render) parent
  // callback doesn't change analyzeReferral's identity and re-fire the effect —
  // which otherwise produced an infinite loop of (billed) LLM calls.
  const onAnalysisCompleteRef = useRef(onAnalysisComplete);
  useEffect(() => {
    onAnalysisCompleteRef.current = onAnalysisComplete;
  }, [onAnalysisComplete]);

  // Monotonic run id: a new referral (or retry) supersedes any in-flight call,
  // so a slower earlier response can never display — or report via
  // onAnalysisComplete — the PREVIOUS referral's urgency/risk analysis as if it
  // belonged to the current one.
  const runIdRef = useRef(0);
  // The referralData object currently being analyzed. StrictMode's double-run
  // of the mount effect (and any future duplicate trigger) would otherwise fire
  // two identical billed LLM calls for the same referral.
  const inFlightDataRef = useRef(null);

  const analyzeReferral = useCallback(async () => {
    if (!referralData) return;
    if (inFlightDataRef.current === referralData) return; // identical call already in flight
    inFlightDataRef.current = referralData;

    const runId = (runIdRef.current += 1);
    // Clear any prior referral's analysis immediately: the loading card must
    // show while this referral is analyzed, never stale results for the old one.
    setAnalysis(null);
    setAnalysisError(false);

    // Deterministic F2F validation is authoritative — hand it to the model so
    // the AI's missing-information analysis can't contradict it (e.g. flagging
    // a face-to-face encounter as missing when the referral carries a valid one).
    const f2fInput = referralToF2FInput(referralData);
    const f2f = f2fInput ? validateFaceToFace(f2fInput) : null;
    // A referral with NO F2F block is itself a critical finding (condition of
    // payment) — tell the model so, instead of leaving it to chance.
    // The strength of the no-F2F directive depends on the payer: an F2F
    // encounter is a federal condition of payment for Medicare (42 CFR
    // 424.22) AND Medicaid home health (42 CFR 440.70(f)(1)); commercial /
    // unidentified payers get plan-verification language instead so a
    // Medicare-only framing isn't forced onto every payer.
    const payer = classifyPayer(referralData).payer;
    const f2fRequired = ["medicare_ffs", "medicare_advantage", "medicaid"].includes(payer);
    const f2fContext = f2f
      ? `\n\nDETERMINISTIC PRE-CHECK (system-validated, do not contradict it): Face-to-Face encounter validation per 42 CFR 424.22 — status: ${f2f.status}. ${f2f.reasons.join(" ")}${
          f2f.status === "valid" ? " Do NOT list the face-to-face encounter as missing information." : ""
        }`
      : f2fRequired
      ? `\n\nDETERMINISTIC PRE-CHECK (system-validated, do not contradict it): No Face-to-Face encounter is documented in this referral. An F2F encounter within 90 days before or 30 days after the start of care is a federal condition of payment for this payer (Medicare: 42 CFR 424.22; Medicaid home health: 42 CFR 440.70(f)) — include the Face-to-Face encounter documentation in critical_missing.`
      : `\n\nDETERMINISTIC PRE-CHECK (system-validated, do not contradict it): No Face-to-Face encounter is documented in this referral. This payer is not identified as Medicare or Medicaid, so the federal F2F condition of payment does not directly apply — list the Face-to-Face encounter under recommended_missing with a note to verify this plan's own documentation requirements (many plans mirror Medicare's F2F rule).`;

    try {
      const result = await ai.run({
        model: "automatic",
        prompt: `You are an expert home health intake coordinator. Analyze this patient referral and provide:

NON-NEGOTIABLE GROUNDING RULES:
- Base EVERY statement only on the Referral Data below (plus the deterministic pre-check). Never invent demographics, diagnoses, codes, medications, dates, findings, or history.
- Information that is absent is MISSING — report it in missing_information instead of assuming a typical value. Before listing a field as missing, confirm it is actually absent from the Referral Data.
- Risk flags, urgency factors, and the patient summary may only reference documented findings — no textbook-typical risks the referral doesn't support.
- Visit estimates are planning estimates: when the referral documents too little for a discipline, omit that estimate rather than guessing, and set confidence accordingly.

1. MISSING INFORMATION ANALYSIS:
   - Identify all required fields that are missing or incomplete
   - Flag critical missing information (e.g., physician orders, diagnosis, contact info)
   - List nice-to-have information that would improve care planning

2. URGENCY SCORING (0-100 scale):
   - Clinical urgency based on diagnosis, recent hospitalization, symptoms
   - Administrative urgency based on requested start date, insurance requirements
   - Overall urgency score and priority level (STAT/High/Medium/Low)
   - Reasoning for the urgency rating

3. SCHEDULING RECOMMENDATIONS:
   - Ideal timeframe for first visit (e.g., within 24 hours, within 3 days)
   - Suggested visit frequency based on diagnosis and orders
   - Special scheduling considerations (e.g., needs wound care specialist, interpreter needed)
   - Estimated visit duration for first assessment

4. RISK FLAGS:
   - Clinical risks (fall risk, cognitive impairment, multiple comorbidities)
   - Social risks (lives alone, no caregiver support, language barrier)
   - Safety concerns (home environment, compliance issues)

5. NURSE SKILL REQUIREMENTS:
   - Required certifications or specializations
   - Experience level needed
   - Special skills (e.g., PICC line care, ventilator management)

6. PATIENT SUMMARY:
   - A concise clinical snapshot (3-5 sentences) an intake nurse could read in report: who the patient is, why they were referred, key active conditions, functional status, and home support
   - Key active conditions as a short list

7. VISIT UTILIZATION ESTIMATE (planning-grade — a clinician confirms at SOC):
   - If the referral ORDERS explicit visit frequencies, restate them exactly in suggested_frequency (ordered frequencies are authoritative — never change them)
   - Otherwise estimate: skilled nursing visits for days 1-30 and days 31-60, and PT/OT/ST/MSW/aide visits for the 60-day episode, based on diagnosis acuity, wound care burden, medication teaching needs, and rehab potential
   - Give a week-by-week frequency in standard home-health notation (e.g. "SN 3w2, 2w2, 1w5; PT 2w4") with the clinical rationale
   - Set confidence (high/medium/low) honestly from how much the referral actually documents

Referral Data: ${JSON.stringify(referralData)}${f2fContext}`,
        response_json_schema: {
          type: "object",
          properties: {
            missing_information: {
              type: "object",
              properties: {
                critical_missing: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field_name: { type: "string" },
                      why_critical: { type: "string" },
                      how_to_obtain: { type: "string" }
                    }
                  }
                },
                recommended_missing: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      field_name: { type: "string" },
                      why_helpful: { type: "string" }
                    }
                  }
                },
                data_completeness_score: { type: "number" }
              }
            },
            urgency_analysis: {
              type: "object",
              properties: {
                clinical_urgency_score: { type: "number" },
                administrative_urgency_score: { type: "number" },
                overall_urgency_score: { type: "number" },
                priority_level: { type: "string", enum: ["STAT", "High", "Medium", "Low"] },
                urgency_factors: { type: "array", items: { type: "string" } },
                reasoning: { type: "string" }
              }
            },
            scheduling_recommendations: {
              type: "object",
              properties: {
                ideal_first_visit_timeframe: { type: "string" },
                recommended_visit_frequency: { type: "string" },
                estimated_visit_duration_minutes: { type: "number" },
                preferred_time_of_day: { type: "string" },
                special_considerations: { type: "array", items: { type: "string" } },
                location_notes: { type: "string" }
              }
            },
            risk_flags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_type: { type: "string" },
                  severity: { type: "string", enum: ["High", "Medium", "Low"] },
                  description: { type: "string" },
                  mitigation_strategy: { type: "string" }
                }
              }
            },
            nurse_requirements: {
              type: "object",
              properties: {
                required_certifications: { type: "array", items: { type: "string" } },
                experience_level: { type: "string", enum: ["Entry", "Intermediate", "Advanced", "Expert"] },
                special_skills: { type: "array", items: { type: "string" } },
                language_requirements: { type: "array", items: { type: "string" } }
              }
            },
            patient_summary: {
              type: "object",
              properties: {
                narrative: { type: "string" },
                key_conditions: { type: "array", items: { type: "string" } },
                functional_snapshot: { type: "string" },
                support_and_home: { type: "string" }
              }
            },
            visit_estimates: {
              type: "object",
              properties: {
                nursing_visits_first_30_days: { type: "number" },
                nursing_visits_days_31_60: { type: "number" },
                pt_visits: { type: "number" },
                ot_visits: { type: "number" },
                st_visits: { type: "number" },
                msw_visits: { type: "number" },
                aide_visits: { type: "number" },
                suggested_frequency: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] }
              }
            }
          }
        }
      });

      if (runId !== runIdRef.current) return; // superseded by a newer referral
      setAnalysis(result);
      if (onAnalysisCompleteRef.current) {
        onAnalysisCompleteRef.current(result);
      }
    } catch (error) {
      if (runId !== runIdRef.current) return; // superseded by a newer referral
      console.error('Error analyzing referral:', error);
      setAnalysisError(true);
      toast.error('Failed to analyze referral. Please try again.');
    } finally {
      // Only the run that still owns the in-flight marker may clear it — a
      // superseded run must not erase the newer run's dedupe marker.
      if (runId === runIdRef.current) inFlightDataRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [referralData]);

  useEffect(() => {
    if (referralData) {
      analyzeReferral();
    }
  }, [referralData, analyzeReferral]);

  // Face-to-Face (F2F) validation — deterministic and referral-only, so like
  // the diagnosis-code generator it renders in EVERY state (loading, failed,
  // loaded): an AI outage must never hide a 42 CFR 424.22 compliance result.
  // A referral with NO F2F documented at all gets an explicit warning — a
  // missing condition-of-payment document must never be silently absent. The
  // wording is payer-aware: the federal F2F requirement binds Medicare
  // (42 CFR 424.22) and Medicaid home health (42 CFR 440.70(f)); other payers
  // get verify-the-plan language.
  const payerClass = classifyPayer(referralData).payer;
  const f2fFederallyRequired = ["medicare_ffs", "medicare_advantage", "medicaid"].includes(payerClass);
  const f2fAlert = !f2fValidation ? (
    <Alert className="border-2 bg-yellow-50 border-yellow-300">
      <ShieldAlert className="w-5 h-5 text-yellow-600" />
      <AlertDescription>
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold">
            Face-to-Face Encounter: <Badge className="bg-yellow-600">Not documented</Badge>
          </p>
          <span className="text-xs text-slate-600">42 CFR 424.22</span>
        </div>
        <p className="text-sm">
          No Face-to-Face encounter is documented in this referral.{" "}
          {f2fFederallyRequired
            ? "An encounter by the certifying physician/allowed practitioner within 90 days before or 30 days after the start of care is a federal condition of payment for this payer (Medicare: 42 CFR 424.22; Medicaid home health: 42 CFR 440.70(f)) — request the F2F note from the referring provider before admission."
            : "This payer is not identified as Medicare or Medicaid, so the federal F2F condition of payment does not directly apply — verify this plan's own documentation requirements (many plans mirror Medicare's F2F rule) and request the note if required."}
        </p>
      </AlertDescription>
    </Alert>
  ) : (
    <Alert
      className={`border-2 ${
        f2fValidation.status === "valid"
          ? "bg-green-50 border-green-300"
          : f2fValidation.status === "invalid"
          ? "bg-red-50 border-red-300"
          : "bg-yellow-50 border-yellow-300"
      }`}
    >
      {f2fValidation.status === "valid" ? (
        <ShieldCheck className="w-5 h-5 text-green-600" />
      ) : (
        <ShieldAlert
          className={`w-5 h-5 ${f2fValidation.status === "invalid" ? "text-red-600" : "text-yellow-600"}`}
        />
      )}
      <AlertDescription>
        <div className="flex items-center justify-between mb-1">
          <p className="font-semibold">
            Face-to-Face Encounter:{" "}
            <Badge
              className={
                f2fValidation.status === "valid"
                  ? "bg-green-600"
                  : f2fValidation.status === "invalid"
                  ? "bg-red-600"
                  : "bg-yellow-600"
              }
            >
              {f2fValidation.status === "valid"
                ? "Compliant"
                : f2fValidation.status === "invalid"
                ? "Non-compliant"
                : "Needs review"}
            </Badge>
          </p>
          <span className="text-xs text-slate-600">42 CFR 424.22</span>
        </div>
        <ul className="text-sm list-disc pl-5 space-y-0.5">
          {f2fValidation.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );

  // Deterministic panels (no LLM) — like the diagnosis-code generator they
  // render in EVERY state: an AI outage must never hide the Medicare-criteria
  // snapshot or the ordered visit plan. AI visit estimates slot in once (and
  // only if) the analysis lands.
  const deterministicPanels = (
    <>
      <MedicareEligibilityCard referralData={referralData} f2fValidation={f2fValidation} />
      <VisitPlanCard referralData={referralData} aiEstimates={analysis?.visit_estimates} />
    </>
  );

  if (!analysis) {
    // The diagnosis-code generator is deterministic (no LLM), so it renders
    // immediately — even while the AI analysis is still running or has failed.
    if (analysisError) {
      return (
        <div className="space-y-4">
          <DiagnosisCodeGenerator referralData={referralData} />
          {f2fAlert}
          {deterministicPanels}
          <Card className="border-2 border-red-300">
            <CardContent className="p-8 text-center">
              <XCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
              <p className="text-slate-700 mb-4">Couldn't analyze this referral.</p>
              <Button type="button" onClick={analyzeReferral}>
                Retry analysis
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <DiagnosisCodeGenerator referralData={referralData} />
        {f2fAlert}
        {deterministicPanels}
        <Card className="border-2 border-blue-300">
          <CardContent className="p-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-slate-600">Analyzing referral with AI...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getPriorityColor = (level) => {
    switch (level) {
      case "STAT": return "bg-red-600 text-white";
      case "High": return "bg-orange-500 text-white";
      case "Medium": return "bg-yellow-500 text-white";
      case "Low": return "bg-green-500 text-white";
      default: return "bg-slate-500 text-white";
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case "High": return "border-red-500 bg-red-50";
      case "Medium": return "border-yellow-500 bg-yellow-50";
      case "Low": return "border-blue-500 bg-blue-50";
      default: return "border-slate-500 bg-slate-50";
    }
  };

  return (
    <div className="space-y-4">
      {/* Patient Summary — the AI's report-ready snapshot of who this patient is */}
      {analysis.patient_summary?.narrative && (
        <Card className="border-2 border-blue-300">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="w-5 h-5 text-blue-600" />
              Patient Summary
              <Badge variant="outline" className="text-[10px]">AI-generated — verify against source</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-900">{analysis.patient_summary.narrative}</p>
            {analysis.patient_summary?.key_conditions?.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {analysis.patient_summary.key_conditions.map((c, idx) => (
                  <Badge key={idx} className="bg-blue-100 text-blue-800">{c}</Badge>
                ))}
              </div>
            )}
            <div className="grid md:grid-cols-2 gap-2">
              {analysis.patient_summary?.functional_snapshot && (
                <div className="bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                  <p className="font-semibold text-slate-900">Functional status</p>
                  <p className="text-slate-700">{analysis.patient_summary.functional_snapshot}</p>
                </div>
              )}
              {analysis.patient_summary?.support_and_home && (
                <div className="bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                  <p className="font-semibold text-slate-900">Home & support</p>
                  <p className="text-slate-700">{analysis.patient_summary.support_and_home}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Diagnosis codes found in the referral, sequenced per the PDGM model —
          deterministic, never AI-generated */}
      <DiagnosisCodeGenerator referralData={referralData} />

      {/* Urgency Header — only when the model actually returned an urgency
          analysis, so a partial response can't render "Priority: undefined" */}
      {analysis.urgency_analysis && (
        <Alert className={`border-2 ${analysis.urgency_analysis?.priority_level === 'STAT' || analysis.urgency_analysis?.priority_level === 'High' ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}>
          <TrendingUp className="w-5 h-5" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-lg mb-1">
                  Referral Priority: <Badge className={getPriorityColor(analysis.urgency_analysis?.priority_level)}>
                    {analysis.urgency_analysis?.priority_level}
                  </Badge>
                </p>
                <p className="text-sm">Urgency Score: {analysis.urgency_analysis?.overall_urgency_score}/100</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-600">Clinical: {analysis.urgency_analysis?.clinical_urgency_score}</p>
                <p className="text-xs text-slate-600">Administrative: {analysis.urgency_analysis?.administrative_urgency_score}</p>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Face-to-Face (F2F) validation — deterministic, referral-only */}
      {f2fAlert}

      {/* Medicare criteria snapshot + payer-aware visit plan — deterministic */}
      {deterministicPanels}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Missing Information */}
        <Card className="border-2 border-orange-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-orange-600" />
              Missing Information
              <Badge variant="outline" className="text-[10px]">AI-checked — confirm against document</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium">Data Completeness</p>
              <Badge className="bg-blue-600">{analysis.missing_information?.data_completeness_score}%</Badge>
            </div>

            {analysis.missing_information?.critical_missing?.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-red-900 flex items-center gap-1">
                  <XCircle className="w-4 h-4" /> Critical Missing ({analysis.missing_information?.critical_missing.length})
                </p>
                {analysis.missing_information?.critical_missing.map((item, idx) => (
                  <div key={idx} className="bg-red-50 p-2 rounded border border-red-200 text-xs">
                    <p className="font-semibold text-red-900">{item.field_name}</p>
                    <p className="text-slate-700">{item.why_critical}</p>
                    <p className="text-slate-600 mt-1"><strong>How to obtain:</strong> {item.how_to_obtain}</p>
                  </div>
                ))}
              </div>
            )}

            {analysis.missing_information?.recommended_missing?.length > 0 && (
              <div className="space-y-2 mt-3">
                <p className="text-xs font-semibold text-yellow-900 flex items-center gap-1">
                  <AlertCircle className="w-4 h-4" /> Recommended ({analysis.missing_information?.recommended_missing.length})
                </p>
                {analysis.missing_information?.recommended_missing.map((item, idx) => (
                  <div key={idx} className="bg-yellow-50 p-2 rounded border border-yellow-200 text-xs">
                    <p className="font-semibold text-yellow-900">{item.field_name}</p>
                    <p className="text-slate-700">{item.why_helpful}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Scheduling Recommendations */}
        <Card className="border-2 border-green-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="w-5 h-5 text-green-600" />
              Scheduling Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="bg-green-50 p-3 rounded border border-green-200">
              <p className="text-xs font-semibold text-green-900 mb-2">⏰ First Visit Timeframe</p>
              <p className="text-sm font-bold text-slate-900">{analysis.scheduling_recommendations?.ideal_first_visit_timeframe}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-blue-50 p-2 rounded border border-blue-200">
                <p className="font-semibold text-blue-900">Frequency</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.recommended_visit_frequency}</p>
              </div>
              <div className="bg-navy-50 p-2 rounded border border-navy-200">
                <p className="font-semibold text-navy-900">Duration</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.estimated_visit_duration_minutes} min</p>
              </div>
            </div>

            {analysis.scheduling_recommendations?.preferred_time_of_day && (
              <div className="bg-indigo-50 p-2 rounded border border-indigo-200 text-xs">
                <p className="font-semibold text-indigo-900">Preferred Time</p>
                <p className="text-slate-900">{analysis.scheduling_recommendations?.preferred_time_of_day}</p>
              </div>
            )}

            {analysis.scheduling_recommendations?.location_notes && (
              <div className="bg-slate-50 p-2 rounded border border-slate-200 text-xs">
                <p className="font-semibold text-slate-900 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Location Notes
                </p>
                <p className="text-slate-700">{analysis.scheduling_recommendations?.location_notes}</p>
              </div>
            )}

            {analysis.scheduling_recommendations?.special_considerations?.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-slate-900">Special Considerations:</p>
                {analysis.scheduling_recommendations?.special_considerations.map((item, idx) => (
                  <p key={idx} className="text-xs text-slate-700">• {item}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Risk Flags */}
      {analysis.risk_flags?.length > 0 && (
        <Card className="border-2 border-red-300">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Risk Flags ({analysis.risk_flags?.length})
              <Badge variant="outline" className="text-[10px]">AI-identified from referral</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-3">
              {analysis.risk_flags?.map((risk, idx) => (
                <div key={idx} className={`p-3 rounded-lg border-2 ${getSeverityColor(risk.severity)}`}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="font-semibold text-sm">{risk.risk_type}</p>
                    <Badge className={`${risk.severity === 'High' ? 'bg-red-600' : risk.severity === 'Medium' ? 'bg-yellow-600' : 'bg-blue-600'}`}>
                      {risk.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-700 mb-2">{risk.description}</p>
                  <div className="bg-white p-2 rounded border text-xs">
                    <p className="font-semibold text-slate-900">Mitigation:</p>
                    <p className="text-slate-700">{risk.mitigation_strategy}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Nurse Requirements */}
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <User className="w-5 h-5 text-navy-600" />
            Nurse Requirements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Experience Level Required:</p>
              <Badge className="bg-navy-600 text-white">{analysis.nurse_requirements?.experience_level}</Badge>
            </div>

            {analysis.nurse_requirements?.required_certifications?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Required Certifications:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.required_certifications.map((cert, idx) => (
                    <Badge key={idx} variant="outline">{cert}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.nurse_requirements?.special_skills?.length > 0 && (
              <div className="md:col-span-2">
                <p className="text-sm font-semibold text-slate-900 mb-2">Special Skills:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.special_skills.map((skill, idx) => (
                    <Badge key={idx} className="bg-blue-100 text-blue-800">{skill}</Badge>
                  ))}
                </div>
              </div>
            )}

            {analysis.nurse_requirements?.language_requirements?.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-slate-900 mb-2">Language Requirements:</p>
                <div className="flex flex-wrap gap-1">
                  {analysis.nurse_requirements?.language_requirements.map((lang, idx) => (
                    <Badge key={idx} className="bg-green-100 text-green-800">{lang}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Urgency Reasoning */}
      {analysis.urgency_analysis && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-5 h-5 text-blue-600" />
            AI Urgency Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="bg-blue-50 p-3 rounded border border-blue-200">
            <p className="text-sm text-slate-900">{analysis.urgency_analysis?.reasoning}</p>
          </div>

          {analysis.urgency_analysis?.urgency_factors?.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-900 mb-2">Key Urgency Factors:</p>
              <ul className="space-y-1">
                {analysis.urgency_analysis?.urgency_factors.map((factor, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">•</span>
                    <span>{factor}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}