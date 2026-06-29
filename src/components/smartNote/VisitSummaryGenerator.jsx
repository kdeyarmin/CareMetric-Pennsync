import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Copy, CheckCircle2, ChevronDown, ChevronUp, FileText, User } from "lucide-react";
import { toast } from "sonner";

const SECTIONS = [
  { key: "chief_concern", label: "Chief Concern" },
  { key: "clinical_findings", label: "Clinical Findings" },
  { key: "interventions", label: "Interventions" },
  { key: "patient_response", label: "Patient Response" },
  { key: "education", label: "Education" },
  { key: "plan", label: "Plan / Follow-up" },
  { key: "status", label: "Overall Status" },
];

function SectionBlock({ section, content, copiedKey, onCopy }) {
  const [open, setOpen] = useState(true);
  const isCopied = copiedKey === section.key;
  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex flex-1 items-center text-left cursor-pointer"
        >
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{section.label}</span>
        </button>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onCopy(section.key, content)}
            className="p-1 rounded hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
            title={`Copy ${section.label}`}
            aria-label="Copy summary"
          >
            {isCopied ? <CheckCircle2 className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          {open ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
        </div>
      </div>
      {open && (
        <div className="px-3 py-2.5 text-sm text-slate-700 font-mono leading-relaxed bg-white whitespace-pre-wrap">
          {content || <span className="italic text-slate-400">Not documented</span>}
        </div>
      )}
    </div>
  );
}

export default function VisitSummaryGenerator({ patientId }) {
  const [selectedVisitId, setSelectedVisitId] = useState("");
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [copiedKey, setCopiedKey] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [selectedSections, setSelectedSections] = useState(new Set(SECTIONS.map(s => s.key)));
  const [showSectionPicker, setShowSectionPicker] = useState(false);

  const { data: visits = [] } = useQuery({
    queryKey: ["patient-visits-for-summary", patientId],
    queryFn: () => patientId
      ? base44.entities.Visit.filter({ patient_id: patientId }, "-visit_date", 20)
      : base44.entities.Visit.list("-visit_date", 20),
    enabled: true,
  });

  const { data: patient } = useQuery({
    queryKey: ["patient-for-summary", patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }, "-created_date", 1).then(r => r[0]),
    enabled: !!patientId,
  });

  const selectedVisit = visits.find(v => v.id === selectedVisitId);

  const generate = async () => {
    if (!selectedVisit) return;
    const transcript = selectedVisit.nurse_notes || selectedVisit.raw_transcription;
    if (!transcript) return;
    setSummary(null);
    try {
      const ctx = patient
        ? `Patient: ${patient.first_name} ${patient.last_name}, DOB: ${patient.date_of_birth || "?"}, Dx: ${patient.primary_diagnosis || "?"}`
        : "";
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical documentation specialist. Generate a structured patient visit summary from this nursing note/transcript.

VISIT TRANSCRIPT:
${transcript}

${ctx}
VISIT TYPE: ${selectedVisit.visit_type}
VISIT DATE: ${selectedVisit.visit_date}

Extract and structure into these exact sections. Be concise and clinical.

Return JSON with these keys:
- chief_concern: main reason for this visit, patient's presenting complaints
- clinical_findings: vital signs with interpretation, physical assessment findings, wound status if any
- interventions: nursing interventions performed during visit
- patient_response: how patient responded to interventions/education/treatment
- education: what was taught, teach-back results, understanding level
- plan: follow-up plan, next visit instructions, referrals, physician notification
- status: one sentence overall patient status (stable/improving/declining + brief rationale)
- condition: "stable"|"improving"|"declining"|"critical"`,
        response_json_schema: {
          type: "object",
          properties: {
            chief_concern: { type: "string" },
            clinical_findings: { type: "string" },
            interventions: { type: "string" },
            patient_response: { type: "string" },
            education: { type: "string" },
            plan: { type: "string" },
            status: { type: "string" },
            condition: { type: "string" },
          }
        }
      });
      setSummary(result);
    } catch {
      toast.error("Failed to generate summary. Please try again.");
    }
  };

  const copySection = async (key, content) => {
    try {
      await navigator.clipboard.writeText(content || "");
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setCopiedKey(null);
      toast.error("Couldn't copy to the clipboard. Select the text and copy manually.");
    }
  };

  const copySelected = async () => {
    const text = SECTIONS
      .filter(s => selectedSections.has(s.key) && summary?.[s.key])
      .map(s => `${s.label}:\n${summary[s.key]}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setCopiedAll(false);
      toast.error("Couldn't copy to the clipboard. Select the text and copy manually.");
      return;
    }
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const toggleSection = (key) => {
    setSelectedSections(prev => {
      const n = new Set(prev);
      n.has(key) ? n.delete(key) : n.add(key);
      return n;
    });
  };

  const conditionColor = {
    stable: "bg-green-100 text-green-800",
    improving: "bg-blue-100 text-blue-800",
    declining: "bg-orange-100 text-orange-800",
    critical: "bg-red-100 text-red-800",
  };

  const hasTranscript = selectedVisit && (selectedVisit.nurse_notes || selectedVisit.raw_transcription);

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-navy-600" />
        <h3 className="text-sm font-bold text-slate-800">Visit Summary Generator</h3>
        <Badge className="bg-navy-100 text-navy-700 text-xs">AI</Badge>
      </div>
      <p className="text-xs text-slate-500">Select a completed visit to generate a structured summary from its transcript.</p>

      {/* Visit selector */}
      <Select value={selectedVisitId} onValueChange={setSelectedVisitId}>
        <SelectTrigger className="bg-white h-10 text-sm">
          <SelectValue placeholder="Select a visit…" />
        </SelectTrigger>
        <SelectContent>
          {visits.map(v => (
            <SelectItem key={v.id} value={v.id}>
              {v.visit_date} — {(v.visit_type || "").replace(/_/g, " ")}
              {(v.nurse_notes || v.raw_transcription) ? " ✓" : " (no transcript)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedVisit && !hasTranscript && (
        <p className="text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
          This visit has no recorded notes or transcript. Select a visit with completed documentation.
        </p>
      )}

      {selectedVisit && hasTranscript && !summary && !ai.loading && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-2 text-xs text-indigo-700 mb-1">
            <User className="w-3.5 h-3.5" />
            <strong>{selectedVisit.visit_date}</strong> · {selectedVisit.visit_type?.replace(/_/g, " ")}
          </div>
          <p className="text-xs text-indigo-600 line-clamp-2 font-mono">
            {(selectedVisit.nurse_notes || selectedVisit.raw_transcription)?.substring(0, 150)}…
          </p>
        </div>
      )}

      <Button
        onClick={generate}
        disabled={!hasTranscript || ai.loading}
        className="w-full bg-navy-600 hover:bg-navy-700 h-9 gap-2 text-sm font-semibold"
      >
        {ai.loading
          ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Summary…</>
          : <><Sparkles className="w-4 h-4" /> Generate Visit Summary</>}
      </Button>

      {/* Summary output */}
      {summary && (
        <div className="space-y-3">
          {/* Header bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <span className="text-sm font-semibold text-slate-800">Summary Ready</span>
              {summary.condition && (
                <Badge className={`text-xs ${conditionColor[summary.condition] || "bg-slate-100 text-slate-800"}`}>
                  {summary.condition}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSectionPicker(s => !s)}
                className="text-xs text-indigo-600 hover:text-indigo-800 underline"
              >
                {showSectionPicker ? "Hide" : "Select"} sections
              </button>
              <Button
                size="sm"
                className="h-7 bg-green-600 hover:bg-green-700 gap-1 text-xs"
                onClick={copySelected}
              >
                {copiedAll ? <><CheckCircle2 className="w-3.5 h-3.5" /> Copied!</> : <><Copy className="w-3.5 h-3.5" /> Copy Selected</>}
              </Button>
            </div>
          </div>

          {/* Section picker */}
          {showSectionPicker && (
            <div className="flex flex-wrap gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-lg">
              {SECTIONS.map(s => (
                <button
                  key={s.key}
                  onClick={() => toggleSection(s.key)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${selectedSections.has(s.key) ? "bg-indigo-600 text-white" : "bg-white border border-slate-300 text-slate-600 hover:border-indigo-400"}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          {/* Section blocks */}
          <div className="space-y-2">
            {SECTIONS.map(s => (
              <SectionBlock
                key={s.key}
                section={s}
                content={summary[s.key]}
                copiedKey={copiedKey}
                onCopy={copySection}
              />
            ))}
          </div>

          {/* Overall status callout */}
          {summary.status && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 italic">
              <strong>Overall:</strong> {summary.status}
            </div>
          )}
        </div>
      )}
    </div>
  );
}