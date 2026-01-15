import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import PremiumFeatureGate from "../components/subscription/PremiumFeatureGate";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AICarePlanSuggestionEngine from "../components/carePlan/AICarePlanSuggestionEngine";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Target,
  Search,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Edit,
  Trash2,
  User,
  Calendar,
  ArrowLeft,
  Sparkles
} from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
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
import AICarePlanGenerator from "../components/carePlan/AICarePlanGenerator";
import { logActivity, ActivityActions } from "../components/utils/activityLogger";
import FavoriteButton from "../components/navigation/FavoriteButton";
import CarePlanTemplateSelector from "../components/carePlan/CarePlanTemplateSelector";
import ProgressTracker from "../components/carePlan/ProgressTracker";
import ReviewReminders from "../components/carePlan/ReviewReminders";
import CollaborationPanel from "../components/carePlan/CollaborationPanel";

export default function CarePlanManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showAITools, setShowAITools] = useState(false);
  const [viewMode, setViewMode] = useState("list"); // "list" or "timeline"
  const [showCreatePatient, setShowCreatePatient] = useState(false);
  const [newPatientData, setNewPatientData] = useState({
    first_name: "",
    last_name: "",
    date_of_birth: "",
    medical_record_number: "",
  });
  const [creatingPatient, setCreatingPatient] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  // Log page visit
  React.useEffect(() => {
    if (currentUser?.email) {
      logActivity(ActivityActions.PAGE_VISIT, {
        page: 'CarePlanManagement',
        page_title: 'Care Plan Management'
      });
    }
  }, [currentUser?.email]);

  // Fetch all patients
  const { data: patients = [] } = useQuery({
    queryKey: ['allPatients'],
    queryFn: () => base44.entities.Patient.list(),
    initialData: [],
  });

  // Fetch all care plans
  const { data: carePlans = [], isLoading } = useQuery({
    queryKey: ['allCarePlans'],
    queryFn: () => base44.entities.CarePlan.list('-created_date', 500),
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
    if (window.confirm('Are you sure you want to delete this care plan?')) {
      deleteCarePlanMutation.mutate(planId);
    }
  };

  const createNewPatient = async () => {
    if (!newPatientData.first_name.trim() || !newPatientData.last_name.trim()) {
      toast.error("First and last name are required");
      return;
    }

    setCreatingPatient(true);
    try {
      const created = await base44.entities.Patient.create({
        first_name: newPatientData.first_name,
        last_name: newPatientData.last_name,
        date_of_birth: newPatientData.date_of_birth || null,
        medical_record_number: newPatientData.medical_record_number || "",
      });

      setSelectedPatient(created);
      setShowCreatePatient(false);
      setNewPatientData({
        first_name: "",
        last_name: "",
        date_of_birth: "",
        medical_record_number: "",
      });
      toast.success("Patient created successfully");
      setShowAITools(true);
    } catch (error) {
      toast.error("Failed to create patient");
      console.error(error);
    } finally {
      setCreatingPatient(false);
    }
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
      toast.error('Failed to create care plan. Please try again.');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'met': return 'bg-blue-500';
      case 'not_met': return 'bg-red-500';
      case 'revised': return 'bg-yellow-500';
      default: return 'bg-gray-500';
    }
  };

  // Calculate statistics
  const totalPlans = carePlans.length;
  const activePlans = carePlans.filter(p => p.status === 'active').length;
  const metGoals = carePlans.filter(p => p.status === 'met').length;
  const activePatients = Object.keys(groupedByPatient).length;

  return (
    <PremiumFeatureGate
      featureName="Care Plan Management"
      featureDescription="Create, manage, and optimize patient care plans with AI-powered recommendations. This premium feature includes automated task generation and personalized education planning."
      allowTrial={true}
    >
    <div className="w-full overflow-x-hidden">
      <div className="p-2 sm:p-3 md:p-4 lg:p-6 max-w-7xl mx-auto pb-20 sm:pb-6 overflow-hidden">
        <Button
          variant="outline"
          onClick={() => navigate(createPageUrl("Dashboard"))}
          className="mb-3 sm:mb-4 w-full sm:w-auto touch-target"
          size="sm"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>

        <div className="mb-4 sm:mb-6 w-full overflow-hidden">
          <div className="flex items-center gap-2 sm:gap-3 w-full">
            <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-600 dark:bg-slate-500 rounded-lg flex items-center justify-center shadow-lg flex-shrink-0">
              <Target className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <h1 className="text-base sm:text-lg md:text-xl font-bold text-gray-900 truncate">Care Plan Management</h1>
              <p className="text-xs text-gray-600 hidden sm:block truncate">Manage and track patient care plans</p>
            </div>
            <div className="flex-shrink-0">
              <FavoriteButton type="page" id="CarePlanManagement" name="Care Plan Management" />
            </div>
          </div>
        </div>

        {/* Statistics */}
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-4 sm:mb-6 w-full">
        <Card className="bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100 border-none shadow-lg overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs font-medium mb-0.5 truncate">Total Plans</p>
                <p className="text-2xl sm:text-3xl font-bold">{totalPlans}</p>
              </div>
              <Target className="w-8 h-8 sm:w-10 sm:h-10 text-slate-600 dark:text-slate-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100 border-none shadow-lg overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs font-medium mb-0.5 truncate">Active</p>
                <p className="text-2xl sm:text-3xl font-bold">{activePlans}</p>
              </div>
              <TrendingUp className="w-8 h-8 sm:w-10 sm:h-10 text-slate-600 dark:text-slate-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100 border-none shadow-lg overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs font-medium mb-0.5 truncate">Goals Met</p>
                <p className="text-2xl sm:text-3xl font-bold">{metGoals}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10 text-slate-600 dark:text-slate-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-300 text-slate-900 dark:bg-slate-700 dark:text-slate-100 border-none shadow-lg overflow-hidden">
          <CardContent className="p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs font-medium mb-0.5 truncate">Patients</p>
                <p className="text-2xl sm:text-3xl font-bold">{activePatients}</p>
              </div>
              <User className="w-8 h-8 sm:w-10 sm:h-10 text-slate-600 dark:text-slate-400 flex-shrink-0" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-3 sm:mb-4 w-full overflow-hidden">
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-col gap-3 w-full">
            <div className="w-full relative overflow-hidden">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search care plans..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 h-11 text-sm w-full"
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40 h-11 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-sm">All Status</SelectItem>
                  <SelectItem value="active" className="text-sm">Active</SelectItem>
                  <SelectItem value="met" className="text-sm">Goal Met</SelectItem>
                  <SelectItem value="not_met" className="text-sm">Not Met</SelectItem>
                  <SelectItem value="revised" className="text-sm">Revised</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="w-full sm:w-auto border-dashed"
                onClick={() => setShowCreatePatient(true)}
              >
                + Add Patient
              </Button>
              <div className="flex gap-2 w-full sm:w-auto">
                <Button
                  variant={viewMode === "list" ? "default" : "outline"}
                  onClick={() => setViewMode("list")}
                  size="sm"
                  className={`flex-1 sm:flex-initial touch-target text-xs sm:text-sm ${viewMode === "list" ? "bg-blue-600" : ""}`}
                >
                  List
                </Button>
                <Button
                  variant={viewMode === "timeline" ? "default" : "outline"}
                  onClick={() => setViewMode("timeline")}
                  size="sm"
                  className={`flex-1 sm:flex-initial touch-target text-xs sm:text-sm ${viewMode === "timeline" ? "bg-blue-600" : ""}`}
                >
                  Timeline
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Review Reminders Widget */}
      {carePlans.length > 0 && (
        <div className="mb-3 sm:mb-4 w-full">
          <ReviewReminders carePlans={carePlans} />
        </div>
      )}

      {/* AI Tools Section */}
      {selectedPatient && showAITools && (
        <div className="space-y-3 sm:space-y-4 mb-3 sm:mb-4 w-full overflow-hidden">
          {/* Template Selector */}
          <CarePlanTemplateSelector
            diagnosis={selectedPatient.primary_diagnosis}
            providerType={currentUser?.credential_type}
            onSelectTemplate={async (template) => {
              try {
                const targetDate = addDays(new Date(), template.target_days || 60);
                await base44.entities.CarePlan.create({
                  patient_id: selectedPatient.id,
                  template_id: template.id,
                  problem: template.problem,
                  goal: template.goal,
                  interventions: template.interventions,
                  baseline_measurement: template.baseline_measurements?.[0] || "",
                  frequency: template.frequency_options?.[0] || "Weekly",
                  target_date: format(targetDate, 'yyyy-MM-dd'),
                  status: 'active',
                  next_review_date: format(addDays(new Date(), 30), 'yyyy-MM-dd')
                });
                queryClient.invalidateQueries({ queryKey: ['allCarePlans'] });
                toast.success("Care plan created from template");
              } catch (error) {
                toast.error("Failed to create care plan");
              }
            }}
          />
          {/* AI Suggestion Engine */}
          <AICarePlanSuggestionEngine
            patientId={selectedPatient.id}
            patientData={selectedPatient}
            diagnosis={selectedPatient.primary_diagnosis}
            existingCarePlans={carePlans.filter(cp => cp.patient_id === selectedPatient.id)}
            onAcceptSuggestion={async (carePlanData, educationTopics) => {
              try {
                const newPlan = await base44.entities.CarePlan.create(carePlanData);
                
                // Auto-assign education materials
                if (educationTopics?.length > 0) {
                  for (const topic of educationTopics) {
                    await base44.entities.PatientEducationAssignment.create({
                      patient_id: selectedPatient.id,
                      care_plan_id: newPlan.id,
                      topic: topic,
                      content: `Medicare-compliant education on ${topic} for ${selectedPatient.primary_diagnosis}`,
                      format: 'handout',
                      status: 'assigned',
                      assigned_date: new Date().toISOString().split('T')[0],
                      assigned_by: 'AI Care Plan System',
                      priority: 'high'
                    });
                  }
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
                alert('Failed to create care plan. Please try again.');
              }
            }}
            autoGenerate={true}
          />
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 w-full">
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
                alert('Tasks created successfully!');
              }}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 w-full">
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
      <div className="space-y-3 sm:space-y-4 w-full overflow-hidden">
        {isLoading ? (
          <Card className="w-full">
            <CardContent className="p-8 sm:p-12 text-center text-gray-500 text-sm">
              Loading care plans...
            </CardContent>
          </Card>
        ) : filteredCarePlans.length === 0 ? (
          <Card className="w-full">
            <CardContent className="p-8 sm:p-12 text-center">
              <Target className="w-12 h-12 sm:w-16 sm:h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">No care plans found</h3>
              <p className="text-sm text-gray-500">Try adjusting your search or filters.</p>
            </CardContent>
          </Card>
        ) : viewMode === "timeline" ? (
          Object.entries(groupedByPatient).map(([patientId, plans]) => {
            const patient = getPatient(patientId);
            if (!patient) return null;

            return (
              <div key={patientId} className="space-y-3 w-full overflow-hidden">
                <div className="flex items-start gap-2 sm:gap-3 p-3 sm:p-4 bg-slate-100 dark:bg-slate-800 rounded-lg border-2 border-slate-300 dark:border-slate-600 w-full">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center shadow-md flex-shrink-0">
                    <User className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                  </div>
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <h3 className="text-sm sm:text-base font-bold text-gray-900 truncate">
                      {patient.first_name} {patient.last_name}
                    </h3>
                    <p className="text-xs text-gray-600 truncate">
                      {patient.primary_diagnosis} • {plans.length} plan{plans.length !== 1 ? 's' : ''}
                    </p>
                    <Button
                      size="sm"
                      variant={selectedPatient?.id === patientId ? "default" : "outline"}
                      onClick={() => {
                        setSelectedPatient(patient);
                        setShowAITools(true);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className={`mt-2 w-full touch-target text-xs ${selectedPatient?.id === patientId ? "" : ""}`}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      AI Tools
                    </Button>
                  </div>
                </div>
                <div className="w-full overflow-hidden">
                  <CarePlanTimeline carePlans={plans} patient={patient} />
                </div>
              </div>
            );
          })
        ) : (
          Object.entries(groupedByPatient).map(([patientId, plans]) => {
            const patient = getPatient(patientId);
            if (!patient) return null;

            return (
              <Card key={patientId} className="border-l-4 border-l-slate-400 dark:border-l-slate-500 w-full overflow-hidden">
                <CardHeader className="p-3 sm:p-4">
                  <div className="flex flex-col gap-3 w-full">
                    <div className="flex items-start gap-2 sm:gap-3 w-full">
                      <div className="w-10 h-10 sm:w-12 sm:h-12 bg-slate-600 dark:bg-slate-500 rounded-full flex items-center justify-center shadow-md flex-shrink-0">
                        <User className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0 overflow-hidden">
                        <h3 className="text-sm sm:text-base md:text-lg font-bold text-gray-900 truncate">
                          {patient.first_name} {patient.last_name}
                        </h3>
                        <p className="text-xs sm:text-sm text-gray-600 truncate">
                          {patient.primary_diagnosis} • {plans.length} plan{plans.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2 w-full">
                      <Button
                        size="sm"
                        variant={selectedPatient?.id === patientId ? "default" : "outline"}
                        onClick={() => {
                          setSelectedPatient(patient);
                          setShowAITools(true);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full sm:flex-1 touch-target text-xs ${selectedPatient?.id === patientId ? "" : ""}`}
                      >
                        <Sparkles className="w-3 h-3 mr-1" />
                        AI Tools
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => navigate(`${createPageUrl("PatientDetails")}?patientId=${patientId}`)}
                        variant="outline"
                        className="w-full sm:flex-1 touch-target text-xs"
                      >
                        View Patient
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-3 sm:p-4 overflow-hidden">
                  <div className="space-y-3 w-full">
                    {plans.map((plan) => (
                      <Card key={plan.id} className="bg-slate-100 dark:bg-slate-900 w-full overflow-hidden">
                        <CardContent className="p-3 sm:p-4 overflow-hidden space-y-3">
                          <div className="flex flex-col gap-2 w-full">
                            <div className="flex-1 min-w-0 overflow-hidden">
                              <div className="flex items-start gap-2 mb-1 flex-wrap">
                                <h4 className="font-semibold text-gray-900 text-sm break-words flex-1 min-w-0">{plan.problem}</h4>
                                <Badge className={`${getStatusColor(plan.status)} flex-shrink-0 text-xs whitespace-nowrap`}>
                                  {plan.status.replace('_', ' ')}
                                </Badge>
                              </div>
                              <p className="text-xs sm:text-sm text-gray-600 mb-2 break-words">{plan.goal}</p>
                              
                              {plan.interventions && plan.interventions.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-xs font-medium text-gray-700 mb-1">Interventions:</p>
                                  <ul className="list-disc ml-4 text-xs text-gray-600 space-y-0.5">
                                    {plan.interventions.map((intervention, idx) => (
                                      <li key={idx} className="break-words">{intervention}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mt-2 text-xs text-gray-500">
                                {plan.frequency && <span className="break-words"><strong>Frequency:</strong> {plan.frequency}</span>}
                                {plan.target_date && (
                                  <span className="whitespace-nowrap">
                                    <strong>Target:</strong> {format(new Date(plan.target_date), 'MMM d, yyyy')}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Progress Tracker */}
                          <ProgressTracker carePlan={plan} patientId={plan.patient_id} />

                          {/* Collaboration Panel */}
                          <CollaborationPanel carePlan={plan} patientId={plan.patient_id} />

                          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t w-full">
                            <Select
                              value={plan.status}
                              onValueChange={(newStatus) => handleStatusChange(plan.id, newStatus)}
                            >
                              <SelectTrigger className="w-full sm:w-40 h-11 text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active" className="text-sm">Active</SelectItem>
                                <SelectItem value="met" className="text-sm">Goal Met</SelectItem>
                                <SelectItem value="not_met" className="text-sm">Not Met</SelectItem>
                                <SelectItem value="revised" className="text-sm">Revised</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(plan.id)}
                              className="text-red-600 hover:text-red-700 touch-target w-full sm:w-auto"
                            >
                              <Trash2 className="w-4 h-4 mr-1 sm:mr-0" />
                              <span className="sm:hidden">Delete</span>
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

      {/* Create Patient Dialog */}
      {showCreatePatient && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Create New Patient</CardTitle>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowCreatePatient(false)}
                >
                  ✕
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  First Name *
                </label>
                <input
                  type="text"
                  value={newPatientData.first_name}
                  onChange={(e) =>
                    setNewPatientData({
                      ...newPatientData,
                      first_name: e.target.value,
                    })
                  }
                  placeholder="John"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Last Name *
                </label>
                <input
                  type="text"
                  value={newPatientData.last_name}
                  onChange={(e) =>
                    setNewPatientData({
                      ...newPatientData,
                      last_name: e.target.value,
                    })
                  }
                  placeholder="Doe"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={newPatientData.date_of_birth}
                  onChange={(e) =>
                    setNewPatientData({
                      ...newPatientData,
                      date_of_birth: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700 block mb-1">
                  Medical Record Number
                </label>
                <input
                  type="text"
                  value={newPatientData.medical_record_number}
                  onChange={(e) =>
                    setNewPatientData({
                      ...newPatientData,
                      medical_record_number: e.target.value,
                    })
                  }
                  placeholder="MRN-12345"
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowCreatePatient(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={createNewPatient}
                  disabled={creatingPatient}
                >
                  {creatingPatient ? "Creating..." : "Create Patient"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
      </div>
    </div>
    </PremiumFeatureGate>
  );
}