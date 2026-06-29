import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, ArrowRight, HelpCircle, AlertTriangle, ShieldCheck, ShieldAlert, Loader2, Copy, CheckCircle2, Activity, BellRing, ListChecks } from "lucide-react";
import { toast } from "sonner";
import { normalizeDraft } from "./compliance/normalize";
import { getRequiredElements } from "./compliance/requiredElements";
import { detectPresence, computeGaps, computeCriticalGaps, computeCarryForward } from "./compliance/presenceDetection";
import { splitSentences, formatVitalsSentence } from "./compliance/factExtraction";
import { generateConstrainedNote, groundNote } from "./compliance/generation";
import { valueGuard } from "./compliance/valueGuard";
import { computeCoverageScore, computeDraftPresenceScore } from "./compliance/coverageScore";
import { compareVisits, buildTrendSummary, detectSustainedTrends } from "./compliance/visitComparison";
import { crossCheckChart } from "./compliance/chartCrossCheck";
import VisitComparisonPanel from "./VisitComparisonPanel";
import ChartCrossCheckPanel from "./ChartCrossCheckPanel";
import NoteDiffView from "./NoteDiffView";
import DictationButton from "./DictationButton";
import { annotateProvenance } from "./compliance/provenance";
import { detectNoteCriticalVitals } from "./compliance/noteEscalation";
import { withTimeout } from "./compliance/withTimeout";

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
export default function ConstrainedNoteReviewer({ roughNote, serviceLine = "home_health", visitType = "routine_visit", vitals = null, priorNote = "", patient = null, currentUser, onFinalNote, onBack, renderFinalNote, onEscalate }) {
  const [answers, setAnswers] = useState({});
  const [prefilledIds, setPrefilledIds] = useState(new Set());
  const [confirmedNegatives, setConfirmedNegatives] = useState(new Set());
  const [includeTrend, setIncludeTrend] = useState(false);
  const [acknowledgedRisks, setAcknowledgedRisks] = useState(false);
  const [ackJustification, setAckJustification] = useState("");
  const [finalNote, setFinalNote] = useState("");
  const [verifiedNote, setVerifiedNote] = useState("");
  const [fixRequired, setFixRequired] = useState(null);
  const [building, setBuilding] = useState(false);
  const [copied, setCopied] = useState(false);
  // "Show me the proof" toggle + which escalation groups have already been turned
  // into a provider follow-up task (so the button can't double-create).
  const [showProvenance, setShowProvenance] = useState(false);
  const [escalatedKeys, setEscalatedKeys] = useState(() => new Set());

  // Deterministic, instant, offline scan — no LLM, no invented score.
  const analysis = useMemo(() => {
    if (!roughNote || roughNote.trim().length < 20) return null;
    const normalized = normalizeDraft(roughNote);
    const vitalsSentence = formatVitalsSentence(vitals);
    const required = getRequiredElements(serviceLine, visitType);
    // Presence/coverage must see structured vitals captured on the form, even
    // when the nurse didn't retype them into the draft — otherwise vitals are
    // falsely scored as "not documented this visit". The draft sentences fed to
    // the scribe stay roughNote-only (vitals are appended verbatim, never
    // re-voiced), so this only affects gap detection and the coverage score.
    const presenceText = vitalsSentence ? normalizeDraft(`${roughNote} ${vitalsSentence}`) : normalized;
    const presence = detectPresence(presenceText, required);
    const gaps = computeGaps(presence, required);
    const draftScore = computeDraftPresenceScore({ requiredElements: required, presenceResults: presence });
    return { normalized, vitalsSentence, required, presence, gaps, draftScore };
  }, [roughNote, serviceLine, visitType, vitals]);

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
    setFinalNote(""); setVerifiedNote(""); setFixRequired(null); setIncludeTrend(false); setAcknowledgedRisks(false); setAckJustification(""); setShowProvenance(false); setEscalatedKeys(new Set());
    if (!analysis) { setAnswers({}); setPrefilledIds(new Set()); setConfirmedNegatives(new Set()); return; }
    const prefill = computeCarryForward(priorNoteRef.current || "", analysis.gaps);
    setAnswers(prefill);
    setPrefilledIds(new Set(Object.keys(prefill)));
    setConfirmedNegatives(new Set());
  }, [analysis]);

  const setAnswer = (id, value) => {
    setAnswers(prev => ({ ...prev, [id]: value }));
    setPrefilledIds(prev => { if (!prev.has(id)) return prev; const n = new Set(prev); n.delete(id); return n; });
  };
  const toggleNegative = (id) => setConfirmedNegatives(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
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
    return analysis.gaps
      .filter(e => e.severity !== "critical" && !answers[e.id]?.trim() && !confirmedNegatives.has(e.id))
      .map(e => e.notDocumentedPhrase);
  }, [analysis, answers, confirmedNegatives]);
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

  // Save-ready snapshot the host (e.g. SmartNoteAssistant) persists to the chart.
  const computeResult = (text) => {
    if (!analysis) return null;
    const answeredIds = analysis.required.filter(e => answers[e.id]?.trim()).map(e => e.id);
    const confirmedNegativeIds = Array.from(confirmedNegatives);
    const coverageScore = computeCoverageScore({ requiredElements: analysis.required, presenceResults: analysis.presence, answeredIds, confirmedNegativeIds });
    // When the nurse saves over a critical chart conflict, capture the override
    // trail (which findings, the rationale, and that it was acknowledged) so the
    // host can stamp who/when and persist it to the compliance audit record.
    const critical = chartFindings.filter((f) => f.severity === "critical");
    const acknowledgment = critical.length
      ? { acknowledged: acknowledgedRisks, justification: ackJustification.trim(), finding_ids: critical.map((f) => f.id) }
      : null;
    return { finalNote: text, coverageScore, draftScore: analysis.draftScore, presence: analysis.presence, required: analysis.required, answeredIds, confirmedNegativeIds, answers, chartFindings, sustainedTrends, comparisons, acknowledgment };
  };

  // `groundingText` is the subset of `text` worth grounding (default: all of it).
  // On a fresh generate we pass only the LLM-authored note so the deterministic
  // verbatim extras aren't re-classified; on a re-check after a manual edit we
  // ground the whole note (the nurse may have changed anything).
  const verifyNote = useCallback(async (text, groundingText = text) => {
    const allowed = buildAllowedInput();
    const vg = valueGuard(text, allowed);
    if (!vg.ok) return { ok: false, fix: { values: vg.unverified, sentences: [], offlinePending: false } };
    if (navigator.onLine) {
      if (!groundingText.trim()) return { ok: true, offline: false };
      let g;
      try {
        // Bound the grounding call so a hung request can't leave the note stuck
        // mid-verification — surface it as a re-checkable error instead.
        g = await withTimeout(groundNote(groundingText, allowed, { userKey: currentUser?.email || "anon" }), 30000, "Verification timed out — check your connection and re-check.");
      } catch (timeoutErr) {
        return { ok: false, fix: { values: [], sentences: [], groundingError: timeoutErr.message, offlinePending: false } };
      }
      if (!g.ok) return { ok: false, fix: { values: [], sentences: g.unsupported || [], groundingError: g.error, offlinePending: false } };
      return { ok: true, offline: false };
    }
    return { ok: true, offline: true };
  }, [buildAllowedInput, currentUser?.email]);

  const applyVerification = useCallback((text, v) => {
    if (!v.ok) { setVerifiedNote(""); setFixRequired(v.fix); return; }
    setVerifiedNote(text);
    setFixRequired(v.offline ? { offlinePending: true } : null);
    onFinalNote?.(text);
  }, [onFinalNote]);

  const generate = async () => {
    if (!analysis) return;
    const { required, presence } = analysis;
    const criticalUnanswered = computeCriticalGaps(presence, required).filter(e => !answers[e.id]?.trim());
    if (criticalUnanswered.length) {
      toast.error(`Required before generating: ${criticalUnanswered.map(e => e.label).join(", ")}`);
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

  // If the note was built offline, its LLM grounding pass was deferred. When the
  // browser reconnects, run grounding automatically (fulfilling the "will run
  // when you reconnect" promise shown in the pending banner) and surface the
  // result. This never blocks the offline save — it upgrades a pending note to
  // fully verified, or flags any sentences to review before finalizing.
  useEffect(() => {
    if (!finalNote || !fixRequired?.offlinePending) return;
    const onReconnect = async () => {
      try {
        const v = await verifyNote(finalNote);
        applyVerification(finalNote, v);
        if (v.ok) toast.success("Reconnected — every value re-verified against your input.");
        else toast.error("Reconnected — grounding flagged items to review before finalizing.");
      } catch (err) {
        console.error("Reconnect grounding failed:", err);
        toast.error("Reconnected, but verification couldn't run. Use Re-check before finalizing.");
      }
    };
    window.addEventListener("online", onReconnect);
    return () => window.removeEventListener("online", onReconnect);
  }, [finalNote, fixRequired, applyVerification, verifyNote]);

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
  const gaps = analysis?.gaps || [];
  const answeredOrConfirmed = (id) => !!answers[id]?.trim() || confirmedNegatives.has(id);
  const answeredCount = gaps.filter(g => answeredOrConfirmed(g.id)).length;
  const criticalUnanswered = analysis ? computeCriticalGaps(analysis.presence, analysis.required).filter(e => !answers[e.id]?.trim()) : [];
  const documentedCount = analysis ? analysis.required.filter(e => { const p = analysis.presence.find(r => r.id === e.id); return (p && p.present) || answeredOrConfirmed(e.id); }).length : 0;
  const liveCoverage = analysis ? computeCoverageScore({ requiredElements: analysis.required, presenceResults: analysis.presence, answeredIds: analysis.required.filter(e => answers[e.id]?.trim()).map(e => e.id), confirmedNegativeIds: Array.from(confirmedNegatives) }) : 0;
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

  const finalApi = {
    finalNote, setFinalNote, building, copy, copied,
    verified: !dirty && !fixRequired,
    dirty, fixRequired,
    coverage: liveCoverage,
    recheck,
    result: computeResult(finalNote),
    chartRisk: { findings: criticalChartFindings, hasUnacknowledgedCritical },
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

          <ChartCrossCheckPanel findings={chartFindings} />

          {gaps.length > 0 && (
            <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-semibold text-slate-900 flex items-center gap-2"><HelpCircle className="w-4 h-4 text-amber-500" /> Questions to Complete Your Note</h3>
                <span className="text-xs text-slate-500 shrink-0">{answeredCount}/{gaps.length} addressed</span>
              </div>
              <p className="text-xs text-slate-500 mb-2">These required elements weren't in your draft. Answer what applies. Non-critical items left blank become an explicit "Not documented this visit." — never invented.</p>
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
                  return (
                    <div key={g.id} className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg">
                      <div className="flex items-start gap-2">
                        <Badge className={`shrink-0 text-xs ${g.severity === "critical" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{g.severity === "critical" ? "required" : "optional"}</Badge>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-slate-900">{g.question}</p>
                            {prefilledIds.has(g.id) && <span className="shrink-0 text-[10px] font-semibold text-navy-700 bg-navy-100 px-1.5 py-0.5 rounded-full">from last visit · confirm</span>}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">{g.copReference}</p>
                        </div>
                      </div>
                      {g.standardNegative && (
                        <label className="mt-2 flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input type="checkbox" checked={negConfirmed} onChange={() => toggleNegative(g.id)} className="w-4 h-4 text-indigo-600 rounded" />
                          <span>Confirm: “{g.standardNegative.phrase}”</span>
                        </label>
                      )}
                      {!negConfirmed && (
                        <div className="mt-2 flex items-start gap-2">
                          <textarea
                            value={answers[g.id] || ""}
                            onChange={e => setAnswer(g.id, e.target.value)}
                            placeholder="Type or dictate your answer — written into the note in compliant language…"
                            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none resize-none min-h-[56px] leading-relaxed"
                          />
                          <DictationButton onText={(t) => appendAnswer(g.id, t)} />
                        </div>
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

          <div className="flex gap-3">
            <Button onClick={generate} disabled={criticalUnanswered.length > 0} className="flex-1 bg-indigo-600 hover:bg-indigo-700 h-12 font-semibold gap-2">
              <Sparkles className="w-4 h-4" /> Generate Final Note <ArrowRight className="w-4 h-4" />
            </Button>
            {onBack && <Button variant="outline" onClick={onBack} className="h-12 px-4">← Back</Button>}
          </div>
        </>
      )}

      {finalNote && (
        <>
          {fixRequired && fixRequired.offlinePending ? (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 space-y-1">
              <h3 className="font-semibold text-amber-800 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Verification pending</h3>
              <p className="text-sm text-amber-800">Every value was checked against your input. The AI grounding pass will run when you reconnect. Review carefully before pasting into the EMR.</p>
            </div>
          ) : fixRequired ? (
            <div className="rounded-xl border-2 border-red-300 bg-red-50 p-4 space-y-2">
              <h3 className="font-semibold text-red-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Fix required before finalizing</h3>
              {fixRequired.values?.length > 0 && <p className="text-sm text-red-800">Values not found in your input: <strong>{fixRequired.values.map(v => v.value).join(", ")}</strong></p>}
              {fixRequired.sentences?.length > 0 && (
                <div className="text-sm text-red-800">Sentences not supported by your input:
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">{fixRequired.sentences.slice(0, 6).map((s, i) => <li key={i}>{s.text}</li>)}</ul>
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
              <Button onClick={recheck} className="bg-amber-600 hover:bg-amber-700 h-9 gap-2 text-sm font-semibold"><ShieldCheck className="w-4 h-4" /> Re-check</Button>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-800">
              <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" /> Every value and statement in this note was verified against what you wrote. Copy it into your EMR.
            </div>
          )}

          {(!fixRequired || fixRequired.offlinePending) && (
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
                  <Button onClick={copy} className="flex-1 bg-green-600 hover:bg-green-700 h-11 gap-2 font-semibold">
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
