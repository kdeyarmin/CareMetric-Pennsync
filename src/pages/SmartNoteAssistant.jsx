import { useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey, scopePatientsForCurrentCaller } from "@/lib/agencyRoster";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Loader2, ArrowRight, ClipboardList, User,
  Mic, Square, AlertTriangle, Sparkles, Activity, Building2, ShieldCheck
} from "lucide-react";
import { todayEastern } from "../components/utils/timezone";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import { enhanceTranscription } from "../components/utils/medicalDictionary";
import SmartNoteHeader from "../components/smartNote/SmartNoteHeader";
import VisitSummaryGenerator from "../components/smartNote/VisitSummaryGenerator";
import NoteTemplateSelector from "../components/smartNote/NoteTemplateSelector";
import VitalSignValidator from "../components/smartNote/VitalSignValidator";
import VitalSignsForm, { VITAL_FIELDS } from "../components/visit/VitalSignsForm";
import StructuredNoteDrafter from "../components/smartNote/StructuredNoteDrafter";
import VisitAudioRecorder from "../components/smartNote/VisitAudioRecorder";
import VitalsTrendAnalysis from "../components/smartNote/VitalsTrendAnalysis";
import FinalNoteDisplay from "../components/smartNote/FinalNoteDisplay";
import FollowUpTasksPanel from "../components/smartNote/FollowUpTasksPanel";
import ComplianceChecklist from "../components/smartNote/ComplianceChecklist";
import QuickPhraseTextarea from "../components/smartNote/QuickPhraseTextarea";
import FacilityRequirementsChecklist from "../components/smartNote/FacilityRequirementsChecklist";
import ConstrainedNoteReviewer from "../components/smartNote/ConstrainedNoteReviewer";
import NoteReadinessBar from "../components/smartNote/NoteReadinessBar";
import { persistVisitNote, OfflineSaveError } from "../components/smartNote/persistVisitNote";
import { advanceHandoffStatus, buildReviewAcknowledgement } from "../components/smartNote/emrHandoff";
import { getPriorNote } from "../components/smartNote/noteHelpers";
import { evaluateFacilityRules, summarizeFacilityRules } from "../components/smartNote/compliance/facilityDocRules";
import { describePlaceholders, countPlaceholders, findPlaceholders } from "../components/smartNote/compliance/placeholderGuard";
import { claimDictation, releaseDictation } from "@/components/smartNote/dictationController";
import { generateFollowUpTasks } from "@/functions/generateFollowUpTasks";
import { analyzeVisitForSupplyUsage } from "@/functions/analyzeVisitForSupplyUsage";
import { toast } from "sonner";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import { HOME_HEALTH_VISIT_TYPES, HOSPICE_VISIT_TYPES } from "@/components/visit/visitTypes";

const getVisitTypes = (careScope) => {
  if (careScope === "hospice") return HOSPICE_VISIT_TYPES;
  if (careScope === "both") return [...HOME_HEALTH_VISIT_TYPES, ...HOSPICE_VISIT_TYPES.filter(v => !HOME_HEALTH_VISIT_TYPES.find(h => h.value === v.value))];
  return HOME_HEALTH_VISIT_TYPES;
};

const draftKeyFor = (pid) => `smart_note_draft_v2:${pid || "unassigned"}`;

const buildExportFindings = (result) => {
  if (!result) return [];
  const answered = new Set(result.answeredIds || []);
  const negated = new Set(result.confirmedNegativeIds || []);
  const present = new Set((result.presence || []).filter((p) => p.present).map((p) => p.id));
  const missing = (result.required || [])
    .filter((e) => !present.has(e.id) && !answered.has(e.id) && !negated.has(e.id))
    .map((e) => ({
      severity: e.severity === "critical" ? "critical" : "medium",
      issue: e.notDocumentedPhrase || `${e.label} was not documented this visit.`,
      suggestion: e.hint || e.question || "",
    }));
  const denial = (result.denialGuardrail?.findings || [])
    .filter((f) => f.status === "fail")
    .map((f) => ({ severity: f.severity, issue: f.message, suggestion: f.remediation || "" }));
  return [...missing, ...denial];
};

import SmartNoteNav from "../components/smartNote/SmartNoteNav";
import CollapsibleSection, { openOnDesktop } from "../components/smartNote/CollapsibleSection";
import StickyActionBar from "../components/smartNote/StickyActionBar";
import PlaceholderAlert from "../components/smartNote/PlaceholderAlert";
import SaveBlockers from "../components/smartNote/SaveBlockers";
import AcknowledgeGate from "../components/smartNote/AcknowledgeGate";
import PageContainer from "@/components/ui/PageContainer";
import { HideWhenEmbedded } from "@/components/ui/embeddedPage";
import { ALL_ROWS } from '@/lib/queryLimits';

export default function SmartNoteAssistant({ visitId = null }) {
  const [searchParams] = useSearchParams();
  const queryPatientId = searchParams.get("patientId") || searchParams.get("patient_id") || "";
  const queryVisitType = searchParams.get("visitType") || searchParams.get("visit_type") || "";
  const referralHandoff = useMemo(() => {
    if (searchParams.get("referral_mode") !== "true") return { draftNote: "", patientId: "", visitType: "" };
    const referralId = searchParams.get("referral_id");
    if (!referralId) return { draftNote: "", patientId: "", visitType: "" };
    try {
      const raw = sessionStorage.getItem(`referral_prepopulate:${referralId}`);
      if (!raw) return { draftNote: "", patientId: "", visitType: "" };
      const parsed = JSON.parse(raw);
      return {
        draftNote: String(parsed.roughNote || "").trim(),
        patientId: String(parsed.patientId || "").trim(),
        visitType: String(parsed.visitType || "").trim(),
      };
    } catch {
      return { draftNote: "", patientId: "", visitType: "" };
    }
  }, [searchParams]);
  const referralDraftNote = referralHandoff.draftNote;
  const [patientId, setPatientId] = useState(queryPatientId || referralHandoff.patientId);
  const [visitType, setVisitType] = useState(queryVisitType || referralHandoff.visitType || "routine_visit");
  const visitDate = todayEastern();
  const [note, setNote] = useState(referralDraftNote);
  const [vitals, setVitals] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedVisitId, setSavedVisitId] = useState(null);
  const [savedAuditId, setSavedAuditId] = useState(null);
  const [existingVisitId, setExistingVisitId] = useState(null);
  const boundPatientRef = useRef(null);
  // Facility override captured at save-click time so persistVisitNote can stamp
  // ComplianceAudit.acknowledgment without lifting the render-prop evaluation.
  const facilityOverrideRef = useRef(null);
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState(false);
  const [activeTab, setActiveTab] = useState("builder");
  const [draftRestored, setDraftRestored] = useState(false);
  const [followUpTasks, setFollowUpTasks] = useState([]);
  const [facilityAck, setFacilityAck] = useState(false);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  // Why the last save attempt failed, kept on screen instead of only in a toast.
  const [saveError, setSaveError] = useState(null);
  // EMR handoff — SELF-REPORTED progress moving the prepared note into the
  // agency's EMR, plus the AI-governance review record. PennSync has no EMR
  // integration, so neither ever asserts what happened inside the EMR.
  const [handoff, setHandoff] = useState({ status: "not_started", history: [] });
  const [handoffError, setHandoffError] = useState(null);
  const [reviewAck, setReviewAck] = useState(null);
  const recRef = useRef(null);
  const recStopRef = useRef(null);
  const textareaRef = useRef(null);
  const SAVED_PATIENT_KEY = "smart_note_patient_v1";
  const patientIdRef = useRef(patientId);
  const prevPatientRef = useRef(patientId);
  const noteRef = useRef(note);
  patientIdRef.current = patientId;
  noteRef.current = note;
  const autosaveBucketRef = useRef(undefined);
  const autosavePrevNoteRef = useRef("");

  const tryRestoreDurableDraft = (pid) => {
    import('@/lib/draftNotes')
      .then(({ getDraftNoteLocally }) => getDraftNoteLocally(`draft_${pid || 'unassigned'}`))
      .then((d) => {
        if (patientIdRef.current !== pid || noteRef.current?.trim()) return;
        if (!d?.note || d.note.trim().length <= 20) return;
        setNote(d.note);
        if (d.visitType) setVisitType(d.visitType);
        setDraftRestored(true);
      })
      .catch(() => {});
  };

  const clearDraft = (pid) => {
    sessionStorage.removeItem(draftKeyFor(pid));
    import('@/lib/draftNotes')
      .then(({ deleteDraftNoteLocally }) => deleteDraftNoteLocally(`draft_${pid || 'unassigned'}`))
      .catch(() => {});
  };

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const careScope = currentUser?.care_scope || "home_health";
  const { data: patients = [] } = useQuery({
    queryKey: ["patients", "active-all", agencyQueryKey(currentUser)],
    networkMode: 'always',
    // ALL_ROWS before the agency post-filter so foreign-tenant charts cannot
    // crowd the picker.
    queryFn: async () => scopePatientsForCurrentCaller(
      await base44.entities.Patient.filter({ status: "active" }, "first_name", ALL_ROWS),
    )
  });
  const patient = patients.find(p => p.id === patientId);
  const { data: complianceRules = [] } = useQuery({
    queryKey: ["medicareComplianceRules"],
    queryFn: () => base44.entities.MedicareComplianceRule.list(undefined, ALL_ROWS),
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });
  const { data: patientDetail } = useQuery({
    queryKey: ["patientDetail", patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId,
  });
  const effectiveCareType = (patientDetail || patient)?.care_type || careScope;
  const isHospice = effectiveCareType === "hospice";
  const serviceLine = isHospice ? "hospice" : "home_health";
  const VISIT_TYPES = getVisitTypes(effectiveCareType);
  const { data: facilityDocRules = [] } = useQuery({
    queryKey: ["facility-doc-rules"],
    queryFn: () => base44.entities.FacilityDocumentationRule.list("-severity", 200),
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });
  useEffect(() => {
    if (currentUser?.email) logActivity(ActivityActions.PAGE_VISIT, { page: "SmartNoteAssistant" });
  }, [currentUser?.email]);

  const { data: boundVisit } = useQuery({
    queryKey: ["visit", visitId],
    queryFn: () => base44.entities.Visit.get(visitId),
    enabled: !!visitId,
  });
  useEffect(() => {
    if (!boundVisit?.id) return;
    boundPatientRef.current = boundVisit.patient_id;
    setExistingVisitId(boundVisit.id);
    if (boundVisit.patient_id) setPatientId(boundVisit.patient_id);
    if (boundVisit.visit_type) setVisitType(boundVisit.visit_type);
    // Hydrate the handoff trail from the visit. Without this a previously
    // signed-off visit re-opened here showed "Not copied yet", and the next
    // report wrote a fresh one-entry history back — downgrading the persisted
    // status and destroying an append-only audit trail.
    setHandoff({
      status: boundVisit.emr_handoff_status || "not_started",
      history: Array.isArray(boundVisit.emr_handoff_history) ? boundVisit.emr_handoff_history : [],
    });
    setReviewAck(boundVisit.documentation_review_ack || null);
  }, [boundVisit]);

  useEffect(() => {
    if (queryPatientId || queryVisitType) {
      if (queryPatientId) setPatientId(queryPatientId);
      if (queryVisitType) setVisitType(queryVisitType);
      return;
    }
    const saved = sessionStorage.getItem(SAVED_PATIENT_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.patientId) setPatientId(parsed.patientId);
        if (parsed.visitType) setVisitType(parsed.visitType);
      } catch { /* no-op */ }
    }
  }, [queryPatientId, queryVisitType]);

  useEffect(() => {
    sessionStorage.setItem(SAVED_PATIENT_KEY, JSON.stringify({ patientId, visitType }));
  }, [patientId, visitType]);

  useEffect(() => {
    if (referralDraftNote) {
      setNote(referralDraftNote);
      setDraftRestored(true);
      return;
    }
    const saved = sessionStorage.getItem(draftKeyFor(patientIdRef.current));
    if (!saved) { tryRestoreDurableDraft(patientIdRef.current); return; }
    try {
      const parsed = JSON.parse(saved);
      if (parsed.note?.trim().length > 20) {
        setNote(parsed.note);
        if (parsed.visitType) setVisitType(parsed.visitType);
        setDraftRestored(true);
      }
    } catch { /* ignore a corrupt draft */ }
  }, [referralDraftNote]);

  useEffect(() => {
    const prev = prevPatientRef.current;
    if (prev === patientId) return;
    prevPatientRef.current = patientId;
    setVitals({});
    // Clear saved visit/audit ids so a re-save cannot update the prior
    // patient's Visit while history appends to the new patient (parity with
    // AudioVisitCapture).
    setSavedVisitId(null);
    setSavedAuditId(null);
    // Same reasoning: a failure recorded against the previous patient's note must
    // not be reported against this one, which no save has been attempted on.
    setSaveError(null);
    // The handoff trail and review record belong to ONE patient's note. Carrying
    // them across a patient switch would attribute "signed in EMR" (and a review
    // acknowledgement) to a chart it was never made against.
    setHandoff({ status: "not_started", history: [] });
    setHandoffError(null);
    setReviewAck(null);
    if (patientId !== boundPatientRef.current) setExistingVisitId(null);
    let incoming = null;
    const saved = sessionStorage.getItem(draftKeyFor(patientId));
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        incoming = parsed.note || "";
        if (parsed.visitType) setVisitType(parsed.visitType);
      } catch { incoming = null; }
    }
    if (incoming !== null) {
      setNote(incoming);
      setDraftRestored(incoming.trim().length > 20);
    } else if (prev) {
      setNote("");
      setDraftRestored(false);
      tryRestoreDurableDraft(patientId);
    }
  }, [patientId]);

  useEffect(() => {
    const pid = patientIdRef.current;
    const bucketChanged = autosaveBucketRef.current !== pid;
    const prevNote = autosavePrevNoteRef.current;
    autosaveBucketRef.current = pid;
    autosavePrevNoteRef.current = note;
    if (!note.trim()) {
      if (!bucketChanged && prevNote.trim()) clearDraft(pid);
      return;
    }
    sessionStorage.setItem(draftKeyFor(pid), JSON.stringify({ note, visitType, patientId: pid }));
    import('@/lib/draftNotes').then(({ saveDraftNoteLocally }) => {
        saveDraftNoteLocally({ id: `draft_${pid || 'unassigned'}`, note, visitType, patientId: pid });
    }).catch(console.error);
  }, [note, visitType]);

  useEffect(() => { if (step === 1) textareaRef.current?.focus(); }, [step]);

  useEffect(() => {
    return () => {
      try { recRef.current?.stop(); } catch { /* already stopped */ }
      releaseDictation(recStopRef.current);
    };
  }, []);

  const startDictation = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast.error("Speech recognition not supported in this browser."); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      const t = Array.from(e.results).slice(e.resultIndex).map(r => r[0].transcript).join(" ");
      const enhanced = enhanceTranscription(t);
      setNote(prev => prev ? prev + " " + enhanced : enhanced);
    };
    const stop = () => { try { rec.stop(); } catch { /* already stopped */ } };
    recStopRef.current = stop;
    rec.onerror = () => { setListening(false); releaseDictation(stop); };
    rec.onend = () => { setListening(false); releaseDictation(stop); };
    recRef.current = rec;
    claimDictation(stop);
    rec.start();
    setListening(true);
  };
  const stopDictation = () => { recRef.current?.stop(); setListening(false); releaseDictation(recStopRef.current); };

  const startReview = () => {
    if (!note || note.trim().length < 20) return;
    // Blanks are fixable HERE and not on the review screen, so stop at the door
    // rather than letting the nurse discover the hard block a click later.
    const blanks = describePlaceholders(note);
    if (blanks.length) {
      // Count from countPlaceholders, not the capped display rows (see draftScan.js).
      const total = countPlaceholders(note);
      toast.error(`Fill in or delete the ${total} blank${total > 1 ? "s" : ""} left in your draft (${blanks[0].placeholders[0]}…) before reviewing.`);
      return;
    }
    const facilityResults = evaluateFacilityRules({
      rules: facilityDocRules,
      patient: patientDetail || patient,
      noteText: note,
      visitType,
    });
    const facilitySummary = summarizeFacilityRules(facilityResults);
    if (facilitySummary.missing > 0) {
      const labels = facilityResults
        .filter((r) => r.missing)
        .map((r) => r.rule.requirement_label || r.rule.rule_name)
        .slice(0, 3)
        .join("; ");
      toast.warning(`Facility requirement${facilitySummary.missing > 1 ? "s" : ""} not yet documented: ${labels}`);
    }
    setSaved(false);
    setSavedVisitId(null);
    setSavedAuditId(null);
    setFacilityAck(false);
    facilityOverrideRef.current = null;
    setStep(2);
  };

  const handleSave = async (api) => {
    if (!patientId || !currentUser?.email) {
      toast.error("Select a patient to save this note to their chart.");
      return;
    }
    if (api.chartRisk?.hasUnacknowledgedCritical) {
      toast.error("Acknowledge the chart safety conflict before saving to the chart.");
      return;
    }
    if (api.denialRisk?.hasUnacknowledgedCritical) {
      toast.error("Acknowledge the denial-risk findings before saving to the chart.");
      return;
    }
    setSaveError(null);
    setSaving(true);
    try {
      let result = api.result;
      if (api.dirty) {
        result = await api.recheck();
        if (!result) { setSaving(false); return; }
      }
      const out = await persistNote(result);
      if (!out) {
        // persistVisitNote returns null without throwing when inputs are insufficient
        // — do NOT mark saved or clear the draft (would destroy the only copy).
        toast.error("Could not save — check that a patient is selected and the note is complete.");
        return;
      }
      setSaved(true);
      clearDraft(patientId);
    } catch (err) {
      console.error("Save to chart error:", err);
      // OfflineSaveError carries the one message that tells the nurse their work
      // is safe and what to do; the generic catch used to swallow it.
      const message = err instanceof OfflineSaveError
        ? err.message
        : "Saving to the chart failed \u2014 your draft is still here. Try again.";
      setSaveError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const persistNote = async (result) => {
    const out = await persistVisitNote({
      result, patientId, visitDate, visitType, roughNote: note, vitals,
      currentUser, patientDiagnosis: patientDetail?.primary_diagnosis || patient?.primary_diagnosis || "",
      savedVisitId, savedAuditId, existingVisitId,
      facilityAcknowledgment: facilityOverrideRef.current,
    });
    if (!out) return null;
    // A handoff step or review acknowledgement reported BEFORE the working copy
    // existed was held in component state; attach it to the record now so the
    // office sees the same trail the nurse saw. Best-effort: a failure here must
    // never surface as "the note didn't save", because it did.
    if (out.visitId && (handoff.status !== "not_started" || reviewAck)) {
      const trail = {};
      if (handoff.status !== "not_started") {
        trail.emr_handoff_status = handoff.status;
        trail.emr_handoff_history = handoff.history;
      }
      if (reviewAck) trail.documentation_review_ack = reviewAck;
      base44.entities.Visit.update(out.visitId, trail).catch((err) => {
        console.error("Failed to attach the EMR handoff trail to the saved visit:", err);
        setHandoffError("Your note saved, but the EMR handoff steps didn't sync. Re-report them to try again.");
      });
    }
    if (out.mode === 'create') {
      setSavedVisitId(out.visitId);
      setExistingVisitId(null);
      if (out.auditId) setSavedAuditId(out.auditId);
      generateTasksFromNote(out.finalText, out.visitId);
      analyzeSupplyUsage(out.finalText, out.visitId);
    } else if (out.mode === 'update') {
      setSavedVisitId(out.visitId);
      if (out.auditId) setSavedAuditId(out.auditId);
    }
    return out;
  };

  const analyzeSupplyUsage = async (noteText, visitId) => {
    if (!noteText || !patientId) return;
    try {
      await analyzeVisitForSupplyUsage({ visitId, visitNotes: noteText, patientId });
    } catch (err) {
      console.error("Supply analysis failed:", err);
    }
  };

  const generateTasksFromNote = async (noteText, visitId) => {
    if (!noteText || generatingTasks) return;
    setGeneratingTasks(true);
    try {
      const result = await generateFollowUpTasks({
        noteText,
        patientId: patientId || undefined,
        visitId: visitId || undefined,
        visitType,
        diagnosis: patient?.primary_diagnosis || "",
      });
      if (result?.data?.tasks?.length) {
        setFollowUpTasks(result.data.tasks);
      }
    } catch (err) {
      console.error("Failed to generate follow-up tasks:", err);
    } finally {
      setGeneratingTasks(false);
    }
  };

  /**
   * Record a SELF-REPORTED EMR handoff step.
   *
   * The status is persisted onto the Visit only once PennSync's working copy
   * exists (a saved visit). Before that there is no record to attach it to, so
   * it is held in component state and written on the next save — and a report
   * made with no connection is refused outright rather than shown as recorded,
   * because a workflow status the office never receives is worse than none.
   */
  const reportHandoffStatus = async (nextStatus) => {
    const next = advanceHandoffStatus(handoff, nextStatus, { actorEmail: currentUser?.email });
    if (!next.ok) {
      setHandoffError(next.reason);
      return;
    }
    setHandoffError(null);
    setHandoff({ status: next.status, history: next.history });
    if (!savedVisitId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setHandoffError("You're offline. This step is recorded on this device — reconnect to sync it.");
      return;
    }
    try {
      await base44.entities.Visit.update(savedVisitId, {
        emr_handoff_status: next.status,
        emr_handoff_history: next.history,
      });
    } catch (err) {
      console.error("Failed to sync EMR handoff status:", err);
      setHandoffError("Couldn't sync this step to the server. It is recorded on this device — try again.");
    }
  };

  /**
   * The AI-governance review record. Not a clinical signature: it states only
   * that a human read the AI-assisted text, against a specific note version.
   */
  const recordReviewAck = async (checked, finalText, nurseEdited = false) => {
    // Withdrawing the acknowledgement must clear the SERVER record too.
    // Clearing only local state left the Visit asserting that a clinician had
    // reviewed a note version they had since un-reviewed — a false governance
    // record, which is worse than no record.
    const ack = checked
      ? buildReviewAcknowledgement({
          noteText: finalText,
          actorEmail: currentUser?.email,
          aiAssisted: true,
          // Whether the CLINICIAN changed the generated text — not whether the
          // scribe rewrote the rough draft, which it always does.
          edited: nurseEdited,
        })
      : null;
    setReviewAck(ack);
    if (!savedVisitId) return;
    try {
      await base44.entities.Visit.update(savedVisitId, { documentation_review_ack: ack });
    } catch (err) {
      console.error("Failed to persist the documentation review acknowledgement:", err);
      toast.error("Couldn't sync your review record to the server. Try again.");
    }
  };

  const reset = () => {
    setNote(""); setSaved(false); setSavedVisitId(null); setSavedAuditId(null);
    setStep(1); setDraftRestored(false); setFollowUpTasks([]); setSaveError(null);
    setVitals({}); setExistingVisitId(null); setFacilityAck(false);
    setHandoff({ status: "not_started", history: [] });
    setHandoffError(null);
    setReviewAck(null);
    facilityOverrideRef.current = null;
    clearDraft(patientIdRef.current);
  };

  const escalateToTasks = async (items) => {
    if (!items?.length || !currentUser?.email) return;
    const newReqId = () =>
      (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payloads = items.map((it) => ({
      client_request_id: newReqId(),
      patient_id: patientId || undefined,
      title: it.title,
      description: it.description || "",
      type: "notify",
      priority: "high",
      status: "pending",
      source: "manual",
      assigned_to: currentUser.email,
      ai_reason: it.reason || "",
      related_visit_id: savedVisitId || undefined,
    }));
    // No local queue any more: a follow-up task is either created on the server
    // or reported as not created. Never claim it was saved when it wasn't.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You're offline — reconnect to create the provider follow-up task.");
      return;
    }

    const results = await Promise.allSettled(payloads.map((p) => base44.entities.Task.create(p)));
    const created = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? created.push(r.value) : failed.push(payloads[i])));
    if (created.length) setFollowUpTasks((prev) => [...created, ...prev]);
    if (!failed.length) {
      toast.success(`Created ${created.length} provider follow-up task${created.length !== 1 ? "s" : ""}.`);
      return;
    }
    console.error("Some escalation task creates failed:", results.find((r) => r.status === "rejected")?.reason);
    toast.error(`Couldn't create ${failed.length} follow-up task${failed.length !== 1 ? "s" : ""}. Try again.`);
  };

  const ready = note.trim().length >= 20;

  // Walk the nurse through the template scaffolding one blank at a time, starting
  // from wherever the caret is so repeated presses move forward and then wrap.
  const blanksAlertRef = useRef(null);
  const jumpToNextBlank = () => {
    const blanks = findPlaceholders(note);
    if (!blanks.length) return;
    const caret = textareaRef.current?.getCaret?.() ?? 0;
    const next = blanks.find((b) => b.index >= caret) || blanks[0];
    textareaRef.current?.selectRange?.(next.index, next.index + next.value.length);
  };

  // Status shown beside the sticky Review button, so the reason it is disabled is
  // always on screen rather than only in a toast after the click.
  const draftBlanks = countPlaceholders(note);
  const reviewStatus = !ready
    ? `${20 - note.trim().length} more characters needed`
    : draftBlanks > 0
      ? `${draftBlanks} blank${draftBlanks === 1 ? "" : "s"} to fill before review`
      : `${note.length} chars \u2014 ready`;

  const vitalsRecorded = useMemo(
    () => VITAL_FIELDS.filter((f) => {
      const v = vitals?.[f.key];
      return v !== null && v !== undefined && v !== "";
    }).length,
    [vitals],
  );
  // Expanded where there is room, collapsed on a phone so the editor stays put.
  const [vitalsOpenByDefault] = useState(openOnDesktop);

  // Same evaluation the checklist runs, lifted so the section header can show what
  // is outstanding while collapsed (and open itself when something is).
  const step1Facility = useMemo(
    () => summarizeFacilityRules(evaluateFacilityRules({
      rules: facilityDocRules,
      patient: patientDetail || patient,
      noteText: note,
      visitType,
    })),
    [facilityDocRules, patientDetail, patient, note, visitType],
  );

  return (
    <PageContainer>

      <HideWhenEmbedded>
        <SmartNoteHeader careScope={careScope} onReset={reset} step={step} activeTab={activeTab} />
      </HideWhenEmbedded>

      <SmartNoteNav step={step} activeTab={activeTab} setActiveTab={setActiveTab} />

      {activeTab === "drafter" && (
        <StructuredNoteDrafter
          onDraftReady={(draft, vType, structuredVitals) => {
            setNote(draft);
            setVisitType(vType);
            if (structuredVitals) setVitals(structuredVitals);
            setActiveTab("builder");
          }}
        />
      )}

      {activeTab === "summary" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <VisitSummaryGenerator patientId={patientId} />
        </div>
      )}

      {activeTab === "trends" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <VitalsTrendAnalysis patientId={patientId} />
        </div>
      )}

      {activeTab === "builder" && (
        <>
          {draftRestored && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-emerald-700 font-medium">Draft restored.</p>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              {/* Who and what kind of visit. Compact, and honest that a patient is
                  required before the note can reach a chart. */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <User className="w-3.5 h-3.5 text-navy-600" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Patient</span>
                    <span className="text-xs text-amber-700 font-semibold normal-case ml-1">required to save</span>
                  </div>
                  <SearchablePatientSelect
                    patients={patients}
                    value={patientId}
                    onValueChange={setPatientId}
                    className="bg-slate-50 border-slate-200 h-12 sm:h-11 text-sm rounded-xl"
                  />
                  {!patientId && (
                    <p className="text-xs text-slate-500 mt-1.5">
                      You can start writing now — a patient is required before this note can be saved to a chart.
                    </p>
                  )}
                  {patient && (
                    <div className="flex items-center gap-2 text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded-lg px-3 py-2 mt-2">
                      <User className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        <strong>{patient.first_name} {patient.last_name}</strong>
                        {patient.primary_diagnosis ? ` \u00b7 ${patient.primary_diagnosis}` : ""}
                        {patient.current_medications?.length > 0 ? ` \u00b7 ${patient.current_medications.length} meds` : ""}
                        {patient.functional_status?.fall_risk === "high" && <span className="ml-2 inline-flex items-center gap-1 text-rose-600 font-bold"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> High Fall Risk</span>}
                      </span>
                    </div>
                  )}
                </div>
                <div className="border-t border-slate-100" />
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <ClipboardList className="w-3.5 h-3.5 text-navy-600" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Visit Type</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {VISIT_TYPES.map(v => {
                      const selected = visitType === v.value;
                      return (
                        <button
                          key={v.value}
                          type="button"
                          onClick={() => setVisitType(v.value)}
                          aria-pressed={selected}
                          style={selected ? { backgroundColor: "#264491", borderColor: "#264491", color: "#ffffff" } : undefined}
                          className={`py-3 sm:py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all text-center leading-tight min-h-[48px] sm:min-h-0 active:scale-95 ${selected ? "shadow-md" : "bg-slate-50 border-slate-200 text-slate-700 hover:border-navy-300 hover:bg-navy-50"}`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* The editor the nurse came here for, directly under the patient
                  card. Everything that used to sit between the two is now below
                  it, collapsed. */}
              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <span className="text-xs font-semibold text-navy-700">Your Rough Notes / Bullet Points</span>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-navy-600 hover:text-navy-800"
                      onClick={() => textareaRef.current?.openQuickPhrases?.()}>
                      <Sparkles className="w-3.5 h-3.5" /> Quick Phrase
                    </Button>
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-navy-600 hover:text-navy-800"
                      onClick={() => { setActiveTab("drafter"); }}>
                      <ClipboardList className="w-3.5 h-3.5" /> Use Structured Form
                    </Button>
                  </div>
                </div>
                <QuickPhraseTextarea
                  ref={textareaRef}
                  value={note}
                  onChange={setNote}
                  patientId={patientId}
                  patientName={patient ? `${patient.first_name} ${patient.last_name}` : undefined}
                  visitType={visitType}
                  userEmail={currentUser?.email}
                  placeholder={"Enter bullet points or rough draft \u2014 AI will NOT invent information.\n\nType / or .shortcut to insert a saved quick phrase.\n\n\u2022 BP 148/90, HR 82, O2 95% RA, pain 3/10\n\u2022 homebound: unable to leave without considerable effort\n\u2022 skilled need: wound assessment and dressing change\n\u2022 wound R heel 2\u00d73 cm granulating, no odor\n\u2022 taught med schedule, pt verbalized understanding\n\u2022 fall risk \u2014 clutter noted, discussed w/ family"}
                  className="w-full min-h-[240px] sm:min-h-[320px] text-sm border-0 px-4 py-3 focus:ring-0 bg-white font-mono resize-none outline-none leading-relaxed" spellCheck={false}
                />
                {/* Voice is a real feature but a minority path; it no longer sits
                    between the nurse and the box they type in. */}
                <div className="border-t border-slate-100">
                  <CollapsibleSection
                    title="Voice input"
                    icon={Mic}
                    summary="Dictate or record instead of typing"
                    defaultOpen={false}
                    className="border-0 shadow-none rounded-none bg-transparent"
                  >
                    <div className="space-y-2">
                      <Button
                        variant={listening ? "destructive" : "default"}
                        className={`h-9 gap-2 text-xs font-semibold shadow-sm ${listening ? 'animate-pulse' : 'bg-navy-600 hover:bg-navy-700 text-white'}`}
                        onClick={listening ? stopDictation : startDictation}
                      >
                        {listening ? <><Square className="w-4 h-4 fill-current" /> Stop Dictation</> : <><Mic className="w-4 h-4" /> Live Dictation</>}
                      </Button>
                      <VisitAudioRecorder
                        onTranscribed={(text) => setNote(prev => prev ? prev + "\n\n" + text : text)}
                      />
                    </div>
                  </CollapsibleSection>
                </div>
              </div>

              <NoteReadinessBar
                roughNote={note}
                serviceLine={serviceLine}
                visitType={visitType}
                vitals={vitals}
                complianceRules={complianceRules}
              />

              <div ref={blanksAlertRef} tabIndex={-1} className="focus:outline-none">
                <PlaceholderAlert note={note} onJump={jumpToNextBlank} />
              </div>

              <VitalSignValidator noteText={note} />

              <StickyActionBar status={reviewStatus}>
                <Button
                  onClick={startReview}
                  disabled={!ready || draftBlanks > 0}
                  className="h-11 px-5 gap-1.5 text-sm font-semibold w-full sm:w-auto"
                >
                  <ClipboardList className="w-4 h-4" /> Review & Complete <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </StickyActionBar>

              {/* Supporting material. Still one tap away, and each header keeps
                  showing its own status while collapsed. */}
              <CollapsibleSection
                title="Vital Signs"
                icon={Activity}
                badge={`${vitalsRecorded} of ${VITAL_FIELDS.length} recorded`}
                badgeVariant={vitalsRecorded > 0 ? "info" : "secondary"}
                defaultOpen={vitalsOpenByDefault}
              >
                <VitalSignsForm vitalSigns={vitals} onChange={setVitals} />
              </CollapsibleSection>

              <NoteTemplateSelector currentVisitType={visitType} onSelect={(content, type) => {
                setNote(content); setVisitType(type);
                setTimeout(() => textareaRef.current?.focus(), 100);
              }} />

              {step1Facility.applicable > 0 && (
                <CollapsibleSection
                  title="Facility Documentation Requirements"
                  icon={Building2}
                  badge={step1Facility.missing > 0 ? `${step1Facility.missing} still needed` : "All documented"}
                  badgeVariant={step1Facility.missingCritical > 0 ? "destructive" : step1Facility.missing > 0 ? "warning" : "success"}
                  defaultOpen={step1Facility.missing > 0}
                >
                  <FacilityRequirementsChecklist
                    patient={patientDetail || patient}
                    noteText={note}
                    visitType={visitType}
                  />
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="Medicare compliance checks"
                icon={ShieldCheck}
                summary="What this note is checked against"
                defaultOpen={false}
              >
                <ComplianceChecklist isHospice={isHospice} />
              </CollapsibleSection>

            </div>
          )}

          {step === 2 && (
            <ConstrainedNoteReviewer
              roughNote={note}
              serviceLine={serviceLine}
              visitType={visitType}
              vitals={vitals}
              priorNote={getPriorNote(patientDetail || patient)}
              patient={patientDetail || patient}
              currentUser={currentUser}
              complianceRules={complianceRules}
              onEscalate={escalateToTasks}
              onBack={() => setStep(1)}
              renderFinalNote={(api) => {
                const facilityResults = evaluateFacilityRules({
                  rules: facilityDocRules,
                  patient: patientDetail || patient,
                  noteText: api.finalNote,
                  visitType,
                });
                const facilityMissingCritical = facilityResults.filter(
                  (r) => r.missing && r.rule.severity === "critical",
                );
                const facilityBlocked = facilityMissingCritical.length > 0 && !facilityAck;
                return (
                <>
                  {generatingTasks && (
                    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-sm text-emerald-800">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-600 shrink-0" />
                      Generating follow-up tasks from your note…
                    </div>
                  )}
                  {followUpTasks.length > 0 && (
                    <FollowUpTasksPanel tasks={followUpTasks} onDismiss={() => setFollowUpTasks([])} />
                  )}

                  <FacilityRequirementsChecklist
                    patient={patientDetail || patient}
                    noteText={api.finalNote}
                    visitType={visitType}
                  />

                  {facilityMissingCritical.length > 0 && (
                    <AcknowledgeGate
                      tone="red"
                      title={`Critical facility requirement${facilityMissingCritical.length > 1 ? "s" : ""} not documented`}
                      checked={facilityAck}
                      onCheckedChange={setFacilityAck}
                      label="Add the required detail above, or acknowledge saving without it. This override is recorded."
                    >
                      <ul className="ml-6 list-disc text-sm text-red-800">
                        {facilityMissingCritical.map((r) => (
                          <li key={r.rule.id || r.rule.rule_name}>{r.rule.requirement_label || r.rule.rule_name}</li>
                        ))}
                      </ul>
                    </AcknowledgeGate>
                  )}

                  <SaveBlockers
                    error={saveError}
                    items={[
                      { label: "Fix the fact-check findings above, then re-check.", blocked: !!api.fixRequired },
                      { label: "Select a patient — a note can only be saved to a chart.", blocked: !patientId },
                      { label: "Acknowledge the chart safety conflict.", blocked: !!api.chartRisk?.hasUnacknowledgedCritical },
                      { label: "Acknowledge the denial-risk findings.", blocked: !!api.denialRisk?.hasUnacknowledgedCritical },
                      { label: "Document the critical facility requirement, or acknowledge the override.", blocked: facilityBlocked },
                    ]}
                  />

                  <FinalNoteDisplay
                    finalNote={api.finalNote}
                    setFinalNote={api.setFinalNote}
                    onCopy={async () => {
                      try {
                        await navigator.clipboard.writeText(api.finalNote);
                        setCopied(true); setTimeout(() => setCopied(false), 2500);
                      } catch {
                        setCopied(false);
                        toast.error("Couldn't copy to the clipboard. Select the note text and copy manually.");
                      }
                    }}
                    copied={copied}
                    patient={patient}
                    visitType={visitType}
                    analysisScore={api.coverage}
                    analysis={{ overall_score: api.coverage, compliance_score: api.coverage, findings: buildExportFindings(api.result) }}
                    currentUser={currentUser}
                    onReset={reset}
                    originalNote={note}
                    aiAssisted
                    nurseEdited={api.nurseEdited}
                    handoffStatus={handoff.status}
                    onReportHandoffStatus={reportHandoffStatus}
                    handoffStatusError={handoffError}
                    reviewAck={reviewAck}
                    onReviewAck={(checked) => recordReviewAck(checked, api.finalNote, api.nurseEdited)}
                    onSave={() => {
                      if (facilityBlocked) {
                        toast.error("Document the required facility item(s) or acknowledge the override before saving.");
                        return;
                      }
                      if (facilityMissingCritical.length > 0 && facilityAck) {
                        const unmet = facilityMissingCritical.map((r) => r.rule.rule_name);
                        facilityOverrideRef.current = {
                          acknowledged: true,
                          unmet_requirements: unmet,
                        };
                        logActivity(ActivityActions.NOTE_COMPLIANCE_CHECK, {
                          patientId,
                          facility_override: true,
                          unmet_requirements: unmet,
                        });
                      } else {
                        facilityOverrideRef.current = null;
                      }
                      handleSave(api);
                    }}
                    saving={saving}
                    saved={saved && !api.dirty}
                    saveDisabled={saving || !!api.fixRequired || !patientId || api.chartRisk?.hasUnacknowledgedCritical || api.denialRisk?.hasUnacknowledgedCritical || facilityBlocked}
                  />
                </>
                );
              }}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}