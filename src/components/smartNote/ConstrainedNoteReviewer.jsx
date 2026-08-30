import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, HelpCircle, AlertTriangle, ShieldCheck, ShieldAlert, Loader2, Copy, CheckCircle2, Activity, BellRing, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { scanDraft } from "./compliance/draftScan";
import { checkAnswerAdequacy, findInadequateCritical, findInadequateCriticalEvidence } from "./compliance/answerAdequacy";
import { critiqueCoverage } from "./compliance/completenessCritic";
import { reconcileCritique } from "./compliance/criticReconcile";
import { computeGaps, computeCriticalGaps, computeCarryForward } from "./compliance/presenceDetection";
import { splitSentences } from "./compliance/factExtraction";
import { generateConstrainedNote, groundNote } from "./compliance/generation";
import { valueGuard } from "./compliance/valueGuard";
import { describePlaceholders } from "./compliance/placeholderGuard";
import { computeCoverageScore } from "./compliance/coverageScore";
import { compareVisits, buildTrendSummary, detectSustainedTrends } from "./compliance/visitComparison";
import { crossCheckChart } from "./compliance/chartCrossCheck";
import VisitComparisonPanel from "./VisitComparisonPanel";
import ChartCrossCheckPanel from "./ChartCrossCheckPanel";
import ClinicalIndicatorsPanel from "../visit/ClinicalIndicatorsPanel";
import NoteDiffView from "./NoteDiffView";
import DictationButton from "./DictationButton";
import { annotateProvenance } from "./compliance/provenance";
import { detectNoteCriticalVitals } from "./compliance/noteEscalation";
import { DENIAL_CLUSTER_LABELS } from "./compliance/reportingFields";
import { withTimeout } from "./compliance/withTimeout";
import { runDenialGuardrail, elementsJudgedByGuardrail } from "../compliance/denialGuardrailEngine";

/**
 * The canonical "constrained scribe" review flow, reusable across pages:
 * deterministic scan → questions (with pre-fill + confirm-only negatives) →
 * critical gating → constrained generation → value-guard + AI grounding →
 * verified note. The LLM only ever re-voices the nurse's own material, and a
 * note can't be marked verified unless every value traces back to that input.
 *
 * Props:
 *   roughNote      — the rough draft to convert
 *   serviceLine    — "home_health" | "hospice"
 *   visitType      — routine_visit | admission | recertification | discharge | prn
 *   vitals         — (optional) canonical structured vital_signs captured on the
 *                    form. Folded in deterministically so values entered there reach
 *                    the note + coverage even when not retyped into the draft.
 *   priorNote      — (optional) the patient's last note, for carry-forward pre-fill
 *   patient        — (optional) the full chart record, for the chart cross-check
 *   currentUser    — (optional) for the grounding call's rate-limit key
 *   onFinalNote    — (optional) called with the verified note text
 *   onBack         — (optional) renders a Back button next to Generate
 *   renderFinalNote — (optional) host render-prop for the final-note area. Receives
 *                     an `api` with { finalNote, setFinalNote, building, copy,
 *                     copied, verified, dirty, fixRequired, coverage, recheck,
 *                     result }. `recheck()` re-verifies and resolves to the
 *                     save-ready `result` (or null if it fails). When provided,
 *                     the reviewer renders the fact-check banner but defers the
 *                     note display + actions (e.g. Save-to-chart, PDF) to the host.
 */
// Stable default for an optional array prop. A literal `= []` default creates a
// NEW array every render, which would invalidate the `analysis` useMemo (it lists
// complianceRules in its deps) on every render → its reset effect re-runs →
// setState → infinite render loop for any caller that doesn't pass the prop.
const EMPTY_RULES = [];

// ── Denial-risk panel ───────────────────────────────────────────────────────
// Renders the deterministic denial-guardrail findings (the four recurring audit
// clusters behind most documentation-driven denials) in the same visual language
// as the compliance checklist: severity badges + expandable remediation/evidence.
// ADVISORY: findings never hard-block. When `ack` is provided (the save step) and
// a critical cluster fails, the nurse acknowledges before saving — the same
// override pattern as the chart safety conflicts.
// Cluster names come from reportingFields' DENIAL_CLUSTER_LABELS so the live
// panel and the persisted compliance issues/tags use identical wording.
const DENIAL_SEVERITY_BADGE = {
  critical: "bg-red-100 text-red-800",
  high: "bg-orange-100 text-orange-800",
  info: "bg-slate-100 text-slate-600",
};

function DenialRiskPanel({ guard, openClusters, onToggleCluster, ack = null }) {
  if (!guard || !guard.findings?.length) return null;
  const failed = guard.findings.filter((f) => f.status === "fail");
  const passedOrNA = guard.findings.filter((f) => f.status !== "fail");
  const blocking = failed.filter((f) => f.severity === "critical");
  const tone = blocking.length ? "red" : failed.length ? "orange" : "green";
  const frame = tone === "red" ? "border-red-300 bg-red-50" : tone === "orange" ? "border-orange-300 bg-orange-50" : "border-green-300 bg-green-50";
  const heading = tone === "red" ? "text-red-800" : tone === "orange" ? "text-orange-800" : "text-green-800";
  return (
    <div className={`rounded-xl border-2 p-4 space-y-2 ${frame}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className={`font-semibold flex items-center gap-2 ${heading}`}>
          {failed.length > 0 ? <ShieldAlert className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />} Denial Risk
        </h3>
        <Badge className={`${tone === "red" ? "bg-red-600" : tone === "orange" ? "bg-orange-500" : "bg-green-600"} text-white shrink-0`}>
          {guard.denial_risk_score}% risk
        </Badge>
      </div>
      {failed.length === 0 ? (
        <p className="text-sm text-green-800">No denial-risk documentation patterns detected — the audited clusters below all read as documented.</p>
      ) : (
        <p className={`text-xs ${tone === "red" ? "text-red-700" : "text-orange-700"}`}>
          These documentation patterns drive most Medicare denials. Advisory only — strengthen the language, or review and proceed.
        </p>
      )}
      {failed.length > 0 && (
        <div className="space-y-2">
          {failed.map((f) => {
            const open = openClusters.has(f.cluster);
            return (
              <div key={f.cluster} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                <button type="button" onClick={() => onToggleCluster(f.cluster)} className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-slate-50">
                  <Badge className={`shrink-0 text-xs ${DENIAL_SEVERITY_BADGE[f.severity] || DENIAL_SEVERITY_BADGE.info}`}>{f.severity}</Badge>
                  <span className="flex-1 min-w-0 text-sm text-slate-800">
                    <span className="font-semibold">{DENIAL_CLUSTER_LABELS[f.cluster] || f.cluster}:</span> {f.message}
                  </span>
                  <span className="text-xs text-slate-400 shrink-0">{open ? "Hide" : "Detail"}</span>
                </button>
                {open && (
                  <div className="px-3 pb-2.5 space-y-1 border-t border-slate-100">
                    {f.remediation && <p className="text-xs text-slate-600 mt-1.5"><span className="font-semibold">How to fix:</span> {f.remediation}</p>}
                    {f.evidence && <p className="text-xs text-slate-500 italic">Found: “{f.evidence}”</p>}
                    {f.cop_reference && <p className="text-[10px] text-slate-400">{f.cop_reference}</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {passedOrNA.length > 0 && (
        <ul className="space-y-0.5">
          {passedOrNA.map((f) => (
            <li key={f.cluster} className="flex items-start gap-1.5 text-xs text-slate-600">
              <CheckCircle2 className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${f.status === "pass" ? "text-green-600" : "text-slate-300"}`} />
              <span><span className="font-medium">{DENIAL_CLUSTER_LABELS[f.cluster] || f.cluster}:</span> {f.message}</span>
            </li>
          ))}
        </ul>
      )}
      {ack && blocking.length > 0 && (
        <>
          <label className="flex items-start gap-2 text-sm text-red-900 cursor-pointer pt-1">
            <input type="checkbox" checked={ack.acknowledged} onChange={(e) => ack.onAcknowledge(e.target.checked)} className="w-4 h-4 mt-0.5 text-red-600 rounded shrink-0" />
            <span>I have reviewed these denial risks and choose to save the note as documented.</span>
          </label>
          {ack.acknowledged && (
            <textarea
              value={ack.justification}
              onChange={(e) => ack.onJustification(e.target.value)}
              rows={2}
              placeholder="Optional: why the documentation stands as written (e.g. detail lives in the plan of care). Saved to the compliance record."
              className="w-full text-sm rounded-lg border border-red-300 bg-white p-2 text-red-900 placeholder:text-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
            />
          )}
        </>
      )}
    </div>
  );
}

export default function ConstrainedNoteReviewer({ roughNote, serviceLine = "home_health", visitType = "routine_visit", vitals = null, priorNote = "", patient = null, currentUser, onFinalNote, onBack, renderFinalNote, onEscalate, complianceRules = EMPTY_RULES }) {
  const [answers, setAnswers] = useState({});
  const [prefilledIds, setPrefilledIds] = useState(new Set());
  const [confirmedNegatives, setConfirmedNegatives] = useState(new Set());
  const [includeTrend, setIncludeTrend] = useState(false);
  const [acknowledgedRisks, setAcknowledgedRisks] = useState(false);
  const [ackJustification, setAckJustification] = useState("");
  // Denial-guardrail override trail (mirrors the chart-conflict ack above): a
  // blocking guardrail finding is acknowledged before save, never a hard block.
  const [acknowledgedDenialRisk, setAcknowledgedDenialRisk] = useState(false);
  const [denialAckJustification, setDenialAckJustification] = useState("");
  // Which denial-risk findings are expanded to show remediation/evidence.
  const [openDenialClusters, setOpenDenialClusters] = useState(() => new Set());
  const [finalNote, setFinalNote] = useState("");
  const [verifiedNote, setVerifiedNote] = useState("");
  const [fixRequired, setFixRequired] = useState(null);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  // "Show me the proof" toggle + which escalation groups have already been turned
  // into a provider follow-up task (so the button can't double-create).
  const [showProvenance, setShowProvenance] = useState(false);
  const [escalatedKeys, setEscalatedKeys] = useState(() => new Set());
  // LLM completeness-critic result ({ demotedIds, inadequate }) and run state.
  // Advisory only: it can add a question or a "be more specific" nudge, never
  // remove a required element or change critical gating. Stays null offline.
  const [critic, setCritic] = useState(null);
  const [criticRunning, setCriticRunning] = useState(false);
  // Per-element "see example" expander state in the questions list.
  const [openExamples, setOpenExamples] = useState(() => new Set());
  // Soft-confirm gate for brief/conclusory CRITICAL answers: a non-empty but
  // inadequate critical answer (e.g. "patient is homebound") doesn't hard-block —
  // it asks the nurse to confirm or add detail once before generating.
  const [showThinConfirm, setShowThinConfirm] = useState(false);
  const [confirmedThinCritical, setConfirmedThinCritical] = useState(false);

  // Deterministic, instant, offline scan — no LLM, no invented score. Shared with
  // the Step 1 readiness bar (compliance/draftScan.js) so the two screens can
  // never disagree about what the draft documents.
  const analysis = useMemo(
    () => scanDraft({ roughNote, serviceLine, visitType, vitals, complianceRules }),
    [roughNote, serviceLine, visitType, vitals, complianceRules],
  );

  // Critic-aware presence: the completeness critic can demote an element the
  // keyword scan over-counted as present (e.g. a negated "no fall assessment
  // done"). Flip those to absent so coverage, the "not documented" fallback, and
  // the saved audit all reflect the demotion — not just the rendered question
  // list. A null/empty critic (which includes EVERY offline run) returns the
  // deterministic presence unchanged, so offline scoring is identical to before.
  const effectivePresence = useMemo(() => {
    if (!analysis) return [];
    const demoted = critic?.demotedIds;
    if (!demoted || demoted.length === 0) return analysis.presence;
    const set = new Set(demoted);
    return analysis.presence.map((p) => (set.has(p.id) ? { ...p, present: false, evidence: null } : p));
  }, [analysis, critic]);

  // Unfilled template/quick-phrase scaffolding still in the draft ("due to
  // [diagnosis]", "BP _/_"). These are NOT documentation — presenceDetection
  // ignores them, so they surface as ordinary gaps — but they must also never be
  // handed to the scribe, which would faithfully re-voice the blank into the note
  // the nurse copies into the EMR. Generation is gated until they are resolved.
  const draftPlaceholders = analysis?.placeholders || [];
  // True total number of blanks. The list above is a capped, per-line DISPLAY
  // set, so counting its rows both conflates lines with blanks and saturates at
  // the cap — never render a count from it (see draftScan.js).
  const draftPlaceholderCount = analysis?.placeholderCount || 0;

  // Deterministic visit-over-visit comparison: what measured values changed since
  // the patient's last documented note. Pure + offline, derived from the same
  // extraction the value-guard uses, so the trend summary is itself value-grounded.
  const comparisons = useMemo(() => compareVisits(roughNote, priorNote), [roughNote, priorNote]);
  const trendSummary = useMemo(() => buildTrendSummary(comparisons), [comparisons]);

  // Multi-visit sustained trends from the patient's saved note history (already
  // on the chart record — no extra fetch). Oldest -> newest, current note last.
  const sustainedTrends = useMemo(() => {
    const history = Array.isArray(patient?.enhanced_notes_history) ? patient.enhanced_notes_history : [];
    const priorTexts = history.slice(-4).map((h) => h?.note || "").filter(Boolean);
    return detectSustainedTrends([...priorTexts, roughNote]);
  }, [patient, roughNote]);

  // Deterministic chart cross-check: how the note lines up against the standing
  // chart (allergies, med list, fall risk). Advisory only — never edits the note.
  // Once a final note exists it cross-checks the text the nurse will actually
  // SAVE (finalNote), not the rough draft, so editing out — or newly introducing
  // — a conflict is reflected in the save-time safety gate and the persisted
  // audit, rather than gating on (and persisting) a stale rough-draft conflict.
  const chartFindings = useMemo(() => crossCheckChart(finalNote || roughNote, patient), [finalNote, roughNote, patient]);

  // Deterministic critical-vital check on the note being written: a hypertensive
  // crisis / severe hypoxia / 10-of-10 pain documented this visit surfaces an
  // advisory provider-notification prompt. Never blocks saving.
  const criticalVitals = useMemo(() => detectNoteCriticalVitals(finalNote || roughNote), [finalNote, roughNote]);

  // Reset + pre-fill carry-forward answers whenever the SCAN changes. Keyed on
  // `analysis` only (not priorNote) and reads priorNote via a ref, so a late-
  // arriving prior note (async patient fetch) can't wipe answers the nurse has
  // already typed. Switching patient/visit re-mounts this component, which
  // re-prefills from the new patient.
  const priorNoteRef = useRef("");
  priorNoteRef.current = priorNote;
  useEffect(() => {
    setFinalNote(""); setVerifiedNote(""); setFixRequired(null); setIncludeTrend(false); setAcknowledgedRisks(false); setAckJustification(""); setAcknowledgedDenialRisk(false); setDenialAckJustification(""); setOpenDenialClusters(new Set()); setShowProvenance(false); setEscalatedKeys(new Set()); setCritic(null); setOpenExamples(new Set()); setShowThinConfirm(false); setConfirmedThinCritical(false);
    if (!analysis) { setAnswers({}); setPrefilledIds(new Set()); setConfirmedNegatives(new Set()); return; }
    const prefill = computeCarryForward(priorNoteRef.current || "", analysis.gaps);
    setAnswers(prefill);
    setPrefilledIds(new Set(Object.keys(prefill)));
    setConfirmedNegatives(new Set());
  }, [analysis]);

  // Run the LLM completeness critic ONCE per scan (not per keystroke).
  // It re-reads the draft to catch elements the keyword scan over-counted as
  // "documented" (e.g. a negated mention) and flags vague ones — surfaced as extra
  // questions / nudges. Best-effort: any failure leaves the deterministic result
  // untouched, so the flow always works offline.
  useEffect(() => {
    // Clear the running flag here too: if a prior run was cancelled (deps changed)
    // and the effect re-enters this early-return branch (analysis gone / offline),
    // the cancelled run's `finally` won't clear it — so without this the
    // "Double-checking…" spinner could stay stuck on.
    if (!analysis || typeof navigator !== "undefined" && !navigator.onLine) { setCritic(null); setCriticRunning(false); return; }
    let cancelled = false;
    setCriticRunning(true);
    (async () => {
      try {
        const res = await withTimeout(
          critiqueCoverage({ draftText: analysis.normalized, elements: analysis.required }, { userKey: currentUser?.email || "anon" }),
          20000,
          "Completeness check timed out.",
        );
        if (cancelled || !res?.ok) return;
        setCritic(reconcileCritique(res.elements, { requiredElements: analysis.required, presence: analysis.presence }));
      } catch {
        // Advisory only — keep the deterministic scan if the critic can't run.
      } finally {
        if (!cancelled) setCriticRunning(false);
      }
    })();
    return () => { cancelled = true; };
  }, [analysis, currentUser?.email]);

  const setAnswer = (id, value) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    setPrefilledIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
  };
  const toggleNegative = (id) => setConfirmedNegatives(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleDenialCluster = (cluster) => setOpenDenialClusters(prev => { const n = new Set(prev); n.has(cluster) ? n.delete(cluster) : n.add(cluster); return n; });
  // Dictated answers append to (rather than replace) what's there, and clear the
  // "carried from last visit" flag since the nurse just spoke a real answer.
  const appendAnswer = (id, text) => {
    setAnswers(prev => ({ ...prev, [id]: prev[id]?.trim() ? `${prev[id].trim()} ${text}` : text }));
    setPrefilledIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
  };
  // Hand a group of conflict/vital findings to the host to turn into provider
  // follow-up tasks. Guarded so a group can only be escalated once.
  const escalate = (key, items) => {
    if (!onEscalate || !items.length || escalatedKeys.has(key)) return;
    onEscalate(items);
    setEscalatedKeys(prev => new Set(prev).add(key));
  };

  const computeNotDocumented = useCallback(() => {
    if (!analysis) return [];
    // Derive from the critic-aware gaps so a blank demoted non-critical element
    // gets its honest "not documented" line (and is whitelisted into the allowed
    // input), matching how deterministic gaps are handled.
    return computeGaps(effectivePresence, analysis.required)
      .filter(e => e.severity !== "critical" && !answers[e.id]?.trim() && !confirmedNegatives.has(e.id))
      .map(e => e.notDocumentedPhrase);
  }, [analysis, effectivePresence, answers, confirmedNegatives]);
  // The trend summary, when the nurse opts in, is whitelisted as input: its
  // current values come from the draft and its prior values from the chart note,
  // so it is legitimate source material (not an LLM invention) and must pass the
  // value-guard / grounding rather than be flagged as unverified.
  const activeTrendSummary = useCallback(() => (includeTrend && trendSummary ? trendSummary : ""), [includeTrend, trendSummary]);
  const buildAllowedInput = useCallback(() => {
    if (!analysis) return "";
    const answerTexts = analysis.required.filter(e => answers[e.id]?.trim()).map(e => answers[e.id].trim());
    const negPhrases = analysis.required.filter(e => confirmedNegatives.has(e.id) && e.standardNegative).map(e => e.standardNegative.phrase);
    return [analysis.normalized, ...answerTexts, ...negPhrases, ...computeNotDocumented(), activeTrendSummary(), analysis.vitalsSentence].filter(Boolean).join(" ");
  }, [analysis, answers, confirmedNegatives, computeNotDocumented, activeTrendSummary]);

  // Deterministic denial-reason guardrail over the four clusters auditors deny
  // most (homebound quality, skilled-need specificity, F2F, necessity linkage).
  // F2F lives at referral intake (faceToFaceValidator) — the nurse's note is
  // NEVER scanned for it, so no f2fValidation is passed here and the engine
  // reports that cluster as informational only.
  const runGuardrail = useCallback((text) => runDenialGuardrail({
    noteText: text,
    serviceLine,
    visitType,
    context: { primaryDiagnosis: patient?.primary_diagnosis || "" },
  }), [serviceLine, visitType, patient?.primary_diagnosis]);

  // Live denial-risk read of the note being written: before generation it sees
  // the nurse's full material (draft + answers + confirmed negatives — the same
  // whitelist generation uses), so findings update as answers are typed; once a
  // final note exists it reads the exact text that will be SAVED.
  const denialGuardrail = useMemo(
    () => (analysis ? runGuardrail(finalNote || buildAllowedInput()) : null),
    [analysis, runGuardrail, finalNote, buildAllowedInput],
  );

  // Conclusory CRITICAL documentation, from either source: the nurse's typed
  // answer, or the draft itself when it satisfied the presence scan and so was
  // never turned into a question. Elements the denial guardrail already judges
  // (homebound, skilled need) are excluded here — it renders its own, stronger
  // verdict for those and gates the save on it, so surfacing the same text twice
  // would just be noise. Computed once and used by BOTH the generate() gate and
  // the rendered confirm panel so the two cannot diverge.
  const inadequateCritical = useMemo(() => {
    if (!analysis) return [];
    const typed = findInadequateCritical(analysis.required, answers);
    const fromDraft = findInadequateCriticalEvidence(analysis.required, effectivePresence, answers, {
      skipIds: elementsJudgedByGuardrail(denialGuardrail?.findings),
    });
    const seen = new Set(typed.map((t) => t.id));
    return [...typed, ...fromDraft.filter((f) => !seen.has(f.id))];
  }, [analysis, answers, effectivePresence, denialGuardrail]);

  // Save-ready snapshot the host (e.g. SmartNoteAssistant) persists to the chart.
  const computeResult = (text) => {
    if (!analysis) return null;
    const answeredIds = analysis.required.filter(e => answers[e.id]?.trim()).map(e => e.id);
    const confirmedNegativeIds = Array.from(confirmedNegatives);
    const coverageScore = computeCoverageScore({ requiredElements: analysis.required, presenceResults: effectivePresence, answeredIds, confirmedNegativeIds });
    // When the nurse saves over a critical chart conflict, capture the override
    // trail (which findings, the rationale, and that it was acknowledged) so the
    // host can stamp who/when and persist it to the compliance audit record.
    const critical = chartFindings.filter((f) => f.severity === "critical");
    const acknowledgment = critical.length
      ? { acknowledged: acknowledgedRisks, justification: ackJustification.trim(), finding_ids: critical.map((f) => f.id) }
      : null;
    // Denial-guardrail snapshot of the exact text being saved. ADVISORY: blocking
    // findings carry the same acknowledge-before-save override trail as chart
    // conflicts (namespaced ids, since guardrail findings are keyed by cluster).
    const guardrail = runGuardrail(text);
    const denialAcknowledgment = guardrail.blocking_findings.length
      ? { acknowledged: acknowledgedDenialRisk, justification: denialAckJustification.trim(), finding_ids: guardrail.blocking_findings.map((f) => `denial:${f.cluster}`) }
      : null;
    return { finalNote: text, coverageScore, draftScore: analysis.draftScore, presence: effectivePresence, required: analysis.required, answeredIds, confirmedNegativeIds, answers, chartFindings, sustainedTrends, comparisons, acknowledgment, denialGuardrail: guardrail, denialAcknowledgment, appliedRules: analysis.appliedRules || [] };
  };

  // `groundingText` is the subset of `text` worth grounding (default: all of it).
  // On a fresh generate we pass only the LLM-authored note so the deterministic
  // verbatim extras aren't re-classified; on a re-check after a manual edit we
  // ground the whole note (the nurse may have changed anything).
  const verifyNote = useCallback(async (text, groundingText = text) => {
    // A hand-edit can reintroduce a blank after generation; an unfilled
    // placeholder must never pass verification and reach the chart.
    const placeholders = describePlaceholders(text);
    if (placeholders.length) {
      return { ok: false, fix: { values: [], sentences: [], placeholders } };
    }
    const allowed = buildAllowedInput();
    const vg = valueGuard(text, allowed);
    if (!vg.ok) return { ok: false, fix: { values: vg.unverified, sentences: [] } };
    // Offline mode was removed, so grounding is no longer deferrable: a note that
    // could not be verified stays blocked until the nurse reconnects and
    // re-checks. Better an explicit block than a note finalized on an unrun check.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return { ok: false, fix: { values: [], sentences: [], groundingError: "You're offline. Reconnect and re-check to verify this note." } };
    }
    if (!groundingText.trim()) return { ok: true };
    let g;
    try {
      // Bound the grounding call so a hung request can't leave the note stuck
      // mid-verification — surface it as a re-checkable error instead.
      g = await withTimeout(groundNote(groundingText, allowed, { userKey: currentUser?.email || "anon" }), 30000, "Verification timed out — check your connection and re-check.");
    } catch (timeoutErr) {
      return { ok: false, fix: { values: [], sentences: [], groundingError: timeoutErr.message } };
    }
    if (!g.ok) return { ok: false, fix: { values: [], sentences: g.unsupported || [], groundingError: g.error } };
    return { ok: true };
  }, [buildAllowedInput, currentUser?.email]);

  const applyVerification = useCallback((text, v) => {
    if (!v.ok) { setVerifiedNote(""); setFixRequired(v.fix); return; }
    setVerifiedNote(text);
    setFixRequired(null);
    onFinalNote?.(text);
  }, [onFinalNote]);

  const generate = async () => {
    if (!analysis) return;
    // A blank left in the draft would be re-voiced verbatim into the chart note.
    // Hard gate, like the critical-element gate below: fix the draft first.
    if (draftPlaceholders.length) {
      toast.error("Fill in (or delete) the blanks left in your draft before generating.");
      return;
    }
    const { required } = analysis;
    // A confirmed standard negative COUNTS as answering a critical gap: the
    // confirm checkbox hides the answer box, and its phrase is real
    // documentation that goes into the note — so requiring a typed answer on
    // top would deadlock generation (reachable when an agency rule promotes an
    // element with a standardNegative, e.g. safety, to critical).
    const criticalUnanswered = computeCriticalGaps(effectivePresence, required).filter(e => !answers[e.id]?.trim() && !confirmedNegatives.has(e.id));
    if (criticalUnanswered.length) {
      toast.error(`Required before generating: ${criticalUnanswered.map(e => e.label).join(", ")}`);
      return;
    }
    // Soft gate: a critical answer that's present but conclusory (e.g. "patient is
    // homebound") surfaces a one-time confirm rather than a hard block — nudging
    // specificity without standing between the nurse and a genuine quick note.
    if (inadequateCritical.length && !confirmedThinCritical) {
      setShowThinConfirm(true);
      return;
    }
    setBuilding(true); setFixRequired(null);
    try {
      const draftSentences = splitSentences(analysis.normalized);
      const answersPayload = required.filter(e => answers[e.id]?.trim()).map(e => ({ label: e.label, text: answers[e.id].trim() }));
      const negPhrases = required.filter(e => confirmedNegatives.has(e.id) && e.standardNegative).map(e => e.standardNegative.phrase);
      let generated;
      try {
        const res = await withTimeout(
          generateConstrainedNote({ draftSentences, answers: answersPayload, confirmedNegatives: negPhrases }, { userKey: currentUser?.email || "anon", serviceLine, visitType }),
          45000,
          "Note generation timed out. Please try again.",
        );
        generated = res.note.trim();
      } catch (genErr) {
        const credits = genErr?.status === 402 || genErr?.data?.extra_data?.reason === "integration_credits_limit_reached";
        toast.error(credits ? "Monthly integration limit reached. Please upgrade your plan to continue." : (genErr?.message?.includes("timed out") ? genErr.message : "Note generation failed. Please try again."));
        setBuilding(false);
        return;
      }
      // Append the opted-in trend summary and any "not documented" fallbacks. The
      // trend summary is a deterministic, factual sentence (no LLM), so it is added
      // verbatim rather than risk the scribe re-voicing its paired values.
      const extras = [activeTrendSummary(), analysis.vitalsSentence, ...computeNotDocumented()].filter(Boolean);
      const finalText = extras.length ? `${generated}\n\n${extras.join(" ")}` : generated;
      setFinalNote(finalText);
      // Ground only the LLM-authored portion. The appended extras (trend summary,
      // structured vitals, "not documented" fallbacks) are deterministic and
      // already pass the value-guard, so re-grounding them only burns tokens.
      applyVerification(finalText, await verifyNote(finalText, generated));
    } catch (err) {
      console.error("ConstrainedNoteReviewer generate error:", err);
      toast.error("Something went wrong building the note.");
    } finally {
      setBuilding(false);
    }
  };

  // Re-verify the (possibly edited) note. Resolves to the save-ready result, or null.
  const recheck = async () => {
    if (!finalNote.trim()) return null;
    setBuilding(true);
    try {
      const v = await verifyNote(finalNote);
      applyVerification(finalNote, v);
      return v.ok ? computeResult(finalNote) : null;
    } finally {
      setBuilding(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(finalNote);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      toast.error("Couldn't copy to the clipboard. Select the note text and copy manually.");
    }
  };

  // derived
  // Gaps from the critic-aware presence: deterministic gaps plus any element the
  // critic demoted (over-counted as present). Additive only — the critic can't
  // remove a deterministic gap, since it only flips present→absent.
  const gaps = analysis ? computeGaps(effectivePresence, analysis.required) : [];
  // Critical documentation that is present but reads as conclusory — drives the
  // soft confirm. Covers both the typed-answer and the draft-evidence paths.
  const thinCritical = inadequateCritical;
  const answeredOrConfirmed = (id) => !!answers[id]?.trim() || confirmedNegatives.has(id);
  const answeredCount = gaps.filter(g => answeredOrConfirmed(g.id)).length;
  // Mirrors generate(): a confirmed standard negative satisfies a critical gap.
  const criticalUnanswered = analysis ? computeCriticalGaps(effectivePresence, analysis.required).filter(e => !answers[e.id]?.trim() && !confirmedNegatives.has(e.id)) : [];
  const documentedCount = analysis ? analysis.required.filter(e => { const p = effectivePresence.find(r => r.id === e.id); return (p && p.present) || answeredOrConfirmed(e.id); }).length : 0;
  const liveCoverage = analysis ? computeCoverageScore({ requiredElements: analysis.required, presenceResults: effectivePresence, answeredIds: analysis.required.filter(e => answers[e.id]?.trim()).map(e => e.id), confirmedNegativeIds: Array.from(confirmedNegatives) }) : 0;
  const tone = liveCoverage >= 90 ? "green" : liveCoverage >= 70 ? "orange" : "red";
  const dirty = !!finalNote && finalNote !== verifiedNote;
  // Routine negatives the nurse hasn't typed an answer for — surfaced as a single
  // bulk-confirm so a stable patient doesn't require a dozen individual taps.
  const negatableGaps = gaps.filter(g => g.standardNegative && !answers[g.id]?.trim());
  const hasUnconfirmedNegatives = negatableGaps.some(g => !confirmedNegatives.has(g.id));
  const confirmAllRoutineNegatives = () => setConfirmedNegatives(prev => {
    const n = new Set(prev);
    gaps.forEach(g => { if (g.standardNegative && !answers[g.id]?.trim()) n.add(g.id); });
    return n;
  });
  // Per-sentence provenance for the "show me the proof" panel (only computed when
  // the toggle is open). Reuses the value-guard's extraction so it matches what
  // gated verification.
  const provenanceRows = showProvenance && finalNote ? annotateProvenance(finalNote, buildAllowedInput()) : [];

  if (!analysis) {
    return <div className="text-sm text-slate-500 p-4 bg-slate-50 border border-slate-200 rounded-xl">Add a rough note (at least 20 characters) to check Medicare compliance and generate a fully factual note.</div>;
  }

  if (building) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-sm">
        <Loader2 className="w-10 h-10 text-indigo-500 mx-auto animate-spin mb-3" />
        <p className="font-semibold text-slate-800">Building your note…</p>
        <p className="text-sm text-slate-400 mt-1">Re-voicing your words and verifying every detail against what you wrote</p>
      </div>
    );
  }

  // Critical chart conflicts (e.g. a documented med the patient is allergic to)
  // must stay visible at the save step and be acknowledged before saving — not
  // just shown during drafting and then forgotten.
  const criticalChartFindings = chartFindings.filter((f) => f.severity === "critical");
  const hasUnacknowledgedCritical = criticalChartFindings.length > 0 && !acknowledgedRisks;

  // Blocking (critical, failing) denial-guardrail findings mirror the chart-risk
  // gate: advisory, but acknowledged before the host lets the note save.
  const blockingDenialFindings = denialGuardrail?.blocking_findings || [];

  const finalApi = {
    finalNote, setFinalNote, building, copy, copied,
    verified: !dirty && !fixRequired,
    dirty, fixRequired,
    coverage: liveCoverage,
    recheck,
    result: computeResult(finalNote),
    chartRisk: { findings: criticalChartFindings, hasUnacknowledgedCritical },
    denialRisk: {
      findings: blockingDenialFindings,
      score: denialGuardrail?.denial_risk_score ?? 0,
      hasUnacknowledgedCritical: blockingDenialFindings.length > 0 && !acknowledgedDenialRisk,
    },
  };

  return (
    <div className="space-y-4">
      {criticalVitals.length > 0 && (
        <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
          <h3 className="font-semibold text-red-800 flex items-center gap-2"><Activity className="w-4 h-4" /> Critical vital documented — consider provider notification</h3>
          <ul className="text-sm text-red-800 space-y-0.5">
            {criticalVitals.map((v) => (
              <li key={v.id}><span className="font-semibold">{v.label}:</span> {v.detail}</li>
            ))}
          </ul>
          <p className="text-xs text-red-600">Advisory only — you can still document and save a genuine reading.</p>
          {onEscalate && (
            <Button
              onClick={() => escalate("vitals", criticalVitals.map((v) => ({ title: `Notify provider: ${v.label}`, description: v.detail, reason: "Critical vital sign documented this visit." })))}
              disabled={escalatedKeys.has("vitals")}
              className="bg-red-600 hover:bg-red-700 h-9 gap-2 text-sm font-semibold disabled:opacity-60"
            >
              {escalatedKeys.has("vitals") ? <><CheckCircle2 className="w-4 h-4" /> Follow-up task created</> : <><BellRing className="w-4 h-4" /> Create provider follow-up task</>}
            </Button>
          )}
        </div>
      )}
      {!finalNote && (
        <>
          {/* Coverage meter (deterministic, reproducible) */}
          <div className={`rounded-xl border-2 p-4 ${tone === "green" ? "border-green-300 bg-green-50" : tone === "orange" ? "border-orange-300 bg-orange-50" : "border-red-300 bg-red-50"}`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-sm font-semibold text-slate-700">Compliance Coverage</p>
                <p className="text-xs text-slate-500 mt-0.5">{documentedCount} of {analysis.required.length} required elements documented</p>
              </div>
              <span className={`text-4xl font-bold ${tone === "green" ? "text-green-600" : tone === "orange" ? "text-orange-500" : "text-red-600"}`}>{liveCoverage}%</span>
            </div>
            <div className="h-2 bg-white rounded-full overflow-hidden">
              <div className={`h-full transition-all ${tone === "green" ? "bg-green-500" : tone === "orange" ? "bg-orange-400" : "bg-red-400"}`} style={{ width: `${liveCoverage}%` }} />
            </div>
          </div>

          {criticalUnanswered.length > 0 && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-300 rounded-xl px-4 py-3">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800"><strong>Required before generating:</strong> {criticalUnanswered.map(e => e.label).join(", ")}. Medicare can deny the visit without these.</p>
            </div>
          )}

          {draftPlaceholders.length > 0 && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
              <h3 className="font-semibold text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" /> Unfilled blanks in your draft
              </h3>
              <p className="text-sm text-red-800">
                Your draft still has <strong>{draftPlaceholderCount} unfilled blank{draftPlaceholderCount > 1 ? "s" : ""}</strong> left
                from a template. They are not counted as documentation, and the note can&apos;t be generated until you
                fill them in or delete them — otherwise the blank would be written into the note you paste into the EMR.
                Affected lines include:
              </p>
              <ul className="space-y-1">
                {draftPlaceholders.map((row) => (
                  <li key={row.line} className="text-xs text-red-900 bg-white border border-red-200 rounded-md px-2 py-1 leading-relaxed">
                    <span className="font-mono">{row.placeholders.join(" · ")}</span>
                    <span className="text-red-700"> — {row.line}</span>
                  </li>
                ))}
              </ul>
              {onBack && (
                <Button variant="outline" onClick={onBack} className="h-9 gap-2 text-sm font-semibold border-red-300 text-red-700 hover:bg-red-100">
                  ← Back to edit the draft
                </Button>
              )}
            </div>
          )}

          <DenialRiskPanel guard={denialGuardrail} openClusters={openDenialClusters} onToggleCluster={toggleDenialCluster} />

          <ChartCrossCheckPanel findings={chartFindings} />

          <ClinicalIndicatorsPanel narrativeText={roughNote} />

          {gaps.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2"><HelpCircle className="w-4 h-4 text-amber-500" /> Questions to Complete Your Note</h3>
                <span className="text-xs text-slate-500 shrink-0">{answeredCount}/{gaps.length} addressed</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">These required elements weren't in your draft. Answer what applies. Non-critical items left blank become an explicit "Not documented this visit." — never invented.</p>
              {criticRunning && (
                <p className="text-xs text-indigo-500 mb-2 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Double-checking your draft for completeness…</p>
              )}
              {!criticRunning && critic?.demotedIds?.length > 0 && (
                <p className="text-xs text-indigo-600 mb-2">The completeness check found {critic.demotedIds.length} element{critic.demotedIds.length > 1 ? "s" : ""} that read as mentioned but not actually documented — added below.</p>
              )}
              {hasUnconfirmedNegatives && (
                <button type="button" onClick={confirmAllRoutineNegatives}
                  className="mb-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 hover:bg-indigo-100 active:scale-95 transition">
                  <ListChecks className="w-3.5 h-3.5" /> Confirm all routine negatives (no acute changes)
                </button>
              )}
              {prefilledIds.size > 0 && (
                <p className="text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded-lg px-3 py-2 mb-3">Some answers were carried from this patient's last visit — confirm each still applies before generating.</p>
              )}
              <div className="space-y-3">
                {gaps.map(g => {
                  const negConfirmed = confirmedNegatives.has(g.id);
                  const demoted = critic?.demotedIds?.includes(g.id);
                  const criticNote = critic?.inadequate?.[g.id];
                  const examples = Array.isArray(g.examples) ? g.examples.filter(Boolean) : [];
                  const examplesOpen = openExamples.has(g.id);
                  const answerText = answers[g.id] || "";
                  const adq = answerText.trim() ? checkAnswerAdequacy(g.id, answerText) : { adequate: true };
                  return (
                    <div key={g.id} className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Badge className={`shrink-0 text-xs ${g.severity === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{g.severity === "critical" ? "required" : "optional"}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900">{g.question}</p>
                            <div className="flex items-center gap-1 shrink-0">
                              {demoted && <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full">AI: not fully documented</span>}
                              {prefilledIds.has(g.id) && <span className="text-[10px] font-semibold text-navy-700 bg-navy-100 px-1.5 py-0.5 rounded-full">from last visit · confirm</span>}
                            </div>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{g.copReference}</p>
                          {g.hint && <p className="text-xs text-slate-500 mt-1 leading-relaxed">{g.hint}</p>}
                          {examples.length > 0 && (
                            <div className="mt-1">
                              <button type="button" onClick={() => setOpenExamples(prev => { const n = new Set(prev); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n; })}
                                className="text-xs font-medium text-indigo-600 hover:text-indigo-800 underline-offset-2 hover:underline">
                                {examplesOpen ? "Hide example" : "See a compliant example"}
                              </button>
                              {examplesOpen && (
                                <ul className="mt-1 space-y-1">
                                  {examples.map((ex, i) => (
                                    <li key={i} className="text-xs text-slate-600 bg-white border border-slate-200 rounded-md px-2 py-1 leading-relaxed italic">“{ex}”</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      {g.standardNegative && (
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={negConfirmed} onChange={() => toggleNegative(g.id)} className="w-4 h-4 text-indigo-600 rounded" />
                          <span>Confirm: “{g.standardNegative.phrase}”</span>
                        </label>
                      )}
                      {!negConfirmed && (
                        <>
                          <div className="mt-2 flex items-start gap-2">
                            <textarea
                              value={answerText}
                              onChange={e => setAnswer(g.id, e.target.value)}
                              placeholder="Type or dictate your answer — written into the note in compliant language…"
                              className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none resize-none min-h-[56px] leading-relaxed"
                            />
                            <DictationButton onText={(t) => appendAnswer(g.id, t)} />
                          </div>
                          {!adq.adequate && (
                            <p className="mt-1.5 text-xs text-amber-700 bg-amber-100/70 border border-amber-200 rounded-md px-2 py-1 leading-relaxed">💡 {adq.tip}</p>
                          )}
                          {adq.adequate && criticNote?.reason && (
                            <p className="mt-1.5 text-xs text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-1 leading-relaxed">AI suggestion: {criticNote.reason}</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <VisitComparisonPanel
            comparisons={comparisons}
            trends={sustainedTrends}
            include={includeTrend}
            onToggleInclude={setIncludeTrend}
            summary={trendSummary}
          />

          {showThinConfirm && thinCritical.length > 0 && !confirmedThinCritical && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
              <h3 className="font-semibold text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> These required elements look brief</h3>
              <p className="text-sm text-amber-800">A vague entry on a required element is a common reason Medicare denies a visit. This covers what you typed here and what your draft already said. Add detail, or confirm it&apos;s complete as written:</p>
              <ul className="text-sm text-amber-900 list-disc ml-5 space-y-0.5">
                {thinCritical.map((t) => (<li key={t.id}><span className="font-semibold">{t.label}:</span> {t.tip}</li>))}
              </ul>
              <label className="flex items-start gap-2 text-sm text-amber-900 cursor-pointer pt-1">
                <input type="checkbox" checked={confirmedThinCritical} onChange={(e) => setConfirmedThinCritical(e.target.checked)} className="w-4 h-4 mt-0.5 text-amber-600 rounded shrink-0" />
                <span>These are complete as written — generate the note.</span>
              </label>
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={generate} disabled={criticalUnanswered.length > 0 || draftPlaceholders.length > 0} className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-12 font-semibold gap-2">
              <Sparkles className="w-4 h-4" /> Generate Final Note <ArrowRight className="w-4 h-4" />
            </Button>
            {onBack && <Button variant="outline" onClick={onBack} className="h-12 px-4">← Back</Button>}
          </div>
        </>
      )}

      {finalNote && (
        <>
          {fixRequired ? (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
              <h3 className="font-semibold text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fix required before finalizing</h3>
              {fixRequired.values?.length > 0 && <p className="text-sm text-red-800">Values not found in your input: <strong>{fixRequired.values.map(v => v.value).join(", ")}</strong></p>}
              {fixRequired.sentences?.length > 0 && (
                <div className="text-sm text-red-800">Sentences not supported by your input:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">{fixRequired.sentences.slice(0, 6).map((s, i) => <li key={i}>{s.text}</li>)}</ul>
                </div>
              )}
              {fixRequired.placeholders?.length > 0 && (
                <div className="text-sm text-red-800">Unfilled blanks are still in the note:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">
                    {fixRequired.placeholders.map((row) => (
                      <li key={row.line}><span className="font-mono">{row.placeholders.join(" · ")}</span> — {row.line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {fixRequired.groundingError && <p className="text-sm text-red-700">Verification error: {fixRequired.groundingError}</p>}
              <p className="text-xs text-red-600">Edit the note below to remove anything you didn't document, then re-check.</p>
              <Button onClick={recheck} className="bg-red-600 hover:bg-red-700 h-9 gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4" /> Re-check</Button>
            </div>
          ) : dirty ? (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 space-y-2">
              <h3 className="font-semibold text-amber-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Edited since verification</h3>
              <p className="text-sm text-amber-800">You changed the note after it was checked. Re-check to verify your edits against what you wrote.</p>
              <Button onClick={recheck} className="h-9 gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4" /> Re-check</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
              <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" /> Every value and statement in this note was verified against what you wrote. Copy it into your EMR.
            </div>
          )}

          {!fixRequired && (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowProvenance((s) => !s)}
                className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700">
                <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-green-600" /> Show verification detail</span>
                <span className="text-xs text-slate-400">{showProvenance ? "Hide" : "Show"}</span>
              </button>
              {showProvenance && (
                <div className="p-4 space-y-2">
                  <p className="text-xs text-slate-500">Each statement is checked against what you wrote. <span className="text-green-700 font-medium">Green</span> values trace to your input; <span className="text-red-700 font-medium">red</span> don't.</p>
                  {provenanceRows.map((row, i) => (
                    <div key={i} className={`text-sm rounded-lg border px-3 py-2 ${row.status === "unsupported" ? "border-red-200 bg-red-50" : row.status === "supported" ? "border-green-200 bg-green-50" : "border-slate-200 bg-slate-50"}`}>
                      <p className="text-slate-800">{row.text}.</p>
                      {row.tokens.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {row.tokens.map((t, j) => (
                            <span key={j} className={`text-xs font-mono px-1.5 py-0.5 rounded ${t.supported ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                              {t.supported ? "✓" : "⚠"} {t.value}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <DenialRiskPanel
            guard={denialGuardrail}
            openClusters={openDenialClusters}
            onToggleCluster={toggleDenialCluster}
            ack={{
              acknowledged: acknowledgedDenialRisk,
              onAcknowledge: setAcknowledgedDenialRisk,
              justification: denialAckJustification,
              onJustification: setDenialAckJustification,
            }}
          />

          {criticalChartFindings.length > 0 && (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
              <h3 className="font-semibold text-red-800 flex items-center gap-2"><ShieldAlert className="w-4 h-4" /> Chart safety conflict — review before saving</h3>
              {criticalChartFindings.map((f) => (
                <p key={f.id} className="text-sm text-red-800"><span className="font-semibold">{f.category}:</span> {f.message}</p>
              ))}
              <label className="flex items-start gap-2 text-sm text-red-900 cursor-pointer pt-1">
                <input type="checkbox" checked={acknowledgedRisks} onChange={(e) => setAcknowledgedRisks(e.target.checked)} className="w-4 h-4 mt-0.5 text-red-600 rounded shrink-0" />
                <span>I have reviewed this against the chart and confirm the documentation is correct.</span>
              </label>
              {acknowledgedRisks && (
                <textarea
                  value={ackJustification}
                  onChange={(e) => setAckJustification(e.target.value)}
                  rows={2}
                  placeholder="Optional: note your clinical rationale (e.g. confirmed new order with provider). Saved to the compliance record."
                  className="w-full text-sm rounded-lg border border-red-300 bg-white p-2 text-red-900 placeholder:text-red-400 focus:outline-none focus:ring-1 focus:ring-red-400"
                />
              )}
              {onEscalate && (
                <Button
                  onClick={() => escalate("chart", criticalChartFindings.map((f) => ({ title: `Provider follow-up: ${f.category} conflict`, description: f.message, reason: f.recommendation })))}
                  disabled={escalatedKeys.has("chart")}
                  variant="outline"
                  className="h-9 gap-2 text-sm font-semibold border-red-300 text-red-700 hover:bg-red-100 disabled:opacity-60"
                >
                  {escalatedKeys.has("chart") ? <><CheckCircle2 className="w-4 h-4" /> Follow-up task created</> : <><BellRing className="w-4 h-4" /> Create provider follow-up task</>}
                </Button>
              )}
            </div>
          )}

          {renderFinalNote ? (
            renderFinalNote(finalApi)
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                  <span className="text-sm font-semibold text-slate-700">Final Clinical Note</span>
                  <span className="text-xs text-slate-400">editable · {finalNote.length} chars</span>
                </div>
                <textarea value={finalNote} onChange={e => setFinalNote(e.target.value)} className="w-full min-h-[280px] font-mono text-sm border-0 px-4 py-3 focus:ring-0 bg-white resize-none outline-none" />
                <div className="flex gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
                  <Button onClick={copy} className="flex-1 h-11 gap-2 font-semibold">
                    {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
                  </Button>
                  <Button variant="outline" className="h-11 px-4" onClick={() => { setFinalNote(""); setVerifiedNote(""); setFixRequired(null); }}>Back</Button>
                </div>
              </div>
              <NoteDiffView originalNote={roughNote} enhancedNote={finalNote} />
            </>
          )}
        </>
      )}
    </div>
  );
}
