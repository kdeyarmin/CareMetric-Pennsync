import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Route,
  Plus,
  Edit,
  Trash2,
  Copy,
  Loader2,
  CheckCircle2,
  Zap,
  FileText,
  DollarSign,
  ClipboardList,
  X,
  Sparkles,
  Brain,
  ShieldAlert
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AIAssessmentDrafter from "../components/clinical/AIAssessmentDrafter";
import AIICD10Suggester from "../components/clinical/AIICD10Suggester";
import AICarePlanGenerator from "../components/clinical/AICarePlanGenerator";
import AIPathwayGenerator from "../components/clinical/AIPathwayGenerator";
import AIPathwayUpdater from "../components/clinical/AIPathwayUpdater";
import OASISUploadWidget from "../components/oasis/OASISUploadWidget";
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

export default function ClinicalPathwayManager() {
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editingPathway, setEditingPathway] = useState(null);
  const [activeTab, setActiveTab] = useState("pathways");
  const [selectedPathwayForUpdate, setSelectedPathwayForUpdate] = useState(null);
  const [pathwayToDelete, setPathwayToDelete] = useState(null);

  const { data: currentUser, isLoading: isLoadingUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: pathways = [], isLoading } = useQuery({
    queryKey: ['clinicalPathways'],
    queryFn: () => base44.entities.ClinicalPathway.list('-created_date')
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.ClinicalPathway.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinicalPathways'] });
      setShowDialog(false);
      setEditingPathway(null);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ClinicalPathway.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinicalPathways'] });
      setShowDialog(false);
      setEditingPathway(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.ClinicalPathway.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clinicalPathways'] });
    }
  });

  const handleEdit = (pathway) => {
    setEditingPathway(pathway);
    setShowDialog(true);
  };

  const handleDuplicate = async (pathway) => {
    const duplicate = {
      ...pathway,
      pathway_name: `${pathway.pathway_name} (Copy)`,
      id: undefined,
      created_date: undefined,
      updated_date: undefined
    };
    await createMutation.mutateAsync(duplicate);
  };

  const createSamplePathways = async () => {
    const samples = [
      {
        pathway_name: "CHF (Congestive Heart Failure)",
        description: "Comprehensive pathway for heart failure patients to optimize PDGM grouping and ensure complete documentation",
        trigger_conditions: [
          { type: "diagnosis_code", value: "I50", operator: "starts_with" },
          { type: "diagnosis_keyword", value: "heart failure", operator: "contains" },
          { type: "diagnosis_keyword", value: "CHF", operator: "contains" }
        ],
        pdgm_clinical_group: "MMTA_Cardiac_Circulatory",
        priority_level: "high",
        documentation_prompts: [
          {
            category: "Functional Impact",
            prompt: "Document specific functional limitations due to CHF (dyspnea on exertion, fatigue affecting ADLs, edema limiting mobility)",
            m_items_affected: ["M1400", "M1850", "M1860"],
            priority: "high"
          },
          {
            category: "Monitoring Needs",
            prompt: "Document daily weight monitoring, I&O, signs of fluid retention, medication adherence",
            m_items_affected: ["M2102", "M2250"],
            priority: "high"
          },
          {
            category: "Skilled Need",
            prompt: "Document need for skilled nursing for CHF monitoring, patient education on diet/fluid restrictions, medication management",
            m_items_affected: [],
            priority: "critical"
          }
        ],
        rescore_opportunities: [
          {
            m_item: "M1860 (Ambulation)",
            typical_score_range: "3-5",
            documentation_to_support: "Document dyspnea limiting ambulation distance, need for frequent rests, oxygen use during ambulation",
            revenue_impact: "$200-400"
          },
          {
            m_item: "M1400 (Dyspnea)",
            typical_score_range: "2-3",
            documentation_to_support: "Document specific activities causing shortness of breath, oxygen requirements",
            revenue_impact: "Supports higher functional scores"
          }
        ],
        recommended_tasks: [
          {
            task_title: "Daily Weight Monitoring",
            task_description: "Establish daily weight monitoring protocol and educate patient/caregiver",
            task_type: "coordinate",
            priority: "high",
            due_timeframe: "24_hours"
          },
          {
            task_title: "CHF Education Materials",
            task_description: "Provide CHF education on signs/symptoms to report, diet restrictions, fluid management",
            task_type: "document",
            priority: "high",
            due_timeframe: "next_visit"
          },
          {
            task_title: "Cardiology Follow-up",
            task_description: "Coordinate cardiology follow-up appointment if not already scheduled",
            task_type: "schedule",
            priority: "medium",
            due_timeframe: "this_week"
          }
        ],
        comorbidity_checklist: [
          "Hypertension (I10)",
          "Diabetes (E11.x)",
          "Chronic Kidney Disease (N18.x)",
          "Atrial Fibrillation (I48.x)",
          "COPD (J44.x)",
          "Coronary Artery Disease (I25.x)"
        ],
        functional_focus_areas: [
          "Ambulation (M1860) - dyspnea impact",
          "Transferring (M1850) - weakness/fatigue",
          "Bathing (M1830) - endurance limitations"
        ],
        is_active: true
      },
      {
        pathway_name: "Diabetes with Complications",
        description: "Pathway for diabetic patients to ensure comprehensive comorbidity capture and functional assessment",
        trigger_conditions: [
          { type: "diagnosis_code", value: "E11", operator: "starts_with" },
          { type: "diagnosis_code", value: "E10", operator: "starts_with" },
          { type: "diagnosis_keyword", value: "diabetes", operator: "contains" }
        ],
        pdgm_clinical_group: "MMTA_Endocrine",
        priority_level: "high",
        documentation_prompts: [
          {
            category: "Complications",
            prompt: "Document ALL diabetic complications: neuropathy, retinopathy, nephropathy, vascular disease, wound healing issues",
            m_items_affected: ["M1021", "M1023"],
            priority: "critical"
          },
          {
            category: "Wound Assessment",
            prompt: "Thoroughly assess and document any diabetic ulcers, wound characteristics, healing status",
            m_items_affected: ["M1306", "M1307", "M1311", "M1322"],
            priority: "high"
          },
          {
            category: "Vision Impact",
            prompt: "Document if diabetic retinopathy affects medication self-administration or functional abilities",
            m_items_affected: ["M2020", "M1800-M1860"],
            priority: "medium"
          }
        ],
        rescore_opportunities: [
          {
            m_item: "M1023 (Other Diagnoses)",
            typical_score_range: "Multiple codes",
            documentation_to_support: "Document specific diabetic complications with ICD-10 codes (E11.21 nephropathy, E11.40 neuropathy, E11.65 hyperglycemia)",
            revenue_impact: "$300-600"
          }
        ],
        recommended_tasks: [
          {
            task_title: "Blood Glucose Monitoring Education",
            task_description: "Educate on blood glucose monitoring and target ranges",
            task_type: "document",
            priority: "high",
            due_timeframe: "next_visit"
          },
          {
            task_title: "Foot Inspection Protocol",
            task_description: "Establish daily foot inspection routine for diabetic neuropathy",
            task_type: "coordinate",
            priority: "high",
            due_timeframe: "24_hours"
          }
        ],
        comorbidity_checklist: [
          "Diabetic Neuropathy (E11.40)",
          "Diabetic Nephropathy (E11.21)",
          "Diabetic Retinopathy (E11.3x)",
          "Hypertension (I10)",
          "Hyperlipidemia (E78.x)",
          "Peripheral Vascular Disease (I73.9)"
        ],
        functional_focus_areas: [
          "Vision impact on ADLs",
          "Neuropathy affecting balance/ambulation",
          "Wound care needs"
        ],
        is_active: true
      },
      {
        pathway_name: "Post-Surgical Recovery",
        description: "Pathway for post-surgical patients to capture wound care needs and rehabilitation requirements",
        trigger_conditions: [
          { type: "diagnosis_code", value: "Z48", operator: "starts_with" },
          { type: "diagnosis_keyword", value: "surgical", operator: "contains" },
          { type: "diagnosis_keyword", value: "post-op", operator: "contains" }
        ],
        pdgm_clinical_group: "MMTA_Surgical_Aftercare",
        priority_level: "high",
        documentation_prompts: [
          {
            category: "Wound Status",
            prompt: "Document surgical wound location, size, drainage, signs of infection, healing progress",
            m_items_affected: ["M1330", "M1340", "M1342"],
            priority: "critical"
          },
          {
            category: "Pain Management",
            prompt: "Document post-surgical pain level, frequency, impact on function, medication effectiveness",
            m_items_affected: ["M1242"],
            priority: "high"
          },
          {
            category: "Mobility Restrictions",
            prompt: "Document any surgical restrictions on mobility, weight-bearing status, assistive devices needed",
            m_items_affected: ["M1850", "M1860"],
            priority: "high"
          }
        ],
        rescore_opportunities: [
          {
            m_item: "M1330/M1340 (Surgical Wound)",
            typical_score_range: "Present with status",
            documentation_to_support: "Document wound characteristics, dressing changes needed, skilled assessment requirements",
            revenue_impact: "Supports complex nursing grouping"
          }
        ],
        recommended_tasks: [
          {
            task_title: "Surgical Site Assessment",
            task_description: "Assess surgical wound for signs of infection, measure and document healing progress",
            task_type: "document",
            priority: "high",
            due_timeframe: "next_visit"
          },
          {
            task_title: "Surgeon Follow-up Coordination",
            task_description: "Ensure patient has post-op follow-up scheduled with surgeon",
            task_type: "schedule",
            priority: "medium",
            due_timeframe: "this_week"
          }
        ],
        comorbidity_checklist: [
          "Diabetes (affects healing)",
          "Hypertension",
          "Obesity",
          "Immunosuppression"
        ],
        functional_focus_areas: [
          "Transferring (M1850)",
          "Ambulation (M1860)",
          "Bathing (M1830) - wound protection"
        ],
        is_active: true
      }
    ];

    for (const sample of samples) {
      await createMutation.mutateAsync(sample);
    }
  };

  if (isLoading || isLoadingUser) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  // Admin-only surface: block non-admins (server-side authz remains the real gate).
  if (currentUser?.role !== 'admin') {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-12 text-center">
            <ShieldAlert className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Access Restricted</h2>
            <p className="text-slate-600">Only administrators can manage clinical pathways.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardList}
        eyebrow="Manage"
        title="Clinical Pathways"
        description="AI-powered clinical documentation, OASIS assessments, and care planning"
        favoritePage="ClinicalPathwayManager"
        actions={
          <div className="flex gap-2 w-full sm:w-auto">
            {pathways.length === 0 && (
              <Button
                onClick={createSamplePathways}
                variant="outline"
                disabled={createMutation.isPending}
                className="w-full sm:w-auto min-h-[44px]"
              >
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <><span className="hidden sm:inline">Load Sample Pathways</span><span className="sm:hidden">Load Samples</span></>
                )}
              </Button>
            )}
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button className="bg-indigo-600 hover:bg-indigo-700 w-full sm:w-auto min-h-[44px]" onClick={() => setEditingPathway(null)}>
                  <Plus className="w-4 h-4 mr-2" />
                  <span className="hidden sm:inline">New Pathway</span>
                  <span className="sm:hidden">New</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                <PathwayForm
                  pathway={editingPathway}
                  onSave={(data) => {
                    if (editingPathway) {
                      updateMutation.mutate({ id: editingPathway.id, data });
                    } else {
                      createMutation.mutate(data);
                    }
                  }}
                  onCancel={() => {
                    setShowDialog(false);
                    setEditingPathway(null);
                  }}
                  isSaving={createMutation.isPending || updateMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        }
      />

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0 mb-4 sm:mb-6">
            <TabsList className="inline-flex md:grid md:w-full md:grid-cols-5 gap-1 min-w-max h-auto">
              <TabsTrigger value="pathways" className="flex items-center gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                <Route className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>Pathways</span>
              </TabsTrigger>
              <TabsTrigger value="ai-generate" className="flex items-center gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                <Brain className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden md:inline">AI Generate</span>
                <span className="md:hidden">AI Gen</span>
              </TabsTrigger>
              <TabsTrigger value="oasis" className="flex items-center gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                <Sparkles className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>OASIS</span>
              </TabsTrigger>
              <TabsTrigger value="icd10" className="flex items-center gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                <FileText className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>ICD-10</span>
              </TabsTrigger>
              <TabsTrigger value="careplan" className="flex items-center gap-1 sm:gap-2 py-2 sm:py-3 text-xs sm:text-sm whitespace-nowrap">
                <ClipboardList className="w-3 h-3 sm:w-4 sm:h-4" />
                <span className="hidden md:inline">Care Plan</span>
                <span className="md:hidden">Plan</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="pathways">
            {pathways.length === 0 ? (
          <EmptyState
            icon={Route}
            title="No clinical pathways yet"
            description="Create pathways to automatically guide documentation and task creation for specific diagnoses."
            action={
              <Button onClick={createSamplePathways} disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <>Load Sample Pathways</>
                )}
              </Button>
            }
          />
            ) : (
              <div className="grid gap-4">
                {pathways.map((pathway) => (
              <Card key={pathway.id} className={`${!pathway.is_active && 'opacity-60'}`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-12 rounded ${pathway.is_active ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                      <div>
                        <CardTitle className="text-lg">{pathway.pathway_name}</CardTitle>
                        <CardDescription>{pathway.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={getPriorityColor(pathway.priority_level)}>
                        {pathway.priority_level}
                      </Badge>
                      {pathway.pdgm_clinical_group && (
                        <Badge variant="outline">
                          {pathway.pdgm_clinical_group.replace('MMTA_', '')}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Stats */}
                  <div className="grid grid-cols-4 gap-2 text-center text-xs">
                    <div className="bg-blue-50 p-2 rounded">
                      <Zap className="w-3 h-3 text-blue-600 mx-auto mb-1" />
                      <p className="font-bold text-blue-700">{pathway.trigger_conditions?.length || 0}</p>
                      <p className="text-blue-600">Triggers</p>
                    </div>
                    <div className="bg-navy-50 p-2 rounded">
                      <FileText className="w-3 h-3 text-navy-600 mx-auto mb-1" />
                      <p className="font-bold text-navy-700">{pathway.documentation_prompts?.length || 0}</p>
                      <p className="text-navy-600">Doc Prompts</p>
                    </div>
                    <div className="bg-emerald-50 p-2 rounded">
                      <DollarSign className="w-3 h-3 text-emerald-600 mx-auto mb-1" />
                      <p className="font-bold text-emerald-700">{pathway.rescore_opportunities?.length || 0}</p>
                      <p className="text-emerald-600">Rescores</p>
                    </div>
                    <div className="bg-navy-50 p-2 rounded">
                      <ClipboardList className="w-3 h-3 text-navy-600 mx-auto mb-1" />
                      <p className="font-bold text-navy-700">{pathway.recommended_tasks?.length || 0}</p>
                      <p className="text-navy-600">Tasks</p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 pt-2">
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => handleEdit(pathway)}
                     className="min-h-[44px]"
                   >
                     <Edit className="w-3 h-3 mr-1 sm:mr-2" />
                     <span className="hidden sm:inline">Edit</span>
                   </Button>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => {
                       setSelectedPathwayForUpdate(pathway);
                       setActiveTab("ai-generate");
                     }}
                     className="text-blue-600 hover:bg-blue-50 min-h-[44px]"
                   >
                     <Brain className="w-3 h-3 mr-1 sm:mr-2" />
                     <span className="hidden sm:inline">AI Update</span>
                     <span className="sm:hidden">AI</span>
                   </Button>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => handleDuplicate(pathway)}
                     disabled={createMutation.isPending}
                     className="min-h-[44px]"
                   >
                     <Copy className="w-3 h-3 mr-1 sm:mr-2" />
                     <span className="hidden sm:inline">Duplicate</span>
                     <span className="sm:hidden">Copy</span>
                   </Button>
                   <Button
                     variant="outline"
                     size="sm"
                     onClick={() => setPathwayToDelete(pathway)}
                     disabled={deleteMutation.isPending}
                     className="text-red-600 hover:bg-red-50 min-h-[44px]"
                   >
                     <Trash2 className="w-3 h-3 mr-1 sm:mr-2" />
                     <span className="hidden sm:inline">Delete</span>
                   </Button>
                  </div>
                </CardContent>
              </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="ai-generate">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
              <AIPathwayGenerator
                onPathwayGenerated={(_pathway) => {
                  queryClient.invalidateQueries({ queryKey: ['clinicalPathways'] });
                }}
              />
              
              {selectedPathwayForUpdate && (
                <AIPathwayUpdater
                  pathway={selectedPathwayForUpdate}
                  onPathwayUpdated={(_updated) => {
                    queryClient.invalidateQueries({ queryKey: ['clinicalPathways'] });
                    setSelectedPathwayForUpdate(null);
                  }}
                />
              )}

              {!selectedPathwayForUpdate && (
                <EmptyState
                  icon={Brain}
                  title="Select a pathway"
                  description="Select a pathway from the list to get AI update recommendations, or generate a new one using the generator on the left."
                />
              )}
            </div>
          </TabsContent>

          <TabsContent value="oasis">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
              <div className="lg:col-span-2">
                <AIAssessmentDrafter
                  onDraftComplete={() => {}}
                />
              </div>
              <OASISUploadWidget />
            </div>
          </TabsContent>

          <TabsContent value="icd10">
            <AIICD10Suggester
              onCodesSelected={() => {}}
            />
          </TabsContent>

          <TabsContent value="careplan">
            <AICarePlanGenerator
              onCarePlanGenerated={() => {}}
            />
          </TabsContent>
        </Tabs>

      <AlertDialog open={!!pathwayToDelete} onOpenChange={(open) => { if (!open) setPathwayToDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Clinical Pathway</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{pathwayToDelete?.pathway_name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                deleteMutation.mutate(pathwayToDelete.id);
                setPathwayToDelete(null);
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

function PathwayForm({ pathway, onSave, onCancel, isSaving }) {
  const [formData, setFormData] = useState(pathway || {
    pathway_name: '',
    description: '',
    trigger_conditions: [],
    pdgm_clinical_group: '',
    priority_level: 'medium',
    documentation_prompts: [],
    rescore_opportunities: [],
    recommended_tasks: [],
    comorbidity_checklist: [],
    functional_focus_areas: [],
    is_active: true
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  const addTrigger = () => {
    setFormData(prev => ({
      ...prev,
      trigger_conditions: [
        ...(prev.trigger_conditions || []),
        { type: 'diagnosis_keyword', value: '', operator: 'contains' }
      ]
    }));
  };

  const updateTrigger = (index, field, value) => {
    const updated = [...formData.trigger_conditions];
    updated[index] = { ...updated[index], [field]: value };
    setFormData(prev => ({ ...prev, trigger_conditions: updated }));
  };

  const removeTrigger = (index) => {
    const updated = formData.trigger_conditions.filter((_, i) => i !== index);
    setFormData(prev => ({ ...prev, trigger_conditions: updated }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{pathway ? 'Edit' : 'Create'} Clinical Pathway</DialogTitle>
        <DialogDescription>
          Define triggers and automated actions for specific patient conditions
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-2">
        <Label>Pathway Name *</Label>
        <Input
          value={formData.pathway_name}
          onChange={(e) => setFormData(prev => ({ ...prev, pathway_name: e.target.value }))}
          placeholder="e.g., CHF Management"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="What this pathway addresses..."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Priority Level</Label>
          <Select
            value={formData.priority_level}
            onValueChange={(value) => setFormData(prev => ({ ...prev, priority_level: value }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between pt-6">
          <Label>Active</Label>
          <Switch
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_active: checked }))}
          />
        </div>
      </div>

      {/* Trigger Conditions */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Trigger Conditions *</Label>
          <Button type="button" variant="outline" size="sm" onClick={addTrigger}>
            <Plus className="w-3 h-3 mr-1" />
            Add Trigger
          </Button>
        </div>
        <div className="space-y-2 max-h-40 overflow-y-auto">
          {formData.trigger_conditions?.map((trigger, idx) => (
            <div key={idx} className="flex gap-2 items-end bg-slate-50 p-2 rounded">
              <div className="flex-1 grid grid-cols-3 gap-2">
                <Select value={trigger.type} onValueChange={(v) => updateTrigger(idx, 'type', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="diagnosis_code">Diagnosis Code</SelectItem>
                    <SelectItem value="diagnosis_keyword">Diagnosis Keyword</SelectItem>
                    <SelectItem value="clinical_condition">Clinical Condition</SelectItem>
                    <SelectItem value="comorbidity">Comorbidity</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={trigger.operator} onValueChange={(v) => updateTrigger(idx, 'operator', v)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="contains">Contains</SelectItem>
                    <SelectItem value="equals">Equals</SelectItem>
                    <SelectItem value="starts_with">Starts With</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={trigger.value}
                  onChange={(e) => updateTrigger(idx, 'value', e.target.value)}
                  placeholder="Value..."
                  className="h-8 text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeTrigger(idx)}
                className="h-8 w-8 p-0"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex gap-2 pt-4 border-t">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSaving || !formData.pathway_name || formData.trigger_conditions?.length === 0}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700"
        >
          {isSaving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-2" /> Save Pathway</>
          )}
        </Button>
      </div>
    </form>
  );
}

const getPriorityColor = (priority) => {
  switch (priority) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-orange-500 text-white';
    case 'medium': return 'bg-amber-500 text-white';
    case 'low': return 'bg-blue-500 text-white';
    default: return 'bg-slate-500 text-white';
  }
};