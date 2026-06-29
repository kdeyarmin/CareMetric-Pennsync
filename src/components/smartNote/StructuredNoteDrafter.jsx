import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Copy, CheckCircle2, ClipboardList, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import VoiceNoteIntegration from "./VoiceNoteIntegration";
import { toCanonicalVitalSigns, extractCanonicalVitalsFromText } from "./compliance/factExtraction";

const VISIT_TYPES = [
  { value: "routine_visit", label: "Routine Visit" },
  { value: "admission", label: "Admission" },
  { value: "recertification", label: "Recertification" },
  { value: "discharge", label: "Discharge" },
  { value: "prn", label: "PRN Visit" },
];

const BLANK_VITALS = {
  bp_systolic: "", bp_diastolic: "", heart_rate: "", resp_rate: "",
  o2_sat: "", temperature: "", weight: "", pain_level: ""
};

export default function StructuredNoteDrafter({ onDraftReady }) {
  const [visitType, setVisitType] = useState("routine_visit");
  const [vitals, setVitals] = useState(BLANK_VITALS);
  const [symptoms, setSymptoms] = useState("");
  const [interventions, setInterventions] = useState("");
  const [education, setEducation] = useState("");
  const [plan, setPlan] = useState("");
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const symptomsRef = useRef(null);
  const interventionsRef = useRef(null);
  const educationRef = useRef(null);
  const planRef = useRef(null);

  const setVital = (k, v) => setVitals(prev => ({ ...prev, [k]: v }));

  const hasContent = symptoms.trim() || Object.values(vitals).some(v => v.trim());

  // Deterministically assemble the nurse's structured input into a rough draft.
  // No LLM and no fabricated defaults for blank fields — the compliant narrative
  // and the value-guard/grounding fact-check happen in the Note Builder when
  // "Use in Note Builder" runs.
  const generate = () => {
    if (!hasContent) return;
    const vitalsLine = [
      vitals.bp_systolic && vitals.bp_diastolic ? `BP ${vitals.bp_systolic}/${vitals.bp_diastolic} mmHg` : null,
      vitals.heart_rate ? `HR ${vitals.heart_rate} bpm` : null,
      vitals.resp_rate ? `RR ${vitals.resp_rate} breaths/min` : null,
      vitals.o2_sat ? `O2 sat ${vitals.o2_sat}%` : null,
      vitals.temperature ? `Temp ${vitals.temperature}°F` : null,
      vitals.weight ? `Weight ${vitals.weight} lbs` : null,
      vitals.pain_level ? `Pain ${vitals.pain_level}/10` : null,
    ].filter(Boolean).join(", ");

    const lines = [
      vitalsLine ? `Vitals: ${vitalsLine}.` : null,
      symptoms.trim() ? `Symptoms / chief complaint: ${symptoms.trim()}.` : null,
      interventions.trim() ? `Interventions performed: ${interventions.trim()}.` : null,
      education.trim() ? `Patient education: ${education.trim()}.` : null,
      plan.trim() ? `Plan: ${plan.trim()}.` : null,
    ].filter(Boolean);

    setDraft(lines.join("\n"));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Couldn't copy to the clipboard. Select the text and copy manually.");
    }
  };

  const useInNoteBuilder = () => {
    if (!onDraftReady) return;
    // Vitals must reach the verified pipeline (vital_signs field, coverage,
    // escalation). Source them from the (possibly hand-edited) draft TEXT first so
    // an in-text correction wins over the grid; fall back to the grid only for a
    // field the nurse removed from the text. This prevents a stale grid value from
    // overriding an edit and being saved as the chart's vital_signs.
    const fromText = extractCanonicalVitalsFromText(draft) || {};
    const fromGrid = toCanonicalVitalSigns(vitals) || {};
    const merged = { ...fromGrid, ...fromText }; // both omit absent fields, so text wins per-key
    const structuredVitals = Object.keys(merged).length ? merged : null;
    // The pipeline appends the BP/HR/RR/O2/temp/pain values verbatim via
    // formatVitalsSentence, so strip the drafter's own "Vitals:" line to avoid
    // duplicating them. Weight isn't carried by formatVitalsSentence — preserve it
    // (text first, then grid) as its own line so it isn't lost.
    let handoff = draft.replace(/^Vitals:.*$/m, "").replace(/\n{3,}/g, "\n\n").trim();
    const gridWeight = vitals.weight && String(vitals.weight).trim() !== "" ? parseFloat(vitals.weight) : null;
    // Capture the weight value AND its unit from the SAME match (mirroring the
    // regex extractVitals uses) so a documented kg reading is normalized to lbs —
    // and so a stray "kg" elsewhere in the draft can't rescale a pounds value.
    // Falls back to the grid weight (already in lbs) when the text has no weight.
    const wtMatch = draft.match(/(?:wt|weight)\s*:?\s*(\d{2,3}(?:\.\d)?)\s*(lbs?|kg)?/i);
    let weight = gridWeight;
    if (wtMatch) {
      weight = parseFloat(wtMatch[1]);
      if (/^kg$/i.test(wtMatch[2] || "")) weight = Math.round(weight * 2.20462 * 10) / 10;
    }
    if (weight) handoff = `${handoff}\nWeight: ${weight} lbs.`.trim();
    onDraftReady(handoff, visitType, structuredVitals);
  };

  const handleInsertVoiceText = (field, text) => {
    const fieldRefs = {
      symptoms: { ref: symptomsRef, state: symptoms, setState: setSymptoms },
      interventions: { ref: interventionsRef, state: interventions, setState: setInterventions },
      education: { ref: educationRef, state: education, setState: setEducation },
      plan: { ref: planRef, state: plan, setState: setPlan },
    };

    const fieldConfig = fieldRefs[field];
    if (!fieldConfig) return;

    const newValue = fieldConfig.state ? fieldConfig.state + ' ' + text : text;
    fieldConfig.setState(newValue);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 bg-gradient-to-r from-navy-50 to-navy-100 border-b border-navy-100 flex items-center justify-between"
        onClick={() => setCollapsed(v => !v)}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-navy-600" />
          <span className="text-sm font-bold text-navy-800">Structured Note Drafter</span>
          <Badge className="bg-navy-100 text-navy-700 text-xs">Structured</Badge>
        </div>
        {collapsed ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronUp className="w-4 h-4 text-slate-400" />}
      </button>

      {!collapsed && (
        <div className="p-4 space-y-4">
          <p className="text-xs text-slate-500">Fill in structured fields to build a rough draft from exactly what you enter, then run the full compliance check in the Note Builder.</p>

          {/* Visit Type */}
          <div>
            <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">Visit Type</Label>
            <Select value={visitType} onValueChange={setVisitType}>
              <SelectTrigger className="h-9 text-sm bg-slate-50">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VISIT_TYPES.map(v => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Vitals grid */}
          <div>
            <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-1.5 block">Vital Signs</Label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { key: "bp_systolic", placeholder: "Systolic", label: "BP Sys" },
                { key: "bp_diastolic", placeholder: "Diastolic", label: "BP Dia" },
                { key: "heart_rate", placeholder: "bpm", label: "HR" },
                { key: "resp_rate", placeholder: "br/min", label: "RR" },
                { key: "o2_sat", placeholder: "%", label: "O2 Sat" },
                { key: "temperature", placeholder: "°F", label: "Temp" },
                { key: "weight", placeholder: "lbs", label: "Weight" },
                { key: "pain_level", placeholder: "0-10", label: "Pain" },
              ].map(f => (
                <div key={f.key}>
                  <Label className="text-xs text-slate-500 mb-0.5 block">{f.label}</Label>
                  <Input
                    value={vitals[f.key]}
                    onChange={e => setVital(f.key, e.target.value)}
                    placeholder={f.placeholder}
                    className="h-8 text-sm bg-slate-50"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Text fields */}
          {[
            { label: "Symptoms / Chief Complaint", val: symptoms, set: setSymptoms, ref: symptomsRef, fieldName: "symptoms", placeholder: "e.g., Patient complains of increased shortness of breath on exertion, bilateral ankle edema noted..." },
            { label: "Interventions Performed", val: interventions, set: setInterventions, ref: interventionsRef, fieldName: "interventions", placeholder: "e.g., Wound assessment and dressing change to right heel, medication reconciliation reviewed..." },
            { label: "Patient Education", val: education, set: setEducation, ref: educationRef, fieldName: "education", placeholder: "e.g., Educated on medication schedule and signs of infection; patient verbalized understanding..." },
            { label: "Plan / Follow-up", val: plan, set: setPlan, ref: planRef, fieldName: "plan", placeholder: "e.g., Continue wound care every visit, notify physician if wound deteriorates, next visit in 3 days..." },
          ].map(f => (
            <div key={f.label}>
              <div className="flex items-center justify-between mb-1.5">
                <Label className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{f.label}</Label>
                <VoiceNoteIntegration
                  onInsertText={(text) => handleInsertVoiceText(f.fieldName, text)}
                  disabled={false}
                />
              </div>
              <textarea
                ref={f.ref}
                value={f.val}
                onChange={e => f.set(e.target.value)}
                placeholder={f.placeholder}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:ring-2 focus:ring-navy-300 focus:border-navy-400 outline-none resize-none min-h-[70px] leading-relaxed"
              />
            </div>
          ))}

          <Button
            onClick={generate}
            disabled={!hasContent}
            className="w-full bg-navy-600 hover:bg-navy-700 h-10 gap-2 font-semibold"
          >
            <Sparkles className="w-4 h-4" /> Build Draft from Fields
          </Button>

          {/* Draft output */}
          {draft && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-500" />
                  <span className="text-sm font-semibold text-slate-800">Draft Ready</span>
                </div>
                <div className="flex gap-2">
                  {onDraftReady && (
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={useInNoteBuilder}>
                      <Sparkles className="w-3 h-3" /> Use in Note Builder
                    </Button>
                  )}
                  <Button size="sm" className="h-7 bg-green-600 hover:bg-green-700 gap-1 text-xs" onClick={copy}>
                    {copied ? <><CheckCircle2 className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </Button>
                </div>
              </div>
              <textarea
                value={draft}
                onChange={e => setDraft(e.target.value)}
                className="w-full min-h-[200px] text-sm font-mono border border-slate-200 rounded-lg px-3 py-2.5 bg-white focus:ring-2 focus:ring-navy-300 outline-none resize-none"
              />
              <p className="text-xs text-slate-400 italic">Review and edit before using. Click "Use in Note Builder" to run full compliance check.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}