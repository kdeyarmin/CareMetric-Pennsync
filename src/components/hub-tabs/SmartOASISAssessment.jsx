import { useState, useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import PageContainer from "@/components/ui/PageContainer";
import { useIsEmbedded } from "@/components/ui/embeddedPage";
import {
  ChevronDown, ChevronUp, Users, Search, Save, CheckCircle2,
  Loader2, AlertCircle, AlertTriangle, Brain, Activity, ShieldAlert, Lightbulb, Printer
} from "lucide-react";
import { toast } from "sonner";
import { exportToPDF } from "@/components/utils/pdfExporter";
import { evaluateOASIS, computeCareScope } from "@/components/oasis/oasisScoringEngine";
import OASISSuggestionPanel from "@/components/oasis/OASISSuggestionPanel";
import OASISComplianceWarnings, { getComplianceIssues } from "@/components/oasis/OASISComplianceWarnings";
import OASISClinicalReasoningEngine, { getClinicalReasoningIssues } from "@/components/oasis/OASISClinicalReasoningEngine";
import OASISQuestionGuidance from "@/components/oasis/OASISQuestionGuidance";
import { OASIS_SECTIONS } from "@/components/oasis/oasisQuestions";
import { INTERVENTIONS_LIBRARY } from "@/components/carePlan/InterventionLibrary";
import { AssessmentSkeleton } from "@/components/ui/PageSkeleton";

// ─── Question field ───────────────────────────────────────────────────────────
function QuestionField({ question, value, onChange, _onShowGuidance }) {
  const numVal = value !== undefined && value !== "" ? parseInt(value, 10) : undefined;
  const showAlert = question.alert && numVal !== undefined && numVal >= question.alert.threshold;

  if (question.type === "select") {
    return (
      <select
        value={value ?? ""}
        onChange={e => onChange(question.id, e.target.value === "" ? "" : parseInt(e.target.value, 10))}
        className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-400 outline-none bg-white"
      >
        {question.options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    );
  }

  return (
    <div className="space-y-1.5">
      {question.options.map(opt => {
        const isSelected = numVal === opt.value;
        return (
          <label key={opt.value}
            className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${isSelected ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-200" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50"}`}
          >
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-indigo-500 bg-indigo-500" : "border-slate-300"}`}>
              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
            </div>
            <span className="text-sm text-slate-700">{opt.label}</span>
            <input type="radio" className="hidden" checked={isSelected} onChange={() => onChange(question.id, opt.value)} />
          </label>
        );
      })}
      {showAlert && (
        <div className="flex items-start gap-2 mt-2 p-2.5 bg-amber-50 border border-amber-300 rounded-lg">
          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800 font-medium">{question.alert.message}</p>
        </div>
      )}
    </div>
  );
}

// ─── Section card ─────────────────────────────────────────────────────────────
function SectionCard({ section, answers, onChange, onShowGuidance }) {
  const [open, setOpen] = useState(true);
  const answeredCount = section.questions.filter(q => answers[q.id] !== undefined && answers[q.id] !== "").length;

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
      >
        <span className="text-xl leading-none">{section.icon}</span>
        <span className="text-sm font-bold text-slate-800 flex-1 text-left">{section.title}</span>
        <span className="text-xs text-slate-400">{answeredCount}/{section.questions.length} answered</span>
        <div className={`w-4 h-4 rounded-full border-2 ml-1 flex items-center justify-center ${answeredCount === section.questions.length ? "border-green-500 bg-green-500" : "border-slate-300"}`}>
          {answeredCount === section.questions.length && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <div className="divide-y divide-slate-100">
          {section.questions.map(q => (
            <div key={q.id} className="px-4 py-4">
              <div className="mb-2">
                <button
                  onClick={() => onShowGuidance(q.id, q.label)}
                  className="text-left w-full hover:bg-indigo-50 -mx-2 px-2 py-1 rounded-lg transition-colors group"
                >
                  <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-700 flex items-center gap-2">
                    {q.label}
                    <Lightbulb className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-500" />
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-relaxed group-hover:text-indigo-600">
                    {q.description} • Click for real-world scenarios & guidance
                  </p>
                </button>
              </div>
              <QuestionField question={q} value={answers[q.id]} onChange={onChange} onShowGuidance={onShowGuidance} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Patient Picker ───────────────────────────────────────────────────────────
function PatientPicker({ patients, selectedPatientId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = patients.find(p => p.id === selectedPatientId);
  const filtered = patients.filter(p => `${p.first_name} ${p.last_name}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
      >
        <Users className="w-4 h-4 text-slate-400" />
        <span className={selected ? "text-slate-800 font-medium" : "text-slate-400"}>
          {selected ? `${selected.first_name} ${selected.last_name}` : "Select Patient"}
        </span>
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50">
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search patients..."
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map(p => (
              <button key={p.id} onClick={() => { onSelect(p.id); setOpen(false); setSearch(""); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 ${selectedPatientId === p.id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-700"}`}
              >
                <div className="font-medium">{p.first_name} {p.last_name}</div>
                {p.primary_diagnosis && <div className="text-xs text-slate-400 truncate">{p.primary_diagnosis}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Right Panel (tabbed: Recommendations | Compliance) ──────────────────────
function RightPanel({ suggestions, complianceIssues, reasoningIssues, onAddToCarePlan, addedIds }) {
  const criticalCount = complianceIssues.filter(r => r.severity === "critical").length;
  const reasoningCount = reasoningIssues.length;

  return (
    <div className="w-80 flex-shrink-0 bg-white border-l border-slate-200 flex flex-col overflow-hidden">
      <Tabs defaultValue="recommendations" className="flex flex-col flex-1 overflow-hidden">
        <TabsList className="flex-shrink-0 rounded-none border-b border-slate-200 bg-slate-50 h-auto p-0">
          <TabsTrigger value="recommendations" className="flex-1 rounded-none py-2.5 text-xs font-semibold data-[state=active]:border-b-2 data-[state=active]:border-indigo-600 data-[state=active]:text-indigo-700">
            <Brain className="w-3.5 h-3.5 mr-1.5" /> AI Recommendations
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex-1 rounded-none py-2.5 text-xs font-semibold data-[state=active]:border-b-2 data-[state=active]:border-red-500 data-[state=active]:text-red-700 relative">
            <ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Compliance
            {criticalCount > 0 && (
              <span className="ml-1 bg-red-500 text-white text-[10px] rounded-full px-1.5 py-0.5">{criticalCount}</span>
            )}
          </TabsTrigger>
          <TabsTrigger value="reasoning" className="flex-1 rounded-none py-2.5 text-xs font-semibold data-[state=active]:border-b-2 data-[state=active]:border-amber-500 data-[state=active]:text-amber-700 relative">
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5" /> Logic Check
            {reasoningCount > 0 && (
              <span className="ml-1 bg-amber-500 text-white text-[10px] rounded-full px-1.5 py-0.5">{reasoningCount}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="flex-1 overflow-hidden flex flex-col mt-0 data-[state=inactive]:hidden">
          <div className="flex-shrink-0 px-4 pt-2 pb-1 bg-gradient-to-r from-indigo-50 to-navy-50 border-b">
            <p className="text-xs text-slate-400">Updates live as you complete the assessment</p>
          </div>
          <div className="flex-1 overflow-hidden flex flex-col">
            <OASISSuggestionPanel suggestions={suggestions} onAddToCarePlan={onAddToCarePlan} addedIds={addedIds} />
          </div>
        </TabsContent>

        <TabsContent value="compliance" className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden">
          <OASISComplianceWarnings issues={complianceIssues} />
        </TabsContent>

        <TabsContent value="reasoning" className="flex-1 overflow-y-auto mt-0 data-[state=inactive]:hidden">
          <OASISClinicalReasoningEngine issues={reasoningIssues} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SmartOASISAssessment() {
  // When rendered as the "Assessment" tab of the OASIS Center hub, drop the
  // standalone PageContainer and shrink the fixed full-screen height to fit under
  // the hub's header + tab strip (otherwise the split-pane overflows the viewport).
  const embedded = useIsEmbedded();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState({});
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addedToCarePlan, setAddedToCarePlan] = useState([]);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
  const [currentGuidance, setCurrentGuidance] = useState({ questionId: null, questionLabel: "" });

  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ["patients-list"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 100),
    initialData: [],
  });

  const { data: _existingCarePlans = [] } = useQuery({
    queryKey: ["care-plans", selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId,
    initialData: [],
  });

  const handleAnswer = useCallback((questionId, value) => {
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  }, []);

  const handleShowGuidance = useCallback((questionId, questionLabel) => {
    setCurrentGuidance({ questionId, questionLabel });
    setGuidanceOpen(true);
  }, []);

  const suggestions = useMemo(() => evaluateOASIS(answers), [answers]);
  const careScope = useMemo(() => computeCareScope(answers), [answers]);
  const complianceIssues = useMemo(() => getComplianceIssues(answers), [answers]);
  const reasoningIssues = useMemo(() => getClinicalReasoningIssues(answers), [answers]);

  const answeredTotal = Object.values(answers).filter(v => v !== "" && v !== undefined).length;
  const totalQuestions = OASIS_SECTIONS.reduce((sum, s) => sum + s.questions.length, 0);
  const completionPct = Math.round((answeredTotal / totalQuestions) * 100);

  const handleAddToCarePlan = async (interventionIds) => {
    if (!selectedPatientId) { toast.error("Please select a patient first."); return; }
    const newInterventions = interventionIds.filter(id => !addedToCarePlan.includes(id));
    if (newInterventions.length === 0) return;
    setSaving(true);
    try {
      const allItems = INTERVENTIONS_LIBRARY.flatMap(cat => cat.items);
      const toAdd = newInterventions.map(id => allItems.find(i => i.id === id)).filter(Boolean);
      await Promise.all(toAdd.map(item =>
        base44.entities.CarePlan.create({
          patient_id: selectedPatientId,
          problem: item.name,
          goal: `Achieve and maintain ${item.name.toLowerCase()} goals as documented in the care plan.`,
          interventions: [item.description],
          status: "active",
        })
      ));
      setAddedToCarePlan(prev => [...new Set([...prev, ...newInterventions])]);
      queryClient.invalidateQueries({ queryKey: ["care-plans", selectedPatientId] });
      toast.success(`${newInterventions.length} intervention${newInterventions.length > 1 ? "s" : ""} added to care plan!`);
    } catch (err) {
      console.error("Failed to add interventions to care plan:", err);
      toast.error("Failed to add interventions to care plan. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAssessment = async () => {
    if (!selectedPatientId) { toast.error("Please select a patient first."); return; }
    setSaving(true);
    try {
      await base44.entities.Patient.update(selectedPatientId, {
        care_type: careScope === "hospice" ? "hospice" : "home_health",
      });
      await base44.entities.OASISAssessment.create({
        patient_id: selectedPatientId,
        visit_type: "Start of Care",
        oasis_items: Object.entries(answers).map(([item_number, response]) => ({
          item_number, response: String(response), ai_suggested: false, manually_edited: true,
        })),
        status: "completed",
        completed_date: new Date().toISOString(),
      });
      toast.success("OASIS assessment saved successfully.");
    } catch (err) {
      // Don't leave the Save button stuck on the spinner with the completed
      // Start-of-Care assessment silently unsaved.
      console.error("Failed to save OASIS assessment:", err);
      toast.error("Failed to save assessment. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const careScopeBadge = {
    home_health: { label: "Home Health", color: "bg-blue-100 text-blue-800 border-blue-200" },
    hospice: { label: "Hospice", color: "bg-navy-100 text-navy-800 border-navy-200" },
    both: { label: "Home Health + Hospice", color: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  };

  // Build a printable PDF that lists every OASIS item with the response captured
  // here, so the nurse can use it as a side-by-side guide when transcribing the
  // assessment into the EMR.
  const handleExportPDF = async () => {
    if (!selectedPatientId) { toast.error("Please select a patient first."); return; }
    setExporting(true);
    try {
      const selectedPatient = patients.find(p => p.id === selectedPatientId);
      const patientName = selectedPatient
        ? `${selectedPatient.first_name} ${selectedPatient.last_name}`.trim()
        : "";

      const toNum = (v) => (typeof v === "number" ? v : parseInt(v, 10));
      // A select's first option (value 0, "Select …") is a placeholder prompt,
      // not a real response — don't count it as answered or print it as one.
      const isAnswered = (q) => {
        const val = answers[q.id];
        if (val === undefined || val === "") return false;
        if (q.type === "select") {
          const placeholder = q.options[0];
          if (placeholder && /^select/i.test(placeholder.label) && toNum(val) === placeholder.value) {
            return false;
          }
        }
        return true;
      };
      const responseLabel = (q) => {
        if (!isAnswered(q)) return "— Not answered —";
        const opt = q.options.find(o => o.value === toNum(answers[q.id]));
        return opt ? opt.label : String(answers[q.id]);
      };

      const exportAnswered = OASIS_SECTIONS.reduce(
        (n, s) => n + s.questions.filter(isAnswered).length, 0,
      );
      if (exportAnswered === 0) {
        toast.error("Answer at least one OASIS item before printing the guide.");
        return;
      }
      const exportPct = Math.round((exportAnswered / totalQuestions) * 100);

      const content = [
        { type: "text", text: `Patient: ${patientName || "—"}` },
        { type: "text", text: `Suggested Care Scope: ${careScopeBadge[careScope].label}` },
        { type: "text", text: `Items Answered: ${exportAnswered} of ${totalQuestions} (${exportPct}%)` },
        { type: "spacer", height: 2 },
        {
          type: "text",
          text: "Transcribe each OASIS item below into your EMR. Verify every response against your clinical findings before submission — care-scope and AI suggestions are estimates, not an official OASIS determination.",
        },
        { type: "line" },
      ];

      OASIS_SECTIONS.forEach(section => {
        content.push({ type: "heading", text: section.title, size: 12 });
        content.push({
          type: "table",
          headers: ["OASIS Item", "Selected Response"],
          rows: section.questions.map(q => [q.label, responseLabel(q)]),
        });
        content.push({ type: "spacer", height: 3 });
      });

      if (complianceIssues.length > 0) {
        content.push({ type: "pageBreak" });
        content.push({ type: "heading", text: "Compliance Flags to Review", size: 14 });
        content.push({
          type: "table",
          headers: ["Severity", "CMS Ref", "Flag"],
          rows: complianceIssues.map(i => [
            i.severity,
            i.cms_ref || "",
            `${i.title} — ${i.message}`,
          ]),
        });
      }

      const safeName =
        (patientName || "Patient").replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "Patient";
      const dateStr = new Date().toISOString().slice(0, 10);
      await exportToPDF({
        filename: `OASIS_Guide_${safeName}_${dateStr}.pdf`,
        title: "OASIS Data Entry Guide",
        subtitle: patientName || "Smart OASIS Assessment",
        content,
      });
      toast.success("OASIS guide PDF downloaded — open it to print.");
    } catch (err) {
      console.error("Failed to export OASIS guide PDF:", err);
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setExporting(false);
    }
  };

  if (patientsLoading) return <AssessmentSkeleton />;

  const shell = (
    <div className={`flex flex-col overflow-hidden ${embedded ? "h-[calc(100vh-13rem)] min-h-[34rem] rounded-lg border border-slate-200" : "h-[calc(100vh-4rem)]"}`}>
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-indigo-600" />
          <span className="text-sm font-bold text-slate-800">Smart OASIS Assessment</span>
        </div>

        <PatientPicker
          patients={patients}
          selectedPatientId={selectedPatientId}
          onSelect={(id) => { setSelectedPatientId(id); setAddedToCarePlan([]); }}
        />

        {answeredTotal > 0 && (
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-400">Suggested Care Scope:</span>
            <span className={`text-xs font-semibold border rounded-full px-2.5 py-0.5 ${careScopeBadge[careScope].color}`}>
              {careScopeBadge[careScope].label}
            </span>
          </div>
        )}

        {/* Compliance critical badge in header */}
        {complianceIssues.filter(r => r.severity === "critical").length > 0 && (
          <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
            <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
            <span className="text-xs font-semibold text-red-700">
              {complianceIssues.filter(r => r.severity === "critical").length} compliance flag{complianceIssues.filter(r => r.severity === "critical").length > 1 ? "s" : ""}
            </span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-3">
          {reasoningIssues.length > 0 && (
            <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-xs font-semibold text-amber-700">
                {reasoningIssues.length} logic check{reasoningIssues.length > 1 ? "s" : ""}
              </span>
            </div>
          )}
          {/* Progress bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${completionPct}%` }} />
            </div>
            <span className="text-xs text-slate-400">{completionPct}%</span>
          </div>
          <Button size="sm" variant="outline" onClick={handleExportPDF} disabled={exporting || answeredTotal === 0 || !selectedPatientId}>
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Printer className="w-3.5 h-3.5 mr-1.5" />}
            Print Guide
          </Button>
          <Button size="sm" onClick={handleSaveAssessment} disabled={saving || answeredTotal === 0 || !selectedPatientId}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Save className="w-3.5 h-3.5 mr-1.5" />}
            Save Assessment
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left — OASIS Questions */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {OASIS_SECTIONS.map(section => (
            <SectionCard 
              key={section.id} 
              section={section} 
              answers={answers} 
              onChange={handleAnswer}
              onShowGuidance={handleShowGuidance}
            />
          ))}
        </div>

        {/* Right — tabbed panel */}
        <RightPanel
          suggestions={suggestions}
          complianceIssues={complianceIssues}
          reasoningIssues={reasoningIssues}
          onAddToCarePlan={handleAddToCarePlan}
          addedIds={addedToCarePlan}
        />
      </div>

      {/* Question Guidance Dialog */}
      <OASISQuestionGuidance
        questionId={currentGuidance.questionId}
        questionLabel={currentGuidance.questionLabel}
        isOpen={guidanceOpen}
        onClose={() => setGuidanceOpen(false)}
      />
    </div>
  );

  return embedded ? shell : <PageContainer>{shell}</PageContainer>;
}