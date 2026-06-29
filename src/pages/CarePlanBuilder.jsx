import { useState, useCallback } from "react";
import { DragDropContext } from "@hello-pangea/dnd";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import PageContainer from "@/components/ui/PageContainer";
import {
  Save, RotateCcw, FileText, CheckSquare, Users,
  Sparkles, ChevronDown, Loader2, CheckCircle2, Search
} from "lucide-react";
import { toast } from "sonner";
import { INTERVENTIONS_LIBRARY } from "@/components/carePlan/InterventionLibrary";
import InterventionLibrary from "@/components/carePlan/InterventionLibrary";
import CarePlanCanvas from "@/components/carePlan/CarePlanCanvas";
import InterventionDetailPanel from "@/components/carePlan/InterventionDetailPanel";
import AICarePlanAnalyzer from "@/components/carePlan/AICarePlanAnalyzer";

function findLibraryItem(id) {
  for (const cat of INTERVENTIONS_LIBRARY) {
    const found = cat.items.find(i => i.id === id);
    if (found) return { ...found, categoryId: cat.id };
  }
  return null;
}

export default function CarePlanBuilder() {
  const [planItems, setPlanItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [linkedPathways, setLinkedPathways] = useState({});
  const [selectedPatientId, setSelectedPatientId] = useState("");
  const [planName, setPlanName] = useState("New Care Plan");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);
  const [careType, setCareType] = useState("home_health");
  const [showAIAnalyzer, setShowAIAnalyzer] = useState(false);
  const [assessmentData, _setAssessmentData] = useState(null);

  const { data: patients = [] } = useQuery({
    queryKey: ["patients-list"],
    queryFn: () => base44.entities.Patient.list("-updated_date", 100),
    initialData: [],
  });

  const { data: _currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  const filteredPatients = patients.filter(p => {
    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
    return name.includes(patientSearch.toLowerCase());
  });

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  const onDragEnd = useCallback((result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    // Dragging from library to canvas
    if (source.droppableId.startsWith("library-") && destination.droppableId === "care-plan-canvas") {
      const itemId = draggableId;
      if (planItems.some(i => i.id === itemId)) {
        toast.success("This intervention is already in the plan.");
        return;
      }
      const item = findLibraryItem(itemId);
      if (!item) return;

      setPlanItems(prev => {
        const next = [...prev];
        next.splice(destination.index, 0, item);
        return next;
      });
      return;
    }

    // Reordering within the canvas
    if (source.droppableId === "care-plan-canvas" && destination.droppableId === "care-plan-canvas") {
      // draggableId is "plan-<itemId>" when on canvas
      const realId = draggableId.replace(/^plan-/, "");
      setPlanItems(prev => {
        const next = [...prev];
        const srcIdx = prev.findIndex(i => i.id === realId);
        if (srcIdx === -1) return prev;
        const [moved] = next.splice(srcIdx, 1);
        next.splice(destination.index, 0, moved);
        return next;
      });
    }
  }, [planItems]);

  const removeItem = useCallback((id) => {
    setPlanItems(prev => prev.filter(i => i.id !== id));
    setLinkedPathways(prev => { const n = { ...prev }; delete n[id]; return n; });
    setSelectedItem(prev => prev?.id === id ? null : prev);
  }, []);

  const linkPathway = useCallback((itemId, pathway) => {
    setLinkedPathways(prev => ({ ...prev, [itemId]: pathway }));
    toast.success(`Linked to: ${pathway}`);
  }, []);

  const handleSave = async () => {
    if (!selectedPatientId) { toast.error("Please select a patient first."); return; }
    if (planItems.length === 0) { toast.error("Add at least one intervention."); return; }

    setSaving(true);
    try {
      const existingPlans = await base44.entities.CarePlan.filter({ patient_id: selectedPatientId });

      const _interventionsWithPathways = planItems.map(item => ({
        id: item.id,
        name: item.name,
        description: item.description,
        frequency: item.frequency,
        complianceTag: item.complianceTag,
        linkedPathway: linkedPathways[item.id] || null,
      }));

      // Save as a batch of CarePlan records (one per intervention with a unique problem)
      const savePromises = planItems.map(item => {
        const existingForItem = existingPlans.find(p => p.problem === item.name);
        const data = {
          patient_id: selectedPatientId,
          problem: item.name,
          goal: `Achieve and maintain ${item.name.toLowerCase()} goals as documented in the care plan.`,
          interventions: [item.description, linkedPathways[item.id] ? `Clinical Pathway: ${linkedPathways[item.id]}` : null].filter(Boolean),
          frequency: item.frequency,
          status: "active",
        };
        if (existingForItem) {
          return base44.entities.CarePlan.update(existingForItem.id, data);
        }
        return base44.entities.CarePlan.create(data);
      });

      await Promise.all(savePromises);
      setSaved(true);
      toast.success(`Care plan saved — ${planItems.length} interventions for ${selectedPatient?.first_name} ${selectedPatient?.last_name}`);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      toast.error("Failed to save care plan.");
    }
    setSaving(false);
  };

  const handleClear = () => {
    setPlanItems([]);
    setLinkedPathways({});
    setSelectedItem(null);
    setSaved(false);
  };

  const linkedCount = Object.keys(linkedPathways).length;
  const complianceCount = planItems.filter(i => i.complianceTag).length;

  return (
    <PageContainer>
    <div className="flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Top Bar */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <FileText className="w-5 h-5 text-indigo-600 flex-shrink-0" />
          <Input
            value={planName}
            onChange={e => setPlanName(e.target.value)}
            className="h-8 text-sm font-semibold border-0 shadow-none px-0 bg-transparent focus-visible:ring-0 max-w-xs"
          />
        </div>

        {/* Patient Selector */}
        <div className="relative">
          <button
            onClick={() => setShowPatientDropdown(!showPatientDropdown)}
            className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
          >
            <Users className="w-4 h-4 text-slate-500" />
            <span className={selectedPatient ? "text-slate-800 font-medium" : "text-slate-400"}>
              {selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : "Select Patient"}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          </button>

          {showPatientDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50">
              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                  <input
                    value={patientSearch}
                    onChange={e => setPatientSearch(e.target.value)}
                    placeholder="Search patients..."
                    className="w-full text-sm pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-400"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto py-1">
                {filteredPatients.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-slate-400">No patients found</div>
                ) : (
                  filteredPatients.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPatientId(p.id); setShowPatientDropdown(false); setPatientSearch(""); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 transition-colors ${selectedPatientId === p.id ? "bg-indigo-50 text-indigo-700 font-medium" : "text-slate-700"}`}
                    >
                      <div className="font-medium">{p.first_name} {p.last_name}</div>
                      {p.primary_diagnosis && <div className="text-xs text-slate-400 truncate">{p.primary_diagnosis}</div>}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 border-x border-slate-200 px-3">
          <span className="flex items-center gap-1">
            <CheckSquare className="w-3.5 h-3.5 text-indigo-500" />
            <span><strong className="text-slate-700">{planItems.length}</strong> interventions</span>
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span><strong className="text-slate-700">{complianceCount}</strong> compliant</span>
          </span>
          <span className="flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-navy-500" />
            <span><strong className="text-slate-700">{linkedCount}</strong> linked</span>
          </span>
        </div>

        {/* Care Type Selector */}
        <div className="relative">
          <select
            value={careType}
            onChange={(e) => setCareType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors bg-white"
          >
            <option value="home_health">Home Health</option>
            <option value="hospice">Hospice</option>
          </select>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowAIAnalyzer(!showAIAnalyzer)} className="gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            AI Analyzer
          </Button>
          <Button variant="outline" size="sm" onClick={handleClear} disabled={planItems.length === 0}>
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            Clear
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !selectedPatientId || planItems.length === 0}>
            {saving ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Saving...</>
            ) : saved ? (
              <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Saved!</>
            ) : (
              <><Save className="w-3.5 h-3.5 mr-1.5" /> Save Plan</>
            )}
          </Button>
        </div>
      </div>

      {/* AI Analyzer Panel */}
      {showAIAnalyzer && (
        <div className="flex-shrink-0 w-96 border-l border-slate-200 bg-white overflow-y-auto p-4">
          <AICarePlanAnalyzer
            patientId={selectedPatientId}
            patientName={selectedPatient ? `${selectedPatient.first_name} ${selectedPatient.last_name}` : ""}
            diagnosis={selectedPatient?.primary_diagnosis}
            careType={careType}
            assessmentData={assessmentData}
            onInterventionsGenerated={(interventions, schedule) => {
              toast.success(`Generated ${interventions.length} interventions with ${schedule.routine_frequency} visit schedule`);
            }}
          />
        </div>
      )}

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden" onClick={() => showPatientDropdown && setShowPatientDropdown(false)}>
        <DragDropContext onDragEnd={onDragEnd}>
          <InterventionLibrary />
          <CarePlanCanvas
            planItems={planItems}
            onRemove={removeItem}
            onSelectItem={setSelectedItem}
            selectedItemId={selectedItem?.id}
            linkedPathways={linkedPathways}
          />
        </DragDropContext>
        <InterventionDetailPanel
          item={selectedItem}
          linkedPathway={selectedItem ? linkedPathways[selectedItem.id] : null}
          onLinkPathway={linkPathway}
          onClose={() => setSelectedItem(null)}
        />
      </div>
    </div>
    </PageContainer>
  );
}