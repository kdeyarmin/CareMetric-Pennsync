import { useState, useRef, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Loader2, ArrowRight, ClipboardList, User,
  Mic, Square, AlertTriangle
} from "lucide-react";
import { todayEastern } from "../components/utils/timezone";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import { enhanceTranscription } from "../components/utils/medicalDictionary";
import SmartNoteHeader from "../components/smartNote/SmartNoteHeader";
import VisitSummaryGenerator from "../components/smartNote/VisitSummaryGenerator";
import NoteTemplateSelector from "../components/smartNote/NoteTemplateSelector";
import VitalSignValidator from "../components/smartNote/VitalSignValidator";
import VitalSignsForm from "../components/visit/VitalSignsForm";
import StructuredNoteDrafter from "../components/smartNote/StructuredNoteDrafter";
import VisitAudioRecorder from "../components/smartNote/VisitAudioRecorder";
import VitalsTrendAnalysis from "../components/smartNote/VitalsTrendAnalysis";
import FinalNoteDisplay from "../components/smartNote/FinalNoteDisplay";
import FollowUpTasksPanel from "../components/smartNote/FollowUpTasksPanel";
import ComplianceChecklist from "../components/smartNote/ComplianceChecklist";
import ConstrainedNoteReviewer from "../components/smartNote/ConstrainedNoteReviewer";
import { persistVisitNote } from "../components/smartNote/persistVisitNote";
import { getPriorNote, parseNoteSections } from "../components/smartNote/noteHelpers";
import { claimDictation, releaseDictation } from "@/components/smartNote/dictationController";
import { generateFollowUpTasks } from "@/functions/generateFollowUpTasks";
import { analyzeVisitForSupplyUsage } from "@/functions/analyzeVisitForSupplyUsage";
import { toast } from "sonner";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";

const HOME_HEALTH_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine SN Visit" },
  { value: "admission", label: "Start of Care (SOC)" },
  { value: "recertification", label: "Recertification" },
  { value: "discharge", label: "Discharge" },
  { value: "prn", label: "PRN Visit" },
];

const HOSPICE_VISIT_TYPES = [
  { value: "routine_visit", label: "Routine Hospice Visit" },
  { value: "admission", label: "Hospice Admission" },
  { value: "recertification", label: "Recertification (Benefit Period)" },
  { value: "discharge", label: "Discharge / Revocation" },
  { value: "prn", label: "After-Hours / Crisis Visit" },
];

// Returns the right visit types based on care scope
const getVisitTypes = (careScope) => {
  if (careScope === "hospice") return HOSPICE_VISIT_TYPES;
  if (careScope === "both") return [...HOME_HEALTH_VISIT_TYPES, ...HOSPICE_VISIT_TYPES.filter(v => !HOME_HEALTH_VISIT_TYPES.find(h => h.value === v.value))];
  return HOME_HEALTH_VISIT_TYPES;
};

// Drafts are saved per patient (plus an "unassigned" bucket for notes typed
// before a patient is picked) so switching patients never clobbers another
// patient's in-progress note.
const draftKeyFor = (pid) => `smart_note_draft_v2:${pid || "unassigned"}`;

import StepIndicator from "../components/smartNote/StepIndicator";
import SmartNoteTabs from "../components/smartNote/SmartNoteTabs";
import PageContainer from "@/components/ui/PageContainer";
import { HideWhenEmbedded } from "@/components/ui/embeddedPage";

export default function SmartNoteAssistant({ visitId = null }) {
  const [searchParams] = useSearchParams();
  const queryPatientId = searchParams.get("patientId") || searchParams.get("patient_id") || "";
  const queryVisitType = searchParams.get("visitType") || searchParams.get("visit_type") || "";
  const referralDraftNote = useMemo(() => {
    if (searchParams.get("referral_mode") !== "true") return "";
    // The prepopulation payload (PHI) is passed via sessionStorage keyed by
    // referral id, not the URL, so it can't leak into history/proxy logs.
    const referralId = searchParams.get("referral_id");
    if (!referralId) return "";
    try {
      const raw = sessionStorage.getItem(`referral_prepopulate:${referralId}`);
      if (!raw) return "";
      const parsed = JSON.parse(raw);
      return String(parsed.roughNote || "").trim();
    } catch {
      return "";
    }
  }, [searchParams]);
  const [patientId, setPatientId] = useState(queryPatientId);
  const [visitType, setVisitType] = useState(queryVisitType || "routine_visit");
  const visitDate = todayEastern();
  const [note, setNote] = useState(referralDraftNote);
  // Structured vital signs (canonical vital_signs shape) saved onto the visit so
  // they reach the chart, trends, and escalation — restoring the capture the
  // retired Document Visit page provided.
  const [vitals, setVitals] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedVisitId, setSavedVisitId] = useState(null);
  const [savedAuditId, setSavedAuditId] = useState(null);
  // When documenting a specific existing visit (deep-linked via ?visitId), the
  // save COMPLETES that visit instead of creating a new one. Cleared once bound or
  // when the user switches to a different patient than the bound visit's.
  const [existingVisitId, setExistingVisitId] = useState(null);
  const boundPatientRef = useRef(null);
  const [step, setStep] = useState(1);
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState(false);
  const [activeTab, setActiveTab] = useState("builder");
  const [draftRestored, setDraftRestored] = useState(false);
  const [signatureImage, setSignatureImage] = useState(null);
  const [followUpTasks, setFollowUpTasks] = useState([]);
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const recRef = useRef(null);
  const recStopRef = useRef(null);
  const textareaRef = useRef(null);
  const SAVED_PATIENT_KEY = "smart_note_patient_v1";
  // Mirror the latest patient so the autosave effect can write under the active
  // patient without re-subscribing on patientId (which would clobber drafts on
  // switch). prevPatientRef drives the on-switch draft swap. noteRef guards the
  // async durable-draft restore from clobbering text the nurse has started typing.
  const patientIdRef = useRef(patientId);
  const prevPatientRef = useRef(patientId);
  const noteRef = useRef(note);
  patientIdRef.current = patientId;
  noteRef.current = note;

  // Durable cross-session restore: a draft persisted to IndexedDB survives a full
  // browser restart (sessionStorage does not). Apply it only if we're still on
  // the same bucket and the nurse hasn't already started typing.
  const tryRestoreDurableDraft = (pid) => {
    import('@/lib/indexedDB')
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

  // Clear a patient's draft from both stores once the note is saved or reset, so
  // drafts don't accumulate (one PHI-bearing row per patient) indefinitely.
  const clearDraft = (pid) => {
    sessionStorage.removeItem(draftKeyFor(pid));
    import('@/lib/indexedDB')
      .then(({ deleteDraftNoteLocally }) => deleteDraftNoteLocally(`draft_${pid || 'unassigned'}`))
      .catch(() => {});
  };

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const careScope = currentUser?.care_scope || "home_health";
  const VISIT_TYPES = getVisitTypes(careScope);
  const isHospice = careScope === "hospice";
  const serviceLine = isHospice ? "hospice" : "home_health";
  const { data: patients = [] } = useQuery({
    queryKey: ["patients"],
    queryFn: async () => {
        try {
            return await base44.entities.Patient.filter({ status: "active" }, "first_name", 200);
        } catch (e) {
            if (!navigator.onLine) {
                const { getPatientsLocally } = await import('@/lib/indexedDB');
                const local = await getPatientsLocally();
                return local || [];
            }
            throw e;
        }
    }
  });
  const patient = patients.find(p => p.id === patientId);
  // Full record for the selected patient (the list query may not include the
  // note history). Used to pre-fill carry-forward answers from the last visit.
  const { data: patientDetail } = useQuery({
    queryKey: ["patientDetail", patientId],
    queryFn: () => base44.entities.Patient.get(patientId),
    enabled: !!patientId,
  });
  useEffect(() => {
    if (currentUser?.email) logActivity(ActivityActions.PAGE_VISIT, { page: "SmartNoteAssistant" });
  }, [currentUser?.email]);

  // Visit binding: when deep-linked with ?visitId (e.g. from a compliance alert or
  // the patient's visit list), load that visit and pre-select its patient + visit
  // type so saving COMPLETES it rather than creating a duplicate. Vitals are left
  // for the nurse to enter fresh (the scheduled visit has none yet).
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
  }, [boundVisit]);

  // Restore saved patient context across tabs
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
      } catch {}
    }
  }, [queryPatientId, queryVisitType]);

  // Persist patient context across tabs
  useEffect(() => {
    sessionStorage.setItem(SAVED_PATIENT_KEY, JSON.stringify({ patientId, visitType }));
  }, [patientId, visitType]);

  // On first mount, restore the draft for whatever bucket we start in (the saved
  // patient, or the unassigned bucket) so an in-progress note survives a reload.
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

  // When the selected patient changes, load that patient's saved draft (resume
  // where you left off). The outgoing patient's note was already autosaved under
  // their own key, so switching never loses or cross-contaminates a draft. When
  // arriving from the no-patient-yet state with a note already typed, carry it
  // over (migrate) instead of wiping it.
  useEffect(() => {
    const prev = prevPatientRef.current;
    if (prev === patientId) return;
    prevPatientRef.current = patientId;
    // Vitals are per-visit, not part of the draft store — clear them on a patient
    // switch so one patient's readings never carry onto another's chart.
    setVitals({});
    // Drop the visit binding if the nurse switches to a different patient than the
    // bound visit's — so the save can't complete the wrong patient's visit.
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
      // Switching between two real patients and the incoming one has no session
      // draft — clear, then check the durable store (covers a post-restart switch
      // where the only copy of their draft is in IndexedDB).
      setNote("");
      setDraftRestored(false);
      tryRestoreDurableDraft(patientId);
    }
    // else: came from the unassigned bucket with nothing saved — keep the typed
    // note so it isn't lost; it will autosave under the newly-selected patient.
  }, [patientId]);

  // Autosave under the ACTIVE patient (via ref) — deliberately not keyed on
  // patientId, so a patient switch never writes the old note under the new key.
  useEffect(() => {
    if (!note.trim()) return;
    const pid = patientIdRef.current;
    sessionStorage.setItem(draftKeyFor(pid), JSON.stringify({ note, visitType, patientId: pid }));
    import('@/lib/indexedDB').then(({ saveDraftNoteLocally }) => {
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
    // Stop any per-question dictation mic first — only one recognizer at a time.
    claimDictation(stop);
    rec.start();
    setListening(true);
  };
  const stopDictation = () => { recRef.current?.stop(); setListening(false); releaseDictation(recStopRef.current); };

  // Step 1 → 2. The deterministic scan + questions + generation + fact-check all
  // live in <ConstrainedNoteReviewer>, which scans `note` on mount.
  const startReview = () => {
    if (!note || note.trim().length < 20) return;
    setSaved(false);
    setSavedVisitId(null);
    setSavedAuditId(null);
    setStep(2);
  };

  // Save to the patient's chart. Re-verifies any edits first (via the reviewer),
  // then persists — updating the same Visit on re-save so editing never creates a
  // duplicate. Optional: the note is fully usable (copy/PDF) without saving.
  const handleSave = async (api) => {
    if (!patientId || !currentUser?.email) {
      toast.error("Select a patient to save this note to their chart.");
      return;
    }
    if (api.chartRisk?.hasUnacknowledgedCritical) {
      toast.error("Acknowledge the chart safety conflict before saving to the chart.");
      return;
    }
    setSaving(true);
    try {
      let result = api.result;
      if (api.dirty) {
        result = await api.recheck();
        if (!result) { setSaving(false); return; } // fact-check failed → reviewer shows the fix panel
      }
      await persistNote(result);
      setSaved(true);
      // The work is now persisted (online) or queued (offline) — drop the local
      // draft so it doesn't linger as stale PHI for this patient.
      clearDraft(patientId);
    } catch (err) {
      console.error("Save to chart error:", err);
      toast.error("Saving to the chart failed.");
    } finally {
      setSaving(false);
    }
  };

  // Create-or-update the chart records from the reviewer's save-ready result via
  // the shared persistVisitNote helper (also used by the Visit Scribe audio flow),
  // then run the host-only follow-up (state + task/supply analysis) on a fresh save.
  const persistNote = async (result) => {
    const out = await persistVisitNote({
      result, patientId, visitDate, visitType, roughNote: note, vitals,
      currentUser, patientDiagnosis: patientDetail?.primary_diagnosis || patient?.primary_diagnosis || "",
      savedVisitId, savedAuditId, existingVisitId,
    });
    if (!out) return;
    if (out.mode === 'create') {
      setSavedVisitId(out.visitId);
      // The visit (new or the just-completed bound one) is now the same-session
      // target, so further re-saves go through the savedVisitId update path.
      setExistingVisitId(null);
      // Remember the audit so a later re-save updates it in place.
      if (out.auditId) setSavedAuditId(out.auditId);
      generateTasksFromNote(out.finalText, out.visitId);
      analyzeSupplyUsage(out.finalText, out.visitId);
    }
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

  const reset = () => {
    setNote(""); setSaved(false); setSavedVisitId(null); setSavedAuditId(null);
    setStep(1); setDraftRestored(false); setSignatureImage(null); setFollowUpTasks([]);
    setVitals({}); setExistingVisitId(null);
    clearDraft(patientIdRef.current);
  };

  // Turn critical chart conflicts / vitals flagged in the reviewer into high-
  // priority provider follow-up tasks. A critical follow-up must never be lost,
  // so offline (or on a failed create) it is queued to the offline sync drain
  // instead of being dropped.
  const escalateToTasks = async (items) => {
    if (!items?.length || !currentUser?.email) return;
    const payloads = items.map((it) => ({
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
    const queueForSync = async (toQueue) => {
      const { addToSyncQueue } = await import('@/lib/indexedDB');
      await Promise.all(toQueue.map((p) => addToSyncQueue('CREATE_TASK', p)));
    };

    // Offline: queue everything; the OfflineManager drain creates them on reconnect.
    if (!navigator.onLine) {
      try {
        await queueForSync(payloads);
        setFollowUpTasks((prev) => [...payloads, ...prev]);
        toast.success(`Saved ${payloads.length} follow-up task${payloads.length !== 1 ? "s" : ""} offline — will sync when reconnected.`);
      } catch (err) {
        console.error("Failed to queue escalation task(s):", err);
        toast.error("Couldn't save the follow-up task offline.");
      }
      return;
    }

    // Online: create each individually so a partial failure can't re-create the
    // ones that already succeeded (Promise.all would reject the whole batch and
    // the retry would duplicate the successes).
    const results = await Promise.allSettled(payloads.map((p) => base44.entities.Task.create(p)));
    const created = [];
    const failed = [];
    results.forEach((r, i) => (r.status === "fulfilled" ? created.push(r.value) : failed.push(payloads[i])));
    if (created.length) setFollowUpTasks((prev) => [...created, ...prev]);
    if (!failed.length) {
      toast.success(`Created ${created.length} provider follow-up task${created.length !== 1 ? "s" : ""}.`);
      return;
    }
    // Queue ONLY the failures (a transient 5xx, not necessarily a disconnect),
    // then kick the sync drain so they retry now — not just on the next
    // offline→online transition, which may never come while we stay online.
    console.error("Some escalation task creates failed; queuing for retry:", results.find((r) => r.status === "rejected")?.reason);
    try {
      await queueForSync(failed);
      setFollowUpTasks((prev) => [...failed, ...prev]);
      window.dispatchEvent(new Event('online'));
      toast.message(`Couldn't reach the server for ${failed.length} follow-up task${failed.length !== 1 ? "s" : ""} — saved and retrying.`);
    } catch (err) {
      console.error("Failed to queue failed escalation task(s):", err);
      toast.error("Couldn't save the follow-up task. Try again.");
    }
  };

  const ready = note.trim().length >= 20;

  return (
    <PageContainer>

      <HideWhenEmbedded>
        <SmartNoteHeader careScope={careScope} onReset={reset} step={step} activeTab={activeTab} />
      </HideWhenEmbedded>

      <SmartNoteTabs activeTab={activeTab} setActiveTab={setActiveTab} />

      {/* ── TAB: DRAFT FROM VITALS ── */}
      {activeTab === "drafter" && (
        <StructuredNoteDrafter
          patient={patient}
          onDraftReady={(draft, vType, structuredVitals) => {
            setNote(draft);
            setVisitType(vType);
            // Carry the structured vitals into the same canonical state the main
            // form uses, so they reach the verified pipeline (coverage, trends,
            // critical-vital escalation, chart cross-check) — not just the prose.
            if (structuredVitals) setVitals(structuredVitals);
            setActiveTab("builder");
          }}
        />
      )}

      {/* ── TAB: VISIT SUMMARY ── */}
      {activeTab === "summary" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <VisitSummaryGenerator patientId={patientId} />
        </div>
      )}

      {/* ── TAB: VITAL TRENDS ── */}
      {activeTab === "trends" && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm">
          <VitalsTrendAnalysis patientId={patientId} />
        </div>
      )}



      {/* ── TAB: NOTE BUILDER ── */}
      {activeTab === "builder" && (
        <>
          {draftRestored && (
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <p className="text-xs text-emerald-700 font-medium">Draft restored.</p>
            </div>
          )}

          <StepIndicator step={step} />

          {/* STEP 1: WRITE */}
          {step === 1 && (
            <div className="space-y-3">
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <User className="w-3.5 h-3.5 text-navy-600" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Patient</span>
                    <span className="text-xs text-slate-400 font-normal normal-case ml-1">optional</span>
                  </div>
                  <SearchablePatientSelect
                    patients={patients}
                    value={patientId}
                    onValueChange={setPatientId}
                    className="bg-slate-50 border-slate-200 h-12 sm:h-11 text-sm rounded-xl"
                  />
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
                          style={selected ? { backgroundColor: '#264491', borderColor: '#264491', color: '#ffffff' } : undefined}
                          className={`py-3 sm:py-2 px-2 rounded-xl text-xs font-semibold border-2 transition-all text-center leading-tight min-h-[48px] sm:min-h-0 active:scale-95 ${selected ? "shadow-md" : "bg-slate-50 border-slate-200 text-slate-700 hover:border-navy-300 hover:bg-navy-50"}`}
                        >
                          {v.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {patient && (
                <div className="flex items-center gap-2 text-xs text-navy-700 bg-navy-50 border border-navy-200 rounded-lg px-3 py-2">
                  <User className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    <strong>{patient.first_name} {patient.last_name}</strong>
                    {patient.primary_diagnosis ? ` · ${patient.primary_diagnosis}` : ""}
                    {patient.current_medications?.length > 0 ? ` · ${patient.current_medications.length} meds` : ""}
                    {patient.functional_status?.fall_risk === "high" && <span className="ml-2 inline-flex items-center gap-1 text-rose-600 font-bold"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> High Fall Risk</span>}
                  </span>
                </div>
              )}

              {/* Structured vitals — saved to the visit's vital_signs (feeds the
                  chart, vitals trends, and critical-vitals escalation). */}
              <VitalSignsForm vitalSigns={vitals} onChange={setVitals} />

              <NoteTemplateSelector currentVisitType={visitType} onSelect={(content, type) => {
                setNote(content); setVisitType(type);
                setTimeout(() => textareaRef.current?.focus(), 100);
              }} />

              <ComplianceChecklist isHospice={isHospice} />

              <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-100">
                  <span className="text-xs font-semibold text-navy-700">Your Rough Notes / Bullet Points</span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-navy-600 hover:text-navy-800"
                    onClick={() => { setActiveTab("drafter"); }}>
                    <ClipboardList className="w-3.5 h-3.5" /> Use Structured Form
                  </Button>
                </div>
                {/* Voice input — one consolidated group: speak live, or record &
                    transcribe. All paths append your own words to the draft below;
                    none rewrite or embellish it. */}
                <div className="px-4 py-2 bg-navy-50 border-b border-navy-100">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Mic className="w-3 h-3 text-navy-500" />
                    <span className="text-[11px] font-semibold text-navy-600 uppercase tracking-wide">Voice input — optional</span>
                  </div>
                  <div className="space-y-2">
                    <Button
                      variant={listening ? "destructive" : "default"}
                      className={`h-9 gap-2 text-xs font-semibold shadow-sm ${listening ? 'animate-pulse' : 'bg-navy-600 hover:bg-navy-700 text-white'}`}
                      onClick={listening ? stopDictation : startDictation}
                    >
                      {listening ? <><Square className="w-4 h-4 fill-current" /> Stop Dictation</> : <><Mic className="w-4 h-4" /> Live Dictation</>}
                    </Button>
                    {/* One record-and-transcribe control (Narrative or SOAP). */}
                    <VisitAudioRecorder
                      onTranscribed={(text) => setNote(prev => prev ? prev + "\n\n" + text : text)}
                    />
                  </div>
                </div>
                <textarea ref={textareaRef} value={note} onChange={e => setNote(e.target.value)}
                  placeholder={"Enter bullet points or rough draft — AI will NOT invent information.\n\n• BP 148/90, HR 82, O2 95% RA, pain 3/10\n• homebound: unable to leave without considerable effort\n• skilled need: wound assessment and dressing change\n• wound R heel 2×3 cm granulating, no odor\n• taught med schedule, pt verbalized understanding\n• fall risk — clutter noted, discussed w/ family"}
                  className="w-full min-h-[240px] sm:min-h-[320px] text-sm border-0 px-4 py-3 focus:ring-0 bg-white font-mono resize-none outline-none leading-relaxed" spellCheck={false}
                />
                <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50 gap-3">
                  <span className={`text-xs shrink-0 ${ready ? "text-emerald-600 font-medium" : "text-slate-400"}`}>
                    {ready ? `${note.length} chars — ready` : `${20 - note.trim().length} more chars needed`}
                  </span>
                  <Button
                    onClick={startReview}
                    disabled={!ready}
                    style={ready ? { backgroundColor: '#264491', color: '#ffffff' } : undefined}
                    className="hover:bg-navy-700 h-11 sm:h-9 px-5 gap-1.5 text-sm font-semibold w-full sm:w-auto"
                  >
                    <ClipboardList className="w-4 h-4" /> Review & Complete <ArrowRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>

              <VitalSignValidator noteText={note} />

            </div>
          )}

          {/* STEP 2: QUESTIONS / GENERATE / REVIEW — shared constrained-scribe flow */}
          {step === 2 && (
            <ConstrainedNoteReviewer
              roughNote={note}
              serviceLine={serviceLine}
              visitType={visitType}
              vitals={vitals}
              priorNote={getPriorNote(patientDetail || patient)}
              patient={patientDetail || patient}
              currentUser={currentUser}
              onEscalate={escalateToTasks}
              onBack={() => setStep(1)}
              renderFinalNote={(api) => (
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
                    analysis={{ overall_score: api.coverage, compliance_score: api.coverage, findings: [] }}
                    currentUser={currentUser}
                    signatureImage={signatureImage}
                    setSignatureImage={setSignatureImage}
                    onReset={reset}
                    originalNote={note}
                    noteSections={parseNoteSections(api.finalNote)}
                    onSave={() => handleSave(api)}
                    saving={saving}
                    saved={saved && !api.dirty}
                    saveDisabled={saving || !!(api.fixRequired && !api.fixRequired.offlinePending) || !patientId || api.chartRisk?.hasUnacknowledgedCritical}
                  />
                </>
              )}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}