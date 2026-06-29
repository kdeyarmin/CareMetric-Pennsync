import { useState, useCallback, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AICarePlanSuggestionEngine from "../components/carePlan/AICarePlanSuggestionEngine";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Target,
  Search,
  TrendingUp,
  CheckCircle2,
  Trash2,
  User,
  Sparkles,
  Plus,
  ChevronDown
} from "lucide-react";
import { format, addDays } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import AICarePlanRecommendations from "../components/carePlan/AICarePlanRecommendations";
import AutomatedTaskGenerator from "../components/carePlan/AutomatedTaskGenerator";
import CarePlanTimeline from "../components/carePlan/CarePlanTimeline";
import AIEducationRecommender from "../components/carePlan/AIEducationRecommender";
import EducationTracker from "../components/carePlan/EducationTracker";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { DragDropContext } from "@hello-pangea/dnd";
import { INTERVENTIONS_LIBRARY } from "@/components/carePlan/InterventionLibrary";
import InterventionLibrary from "@/components/carePlan/InterventionLibrary";
import CarePlanCanvas from "@/components/carePlan/CarePlanCanvas";
import InterventionDetailPanel from "@/components/carePlan/InterventionDetailPanel";
import AICarePlanAnalyzer from "@/components/carePlan/AICarePlanAnalyzer";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function CarePlanManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showAITools, setShowAITools] = useState(false);
  const [viewMode, setViewMode] = useState("list"); // "list" or "timeline"
  const [activeTab, setActiveTab] = useState("list");
  const [builderPatient, setBuilderPatient] = useState(null);
  const [planToDelete, setPlanToDelete] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Log page visit
  useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'CarePlanManagement',
        page_title: 'Care Plan Management'
      });
    }
  }, [currentUser?.email]);

  // Fetch only patients the user has charted on
  const { data: myVisits = [] } = useQuery({
    queryKey: ['myVisits'],
    queryFn: () => currentUser ? base44.entities.Visit.filter({ created_by: currentUser.email }) : Promise.resolve([]),
    enabled: !!currentUser,
    initialData: [],
  });

  const myPatientIds = useMemo(
    () => [...new Set(myVisits.map(v => v.patient_id))],
    [myVisits]
  );

  // Fetch all care plans
  const { data: carePlans = [], isLoading } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list('-created_date', 500),
    initialData: [],
  });

  // Load patients for BOTH the user's charted patients AND every patient that
  // has a care plan in the list. Previously only charted patients were loaded,
  // so any care plan whose patient the user hadn't charted on was silently
  // dropped from the grouped view (getPatient() returned undefined). Union the
  // two id sets so no plan disappears.
  const visiblePatientIds = useMemo(
    () => [...new Set([...myPatientIds, ...carePlans.map(cp => cp.patient_id)])].filter(Boolean),
    [myPatientIds, carePlans]
  );

  const { data: patients = [] } = useQuery({
    queryKey: ['carePlanPatients', visiblePatientIds],
    queryFn: async () => {
      if (visiblePatientIds.length === 0) return [];
      const allPatients = await base44.entities.Patient.list('-updated_date', 2000);
      return allPatients.filter(p => visiblePatientIds.includes(p.id));
    },
    enabled: visiblePatientIds.length > 0,
    initialData: [],
  });

  // Fetch visits for selected patient
  const { data: patientVisits = [] } = useQuery({
    queryKey: ['patientVisits', selectedPatient?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatient?.id }, '-visit_date', 10),
    enabled: !!selectedPatient?.id,
    initialData: [],
  });

  // Update care plan status
  const updateCarePlanMutation = useMutation({
    mutationFn: ({ id, updates }) => base44.entities.CarePlan.update(id, updates),
    onSuccess: (updatedPlan, variables) => {
      queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
      
      // Log care plan update
      logActivity(ActivityActions.CARE_PLAN_UPDATE, {
        entity_type: 'CarePlan',
        entity_id: variables.id,
        updates: variables.updates,
        page: 'CarePlanManagement'
      });
    },
  });

  // Delete care plan
  const deleteCarePlanMutation = useMutation({
    mutationFn: (id) => base44.entities.CarePlan.delete(id),
    onSuccess: (_, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
      
      // Log care plan deletion
      logActivity(ActivityActions.DELETE, {
        entity_type: 'CarePlan',
        entity_id: deletedId,
        page: 'CarePlanManagement'
      });
    },
  });

  // Get patient by ID
  const getPatient = (patientId) => {
    return patients.find(p => p.id === patientId);
  };

  // Filter care plans
  const filteredCarePlans = (carePlans || []).filter(plan => {
    if (!plan) return false;
    const patient = getPatient(plan.patient_id);
    const searchLower = (searchTerm || '').toLowerCase();
    const matchesSearch = !searchTerm || 
      (plan.problem || '').toLowerCase().includes(searchLower) ||
      (plan.goal || '').toLowerCase().includes(searchLower) ||
      (patient?.first_name || '').toLowerCase().includes(searchLower) ||
      (patient?.last_name || '').toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter === "all" || plan.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  // Group by patient
  const groupedByPatient = filteredCarePlans.reduce((acc, plan) => {
    const patientId = plan.patient_id;
    if (!acc[patientId]) {
      acc[patientId] = [];
    }
    acc[patientId].push(plan);
    return acc;
  }, {});

  const handleStatusChange = (planId, newStatus) => {
    updateCarePlanMutation.mutate({
      id: planId,
      updates: { status: newStatus }
    });
  };

  const handleDelete = (planId) => {
    setPlanToDelete(planId);
  };

  const handleAcceptRecommendation = async (recommendation) => {
    if (!selectedPatient) return;

    try {
      const targetDate = format(addDays(new Date(), recommendation.target_days || 60), 'yyyy-MM-dd');
      
      const newCarePlan = await base44.entities.CarePlan.create({
        patient_id: selectedPatient.id,
        problem: recommendation.problem,
        goal: recommendation.goal,
        interventions: recommendation.interventions,
        baseline_measurement: recommendation.baseline_measurement,
        frequency: recommendation.frequency,
        target_date: targetDate,
        status: 'active'
      });

      // Auto-create education assignments if topics provided
      if (recommendation.education_topics?.length > 0) {
        for (const topic of recommendation.education_topics) {
          await base44.entities.PatientEducationAssignment.create({
            patient_id: selectedPatient.id,
            care_plan_id: newCarePlan.id,
            topic: topic,
            content: `Education on ${topic} for ${selectedPatient.primary_diagnosis}`,
            format: 'handout',
            status: 'assigned',
            assigned_date: new Date().toISOString().split('T')[0],
            assigned_by: 'AI System'
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
      queryClient.invalidateQueries({ queryKey: ['patientEducation'] });
      
      // Log care plan creation from AI recommendation
      logActivity(ActivityActions.CARE_PLAN_CREATE, {
        entity_type: 'CarePlan',
        entity_id: newCarePlan.id,
        patient_id: selectedPatient.id,
        problem: recommendation.problem,
        source: 'ai_recommendation',
        page: 'CarePlanManagement'
      });
      
      toast.success('Care plan created successfully with education materials!');
    } catch (error) {
      console.error('Error creating care plan:', error);
      toast.error('Failed to create care plan. Please try again.');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-emerald-500';
      case 'met': return 'bg-blue-500';
      case 'not_met': return 'bg-red-500';
      case 'revised': return 'bg-amber-500';
      default: return 'bg-slate-500';
    }
  };

  // Calculate statistics
  const totalPlans = carePlans.length;
  const activePlans = carePlans.filter(p => p.status === 'active').length;
  const metGoals = carePlans.filter(p => p.status === 'met').length;
  const activePatients = Object.keys(groupedByPatient).length;

  // Care Plan Builder state
  const [planItems, setPlanItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [linkedPathways, setLinkedPathways] = useState({});
  const [planName, setPlanName] = useState("New Care Plan");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [careType, setCareType] = useState("home_health");
  const [showAIAnalyzer, setShowAIAnalyzer] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [showPatientDropdown, setShowPatientDropdown] = useState(false);

  function findLibraryItem(id) {
    for (const cat of INTERVENTIONS_LIBRARY) {
      const found = cat.items.find(i => i.id === id);
      if (found) return { ...found, categoryId: cat.id };
    }
    return null;
  }

  const onDragEnd = useCallback((result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

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

    if (source.droppableId === "care-plan-canvas" && destination.droppableId === "care-plan-canvas") {
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

  const handleSaveBuilder = async () => {
    if (!builderPatient) { toast.error("Please select a patient first."); return; }
    if (planItems.length === 0) { toast.error("Add at least one intervention."); return; }

    setSaving(true);
    try {
      const existingPlans = await base44.entities.CarePlan.filter({ patient_id: builderPatient.id });
      const savePromises = planItems.map(item => {
        const existingForItem = existingPlans.find(p => p.problem === item.name);
        const data = {
          patient_id: builderPatient.id,
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
      queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
      toast.success(`Care plan saved — ${planItems.length} interventions for ${builderPatient.first_name} ${builderPatient.last_name}`);
      setTimeout(() => {
        setSaved(false);
        setActiveTab("list");
        setPlanItems([]);
        setLinkedPathways({});
      }, 2000);
    } catch {
      toast.error("Failed to save care plan.");
    }
    setSaving(false);
  };

  const handleClearBuilder = () => {
    setPlanItems([]);
    setLinkedPathways({});
    setSelectedItem(null);
    setSaved(false);
  };

  const linkedCount = Object.keys(linkedPathways).length;
  const complianceCount = planItems.filter(i => i.complianceTag).length;

  const BuilderTab = () => (
    <div className="flex flex-col h-[calc(100vh-16rem)] overflow-hidden">
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Target className="w-5 h-5 text-navy-600 flex-shrink-0" />
            <Input
              value={planName}
              onChange={e => setPlanName(e.target.value)}
              className="h-8 text-sm font-semibold border-0 shadow-none px-0 bg-transparent focus-visible:ring-0 max-w-xs"
            />
          </div>

          <div className="relative">
            <button
              onClick={() => setShowPatientDropdown(!showPatientDropdown)}
              className="flex items-center gap-2 text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors"
            >
              <User className="w-4 h-4 text-slate-500" />
              <span className={builderPatient ? "text-slate-800 font-medium" : "text-slate-400"}>
                {builderPatient ? `${builderPatient.first_name} ${builderPatient.last_name}` : "Select Patient"}
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
                  {patients.filter(p => {
                    const name = `${p.first_name} ${p.last_name}`.toLowerCase();
                    return name.includes(patientSearch.toLowerCase());
                  }).map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setBuilderPatient(p); setShowPatientDropdown(false); setPatientSearch(""); }}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-navy-50 transition-colors ${builderPatient?.id === p.id ? "bg-navy-50 text-indigo-700 font-medium" : "text-slate-700"}`}
                    >
                      <div className="font-medium">{p.first_name} {p.last_name}</div>
                      {p.primary_diagnosis && <div className="text-xs text-slate-400 truncate">{p.primary_diagnosis}</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-3 text-xs text-slate-500 border-x border-slate-200 px-3">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-navy-600" />
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

          <select
            value={careType}
            onChange={(e) => setCareType(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 transition-colors bg-white"
          >
            <option value="home_health">Home Health</option>
            <option value="hospice">Hospice</option>
          </select>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAIAnalyzer(!showAIAnalyzer)} className="gap-1">
              <Sparkles className="w-3.5 h-3.5" />
              AI
            </Button>
            <Button variant="outline" size="sm" onClick={handleClearBuilder} disabled={planItems.length === 0}>
              Clear
            </Button>
            <Button size="sm" onClick={handleSaveBuilder} disabled={saving || !builderPatient || planItems.length === 0}>
              {saving ? "Saving..." : saved ? "Saved!" : "Save Plan"}
            </Button>
          </div>
        </div>

        {showAIAnalyzer && (
          <div className="absolute right-0 top-14 bottom-0 w-96 border-l border-slate-200 bg-white overflow-y-auto p-4 z-10">
            <AICarePlanAnalyzer
              patientId={builderPatient?.id}
              patientName={builderPatient ? `${builderPatient.first_name} ${builderPatient.last_name}` : ""}
              diagnosis={builderPatient?.primary_diagnosis}
              careType={careType}
              onInterventionsGenerated={(interventions, _schedule) => {
                toast.success(`Generated ${interventions.length} interventions`);
              }}
            />
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">
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
    );

  return (
    <PageContainer>
      <PageHeader
        icon={Target}
        eyebrow="Patient Care"
        title="Care Plans"
        description="Manage plans and build new interventions"
        favoritePage="CarePlanManagement"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="list" className="gap-2">
            <Target className="w-4 h-4" />
            Active Plans
          </TabsTrigger>
          <TabsTrigger value="builder" className="gap-2">
            <Plus className="w-4 h-4" />
            Build Plan
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="space-y-4">

      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 md:gap-6 mb-4 sm:mb-6 md:mb-8">
        <Card className="modern-card border-l-4 border-l-navy-600 bg-white shadow-md">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-500 text-xs sm:text-sm font-medium mb-1 truncate">Total Plans</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800">{totalPlans}</p>
              </div>
              <Target className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-navy-500/20 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="modern-card border-l-4 border-l-emerald-500 bg-white shadow-md">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-500 text-xs sm:text-sm font-medium mb-1 truncate">Active Plans</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800">{activePlans}</p>
              </div>
              <TrendingUp className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-emerald-500/20 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="modern-card border-l-4 border-l-navy-500 bg-white shadow-md">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-500 text-xs sm:text-sm font-medium mb-1 truncate">Goals Met</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800">{metGoals}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-navy-500/20 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="modern-card border-l-4 border-l-orange-500 bg-white shadow-md">
          <CardContent className="p-3 sm:p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-500 text-xs sm:text-sm font-medium mb-1 truncate">Patients</p>
                <p className="text-2xl sm:text-3xl md:text-4xl font-bold text-slate-800">{activePatients}</p>
              </div>
              <User className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-orange-500/20 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4 sm:mb-6">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search care plans or patients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 touch-target"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48 h-11 touch-target">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="py-3">All Status</SelectItem>
                  <SelectItem value="active" className="py-3">Active</SelectItem>
                  <SelectItem value="met" className="py-3">Goal Met</SelectItem>
                  <SelectItem value="not_met" className="py-3">Not Met</SelectItem>
                  <SelectItem value="revised" className="py-3">Revised</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  onClick={() => setViewMode("list")}
                  className={`flex-1 sm:flex-none min-h-[44px] ${viewMode === "list" ? "bg-navy-600" : ""}`}
                >
                  List
                </Button>
                <Button
                  variant={viewMode === "timeline" ? "default" : "outline"}
                  onClick={() => setViewMode("timeline")}
                  className={`flex-1 sm:flex-none min-h-[44px] ${viewMode === "timeline" ? "bg-navy-600" : ""}`}
                >
                  Timeline
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI Tools Section */}
      {selectedPatient && showAITools && (
        <div className="space-y-6 mb-6">
          {/* AI Suggestion Engine */}
          <AICarePlanSuggestionEngine
            patientId={selectedPatient.id}
            patientData={selectedPatient}
            diagnosis={selectedPatient.primary_diagnosis}
            existingCarePlans={carePlans.filter(cp => cp.patient_id === selectedPatient.id)}
            onAcceptSuggestion={async (carePlanData, educationTopics) => {
              try {
                const newPlan = await base44.entities.CarePlan.create(carePlanData);
                
                // Auto-assign education materials (independent inserts — create
                // concurrently after the care plan exists).
                if (educationTopics?.length > 0) {
                  await Promise.all(educationTopics.map((topic) =>
                    base44.entities.PatientEducationAssignment.create({
                      patient_id: selectedPatient.id,
                      care_plan_id: newPlan.id,
                      topic: topic,
                      content: `Medicare-compliant education on ${topic} for ${selectedPatient.primary_diagnosis}`,
                      format: 'handout',
                      status: 'assigned',
                      assigned_date: new Date().toISOString().split('T')[0],
                      assigned_by: 'AI Care Plan System',
                      priority: 'high'
                    })
                  ));
                }
                
                queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
                queryClient.invalidateQueries({ queryKey: ['patientEducation'] });
                
                // Log AI care plan creation
                logActivity(ActivityActions.CARE_PLAN_CREATE, {
                  entity_type: 'CarePlan',
                  entity_id: newPlan.id,
                  patient_id: selectedPatient.id,
                  source: 'ai_suggestion_engine',
                  education_topics: educationTopics?.length || 0,
                  page: 'CarePlanManagement'
                });
              } catch (error) {
                console.error('Error creating care plan:', error);
                toast.error('Failed to create care plan. Please try again.');
              }
            }}
            autoGenerate={true}
          />
          
          <div className="grid md:grid-cols-2 gap-6">
            <AICarePlanRecommendations
              patient={selectedPatient}
              visits={patientVisits}
              existingCarePlans={carePlans.filter(cp => cp.patient_id === selectedPatient.id)}
              onAcceptRecommendation={handleAcceptRecommendation}
            />
            <AutomatedTaskGenerator
              patient={selectedPatient}
              carePlans={carePlans.filter(cp => cp.patient_id === selectedPatient.id)}
              onTasksGenerated={() => {
                queryClient.invalidateQueries({ queryKey: ['patientEducation'] });
                toast.success('Tasks created successfully!');
              }}
            />
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            <AIEducationRecommender
              patient={selectedPatient}
              carePlans={carePlans.filter(cp => cp.patient_id === selectedPatient.id)}
              onAssignEducation={() => {
                queryClient.invalidateQueries({ queryKey: ['patientEducation', selectedPatient.id] });
              }}
            />
            <EducationTracker patient={selectedPatient} />
          </div>
        </div>
      )}

      {/* Care Plans by Patient */}
      <div className="space-y-6">
        {isLoading ? (
          <Card>
            <CardContent className="p-12 text-center text-slate-500">
              Loading care plans...
            </CardContent>
          </Card>
        ) : filteredCarePlans.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Target className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-900 mb-2">No care plans found</h3>
              <p className="text-slate-500">Try adjusting your search or filters.</p>
            </CardContent>
          </Card>
        ) : viewMode === "timeline" ? (
          Object.entries(groupedByPatient).map(([patientId, plans]) => {
            const patient = getPatient(patientId);
            if (!patient) return null;

            return (
              <div key={patientId} className="space-y-3">
                <div className="flex items-center gap-3 p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200">
                    <User className="w-6 h-6 text-slate-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-slate-900">
                      {patient.first_name} {patient.last_name}
                    </h3>
                    <p className="text-sm text-slate-600">
                      {patient.primary_diagnosis} • {plans.length} care plan{plans.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={selectedPatient?.id === patientId ? "default" : "outline"}
                      onClick={() => {
                        setSelectedPatient(patient);
                        setShowAITools(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={selectedPatient?.id === patientId ? "bg-navy-600 hover:bg-navy-700" : ""}
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      AI Tools
                    </Button>
                  </div>
                </div>
                <CarePlanTimeline carePlans={plans} patient={patient} />
              </div>
            );
          })
        ) : (
          Object.entries(groupedByPatient).map(([patientId, plans]) => {
            const patient = getPatient(patientId);
            if (!patient) return null;

            return (
              <Card key={patientId} className="modern-card border-l-4 border-l-navy-600 shadow-md">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center border border-slate-200">
                        <User className="w-6 h-6 text-slate-600" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-slate-900">
                          {patient.first_name} {patient.last_name}
                        </h3>
                        <p className="text-sm text-slate-600">
                          {patient.primary_diagnosis} • {plans.length} active care plan{plans.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap sm:flex-nowrap">
                    <Button
                     size="sm"
                     onClick={() => {
                       setBuilderPatient(patient);
                       setActiveTab("builder");
                       setPlanItems([]);
                     }}
                     className="bg-navy-600 hover:bg-navy-700 min-h-[44px]"
                    >
                     <Plus className="w-4 h-4 mr-1" />
                     <span className="hidden sm:inline">Build Plan</span>
                     <span className="sm:hidden">Build</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedPatient?.id === patientId ? "default" : "outline"}
                      onClick={() => {
                        setSelectedPatient(patient);
                        setShowAITools(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`min-h-[44px] ${selectedPatient?.id === patientId ? "bg-navy-600 hover:bg-navy-700" : ""}`}
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      <span className="hidden sm:inline">AI Tools</span>
                      <span className="sm:hidden">AI</span>
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => navigate(`${createPageUrl("PatientDetails")}?patientId=${patientId}`)}
                      variant="outline"
                      className="min-h-[44px]"
                    >
                      <span className="hidden sm:inline">View Patient</span>
                      <span className="sm:hidden">View</span>
                    </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {plans.map((plan) => (
                      <Card key={plan.id} className="bg-slate-50">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-slate-900">{plan.problem}</h4>
                                <Badge className={getStatusColor(plan.status)}>
                                  {(plan.status || '').replace('_', ' ')}
                                </Badge>
                              </div>
                              <p className="text-sm text-slate-600 mb-2">{plan.goal}</p>
                              
                              {plan.interventions && plan.interventions.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-xs font-medium text-slate-700 mb-1">Interventions:</p>
                                  <ul className="list-disc ml-5 text-xs text-slate-600 space-y-0.5">
                                    {plan.interventions.map((intervention, idx) => (
                                      <li key={idx}>{intervention}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="flex gap-4 mt-2 text-xs text-slate-500">
                                {plan.frequency && <span><strong>Frequency:</strong> {plan.frequency}</span>}
                                {plan.target_date && (
                                  <span>
                                    <strong>Target:</strong> {format(new Date(plan.target_date), 'MMM d, yyyy')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex gap-2 pt-3 border-t">
                            <Select
                              value={plan.status}
                              onValueChange={(newStatus) => handleStatusChange(plan.id, newStatus)}
                            >
                              <SelectTrigger className="flex-1 h-11 sm:h-9 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-[50vh]">
                                <SelectItem value="active" className="py-3 sm:py-2">Active</SelectItem>
                                <SelectItem value="met" className="py-3 sm:py-2">Goal Met</SelectItem>
                                <SelectItem value="not_met" className="py-3 sm:py-2">Not Met</SelectItem>
                                <SelectItem value="revised" className="py-3 sm:py-2">Revised</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              variant="outline"
                              onClick={() => handleDelete(plan.id)}
                              className="text-red-600 hover:text-red-700 min-h-[44px] px-3"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
        </TabsContent>

        <TabsContent value="builder">
          {BuilderTab()}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!planToDelete} onOpenChange={(open) => { if (!open) setPlanToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Care Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this care plan? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                deleteCarePlanMutation.mutate(planToDelete);
                setPlanToDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}