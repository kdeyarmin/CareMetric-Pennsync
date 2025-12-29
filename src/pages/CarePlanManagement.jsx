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

export default function CarePlanManagement() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showAITools, setShowAITools] = useState(false);
  const [viewMode, setViewMode] = useState("list"); // "list" or "timeline"

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
      
      alert('Care plan created successfully with education materials!');
    } catch (error) {
      console.error('Error creating care plan:', error);
      alert('Failed to create care plan. Please try again.');
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
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <Button
        variant="outline"
        onClick={() => navigate(createPageUrl("Dashboard"))}
        className="mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to Dashboard
      </Button>

      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg">
            <Target className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Care Plan Management</h1>
            <p className="text-gray-600">Manage and track patient care plans</p>
          </div>
          <FavoriteButton type="page" id="CarePlanManagement" name="Care Plan Management" />
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm font-medium mb-1">Total Plans</p>
                <p className="text-4xl font-bold">{totalPlans}</p>
              </div>
              <Target className="w-12 h-12 text-blue-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-500 to-green-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-100 text-sm font-medium mb-1">Active Plans</p>
                <p className="text-4xl font-bold">{activePlans}</p>
              </div>
              <TrendingUp className="w-12 h-12 text-green-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm font-medium mb-1">Goals Met</p>
                <p className="text-4xl font-bold">{metGoals}</p>
              </div>
              <CheckCircle2 className="w-12 h-12 text-purple-200" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-500 to-orange-600 text-white border-none shadow-lg">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-orange-100 text-sm font-medium mb-1">Patients</p>
                <p className="text-4xl font-bold">{activePatients}</p>
              </div>
              <User className="w-12 h-12 text-orange-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search care plans or patients..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full md:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="met">Goal Met</SelectItem>
                <SelectItem value="not_met">Not Met</SelectItem>
                <SelectItem value="revised">Revised</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Button
                variant={viewMode === "list" ? "default" : "outline"}
                onClick={() => setViewMode("list")}
                className={viewMode === "list" ? "bg-blue-600" : ""}
              >
                List View
              </Button>
              <Button
                variant={viewMode === "timeline" ? "default" : "outline"}
                onClick={() => setViewMode("timeline")}
                className={viewMode === "timeline" ? "bg-blue-600" : ""}
              >
                Timeline View
              </Button>
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
                console.error('Error creating care plan:', error);
                alert('Failed to create care plan. Please try again.');
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
                alert('Tasks created successfully!');
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
            <CardContent className="p-12 text-center text-gray-500">
              Loading care plans...
            </CardContent>
          </Card>
        ) : filteredCarePlans.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Target className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No care plans found</h3>
              <p className="text-gray-500">Try adjusting your search or filters.</p>
            </CardContent>
          </Card>
        ) : viewMode === "timeline" ? (
          Object.entries(groupedByPatient).map(([patientId, plans]) => {
            const patient = getPatient(patientId);
            if (!patient) return null;

            return (
              <div key={patientId} className="space-y-3">
                <div className="flex items-center gap-3 p-4 bg-white rounded-lg border-2 border-blue-300">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center shadow-md">
                    <User className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-gray-900">
                      {patient.first_name} {patient.last_name}
                    </h3>
                    <p className="text-sm text-gray-600">
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
                      className={selectedPatient?.id === patientId ? "bg-purple-600 hover:bg-purple-700" : ""}
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
              <Card key={patientId} className="border-l-4 border-l-blue-500">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-full flex items-center justify-center shadow-md">
                        <User className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h3 className="text-xl font-bold text-gray-900">
                          {patient.first_name} {patient.last_name}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {patient.primary_diagnosis} • {plans.length} active care plan{plans.length !== 1 ? 's' : ''}
                        </p>
                      </div>
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
                        className={selectedPatient?.id === patientId ? "bg-purple-600 hover:bg-purple-700" : ""}
                      >
                        <Sparkles className="w-4 h-4 mr-1" />
                        AI Tools
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => navigate(`${createPageUrl("PatientDetails")}?patientId=${patientId}`)}
                        variant="outline"
                      >
                        View Patient
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {plans.map((plan) => (
                      <Card key={plan.id} className="bg-gray-50">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-semibold text-gray-900">{plan.problem}</h4>
                                <Badge className={getStatusColor(plan.status)}>
                                  {plan.status.replace('_', ' ')}
                                </Badge>
                              </div>
                              <p className="text-sm text-gray-600 mb-2">{plan.goal}</p>
                              
                              {plan.interventions && plan.interventions.length > 0 && (
                                <div className="mt-2">
                                  <p className="text-xs font-medium text-gray-700 mb-1">Interventions:</p>
                                  <ul className="list-disc ml-5 text-xs text-gray-600 space-y-0.5">
                                    {plan.interventions.map((intervention, idx) => (
                                      <li key={idx}>{intervention}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="flex gap-4 mt-2 text-xs text-gray-500">
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
                              <SelectTrigger className="w-36">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="met">Goal Met</SelectItem>
                                <SelectItem value="not_met">Not Met</SelectItem>
                                <SelectItem value="revised">Revised</SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDelete(plan.id)}
                              className="text-red-600 hover:text-red-700"
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
    </div>
    </PremiumFeatureGate>
  );
}