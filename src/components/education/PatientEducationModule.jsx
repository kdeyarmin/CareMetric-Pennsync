import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Search, Loader2, PlayCircle, FileText, AlertCircle, 
  Sparkles, CheckCircle2, Clock, TrendingUp
} from "lucide-react";

export default function PatientEducationModule({ patientId, patient, documentAnalysis }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedContentType, setSelectedContentType] = useState("");
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [generating, setGenerating] = useState(false);
  const queryClient = useQueryClient();

  // Fetch all materials
  const { data: materials = [] } = useQuery({
    queryKey: ["educationMaterials"],
    queryFn: async () => {
      const items = await base44.entities.PatientEducationMaterial.filter({ 
        is_active: true 
      });
      return items || [];
    }
  });

  // Fetch assigned materials for this patient
  const { data: assignedMaterials = [] } = useQuery({
    queryKey: ["patientAssignments", patientId],
    queryFn: async () => {
      const assignments = await base44.entities.PatientEducationAssignment.filter({
        patient_id: patientId
      });
      return assignments || [];
    },
    enabled: !!patientId
  });

  const [recommendations, setRecommendations] = useState([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);

  // Generate recommendations
  const generateRecommendations = async () => {
    if (!patientId || !patient) {
      toast.error('Patient data required');
      return;
    }

    setRecommendationsLoading(true);
    try {
      const prompt = `You are a clinical educator. Based on the following patient profile and available educational materials, recommend the most relevant materials for patient education.

PATIENT PROFILE:
Name: ${patient.first_name} ${patient.last_name}
Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'N/A'}
Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Current Medications: ${patient.current_medications?.length || 0}
Allergies: ${patient.allergies || 'None'}

${documentAnalysis?.analysis_summary ? `
DOCUMENT ANALYSIS SUMMARY:
${documentAnalysis.analysis_summary}
` : ''}

AVAILABLE MATERIALS:
${materials.map((m, idx) => `
${idx + 1}. "${m.title}"
   - Category: ${m.category}
   - Type: ${m.content_type}
   - Relevant Diagnoses: ${m.relevant_diagnoses?.join(', ') || 'General'}
   - Reading Level: ${m.reading_level}
   - Duration: ${m.duration_minutes} min
   - Description: ${m.description}
`).join('\n')}

Based on the patient's conditions, medications, and identified educational needs:
1. Recommend 3-5 most relevant materials with clinical justification
2. Prioritize by urgency and relevance to primary diagnosis
3. Consider reading level and engagement type
4. Suggest specific follow-up discussions

Return as JSON with material titles and justifications.`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  material_title: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  clinical_justification: { type: "string" },
                  expected_outcomes: { type: "array", items: { type: "string" } },
                  suggested_discussion_topics: { type: "array", items: { type: "string" } }
                }
              }
            }
          }
        }
      });

      // Match recommendations with material IDs
      const enrichedRecommendations = result.recommendations?.map(rec => {
        const matchedMaterial = materials.find(m => 
          m.title.toLowerCase().includes(rec.material_title.toLowerCase()) ||
          rec.material_title.toLowerCase().includes(m.title.toLowerCase())
        );
        return {
          ...rec,
          material_id: matchedMaterial?.id,
          material: matchedMaterial
        };
      }) || [];

      setRecommendations(enrichedRecommendations);
      toast.success('Recommendations generated');
    } catch (error) {
      console.error('Recommendation error:', error);
      toast.error('Failed to generate recommendations');
    } finally {
      setRecommendationsLoading(false);
    }
  };

  // Assign material mutation
  const assignMutation = useMutation({
    mutationFn: async ({ materialId, reason }) => {
      const user = await base44.auth.me();
      return await base44.entities.PatientEducationAssignment.create({
        patient_id: patientId,
        material_id: materialId,
        assigned_by: user.email,
        assigned_date: new Date().toISOString(),
        reason: reason || 'Clinical assessment'
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patientAssignments", patientId] });
      toast.success('Material assigned to patient');
    }
  });

  // Update assignment status
  const updateAssignmentMutation = useMutation({
    mutationFn: async ({ assignmentId, status, comprehensionLevel, notes }) => {
      return await base44.entities.PatientEducationAssignment.update(assignmentId, {
        status,
        comprehension_level: comprehensionLevel,
        patient_notes: notes,
        completion_date: status === 'completed' ? new Date().toISOString() : undefined
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["patientAssignments", patientId] });
      toast.success('Assignment updated');
    }
  });

  // Filter materials
  const filteredMaterials = useMemo(() => {
    return materials.filter(m => {
      const matchesSearch = !searchQuery || 
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.keywords?.some(k => k.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = !selectedCategory || m.category === selectedCategory;
      const matchesType = !selectedContentType || m.content_type === selectedContentType;
      
      return matchesSearch && matchesCategory && matchesType;
    });
  }, [materials, searchQuery, selectedCategory, selectedContentType]);

  // Get already assigned material IDs
  const assignedMaterialIds = new Set(assignedMaterials.map(a => a.material_id));

  return (
    <div className="space-y-6">
      {/* Recommendations Section */}
      {showRecommendations && (
        <Card className="border-2 border-cyan-200 dark:border-cyan-800">
          <CardHeader className="bg-gradient-to-r from-cyan-50 to-blue-50 dark:from-cyan-950 dark:to-blue-950">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-600" />
              AI Recommendations for Patient
            </CardTitle>
            <CardDescription>
              Personalized educational materials based on patient conditions
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            {recommendations.length === 0 ? (
              <Button
                onClick={generateRecommendations}
                disabled={recommendationsLoading || !patientId}
                className="w-full bg-cyan-600 hover:bg-cyan-700"
              >
                {recommendationsLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {recommendationsLoading ? 'Analyzing...' : 'Generate Recommendations'}
              </Button>
            ) : (
              <div className="space-y-3">
                {recommendations.map((rec, idx) => (
                  <div key={idx} className="p-3 bg-cyan-50 dark:bg-cyan-950 rounded-lg border border-cyan-200 dark:border-cyan-800">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900 dark:text-slate-100">
                          {rec.material?.title || rec.material_title}
                        </p>
                        <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                          {rec.clinical_justification}
                        </p>
                      </div>
                      <Badge className="bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-100">
                        {rec.priority}
                      </Badge>
                    </div>

                    {rec.expected_outcomes?.length > 0 && (
                      <div className="text-xs text-slate-600 dark:text-slate-400 mb-2">
                        <p className="font-medium mb-1">Expected Outcomes:</p>
                        <ul className="space-y-0.5">
                          {rec.expected_outcomes.slice(0, 2).map((outcome, idx) => (
                            <li key={idx}>• {outcome}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {rec.material && !assignedMaterialIds.has(rec.material.id) && (
                      <Button
                        onClick={() => assignMutation.mutate({ 
                          materialId: rec.material.id,
                          reason: rec.clinical_justification 
                        })}
                        disabled={assignMutation.isPending}
                        size="sm"
                        className="bg-cyan-600 hover:bg-cyan-700 mt-2"
                      >
                        {assignMutation.isPending ? 'Assigning...' : 'Assign to Patient'}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Search and Filter Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5" />
            Educational Materials Library
          </CardTitle>
          <CardDescription>
            Search and assign materials to patient
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search materials..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 block">
                Category
              </label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Categories</SelectItem>
                  <SelectItem value="disease_management">Disease Management</SelectItem>
                  <SelectItem value="medication">Medication</SelectItem>
                  <SelectItem value="lifestyle">Lifestyle</SelectItem>
                  <SelectItem value="nutrition">Nutrition</SelectItem>
                  <SelectItem value="exercise">Exercise</SelectItem>
                  <SelectItem value="mental_health">Mental Health</SelectItem>
                  <SelectItem value="wound_care">Wound Care</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 block">
                Type
              </label>
              <Select value={selectedContentType} onValueChange={setSelectedContentType}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={null}>All Types</SelectItem>
                  <SelectItem value="article">Article</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="infographic">Infographic</SelectItem>
                  <SelectItem value="guide">Guide</SelectItem>
                  <SelectItem value="worksheet">Worksheet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("");
                  setSelectedContentType("");
                }}
                variant="outline"
                size="sm"
                className="w-full h-8"
              >
                Reset
              </Button>
            </div>
          </div>

          {/* Results Count */}
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Found {filteredMaterials.length} material{filteredMaterials.length !== 1 ? 's' : ''}
          </p>
        </CardContent>
      </Card>

      {/* Available Materials */}
      <div className="space-y-3">
        <h3 className="font-semibold text-slate-900 dark:text-slate-100">Available Materials</h3>
        {filteredMaterials.length === 0 ? (
          <Card className="bg-slate-50 dark:bg-slate-900">
            <CardContent className="p-8 text-center">
              <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
              <p className="text-slate-600 dark:text-slate-400">No materials match your search</p>
            </CardContent>
          </Card>
        ) : (
          filteredMaterials.map(material => {
            const isAssigned = assignedMaterialIds.has(material.id);
            const assignment = assignedMaterials.find(a => a.material_id === material.id);

            return (
              <Card key={material.id} className={isAssigned ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950" : ""}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3 mb-3">
                    {material.content_type === 'video' ? (
                      <PlayCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-1" />
                    ) : (
                      <FileText className="w-5 h-5 text-slate-600 flex-shrink-0 mt-1" />
                    )}
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100">{material.title}</h4>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{material.description}</p>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {material.content_type}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {material.category}
                        </Badge>
                        {material.duration_minutes && (
                          <Badge variant="outline" className="text-xs">
                            <Clock className="w-3 h-3 mr-1" />
                            {material.duration_minutes} min
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-xs">
                          {material.reading_level}
                        </Badge>
                      </div>
                      {material.relevant_diagnoses?.length > 0 && (
                        <p className="text-xs text-slate-500 mt-2">
                          <strong>Diagnoses:</strong> {material.relevant_diagnoses.join(', ')}
                        </p>
                      )}
                    </div>
                  </div>

                  {isAssigned && assignment ? (
                    <div className="bg-white dark:bg-slate-800 p-3 rounded border border-green-200 dark:border-green-800 space-y-2">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                          Assigned {format(new Date(assignment.assigned_date), 'MMM d')}
                        </span>
                      </div>

                      {assignment.status !== 'completed' && (
                        <div className="space-y-2">
                          <Select value={assignment.status} onValueChange={(status) => 
                            updateAssignmentMutation.mutate({
                              assignmentId: assignment.id,
                              status
                            })
                          }>
                            <SelectTrigger className="h-8 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="pending">Not Started</SelectItem>
                              <SelectItem value="in_progress">In Progress</SelectItem>
                              <SelectItem value="completed">Completed</SelectItem>
                              <SelectItem value="not_relevant">Not Relevant</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  ) : (
                    <Button
                      onClick={() => assignMutation.mutate({ 
                        materialId: material.id,
                        reason: `Relevant to patient condition`
                      })}
                      disabled={assignMutation.isPending || !patientId}
                      size="sm"
                      className="w-full bg-blue-600 hover:bg-blue-700"
                    >
                      {assignMutation.isPending ? 'Assigning...' : 'Assign to Patient'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Assigned Materials History */}
      {assignedMaterials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Assignment History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {assignedMaterials.map(assignment => {
              const material = materials.find(m => m.id === assignment.material_id);
              return (
                <div key={assignment.id} className="p-3 bg-slate-50 dark:bg-slate-900 rounded border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-medium text-slate-900 dark:text-slate-100">{material?.title}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Assigned {format(new Date(assignment.assigned_date), 'MMM d, yyyy')}
                      </p>
                    </div>
                    <Badge className={
                      assignment.status === 'completed' ? 'bg-green-100 text-green-800' :
                      assignment.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                      'bg-slate-200 text-slate-800'
                    }>
                      {assignment.status}
                    </Badge>
                  </div>
                  {assignment.comprehension_level && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
                      Understanding: {assignment.comprehension_level}
                    </p>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function format(date, formatStr) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = new Date(date);
  const formatMap = {
    'MMM d, yyyy': `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
    'MMM d': `${months[d.getMonth()]} ${d.getDate()}`
  };
  return formatMap[formatStr] || d.toLocaleDateString();
}