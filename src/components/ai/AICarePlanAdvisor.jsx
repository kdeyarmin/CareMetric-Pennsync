import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Target, CheckCircle, TrendingUp, Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AICarePlanAdvisor({ patientId, onRecommendationsGenerated }) {
  const [generating, setGenerating] = useState(false);
  const [recommendations, setRecommendations] = useState(null);
  const [selectedPatientId, setSelectedPatientId] = useState(patientId || "");

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list()
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', selectedPatientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', selectedPatientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: selectedPatientId }),
    enabled: !!selectedPatientId
  });

  const patient = patients.find(p => p.id === selectedPatientId);

  const generateRecommendations = async () => {
    if (!patient) return;

    setGenerating(true);
    try {
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const metGoals = carePlans.filter(cp => cp.status === 'met').length;
      const totalGoals = carePlans.length;
      const successRate = totalGoals > 0 ? ((metGoals / totalGoals) * 100).toFixed(1) : 0;
      
      const recentVisits = visits.slice(0, 5);
      const recentNotes = recentVisits.map(v => v.nurse_notes).filter(Boolean);
      
      const prompt = `As a clinical expert, analyze this patient's care and provide actionable care plan recommendations:

Patient Overview:
- Name: ${patient.first_name} ${patient.last_name}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Care Plan Success Rate: ${successRate}% (${metGoals}/${totalGoals} goals met)
- Functional Status: ${patient.functional_status?.ambulation || 'Unknown'}, ADL: ${patient.functional_status?.adl_independence || 'Unknown'}

Current Active Care Plans (${activeCarePlans.length}):
${activeCarePlans.map(cp => `
- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Status: ${cp.status}
  Interventions: ${cp.interventions?.join(', ') || 'None listed'}
`).join('\n')}

Recent Clinical Notes (last 5 visits):
${recentNotes.slice(0, 3).map((note, i) => `Visit ${i+1}: ${note.substring(0, 200)}...`).join('\n\n')}

Current Medications: ${patient.current_medications?.length || 0}
Allergies: ${patient.allergies || 'None'}
Past Medical History: ${patient.past_medical_history?.join(', ') || 'None'}

Based on this information, provide:
1. Recommended care plan adjustments (modifications to existing plans)
2. New care plan suggestions (new problems/goals to address)
3. Priority interventions (immediate actions needed)
4. Expected outcomes and timeframes
5. Coordination recommendations (who else should be involved)`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            adjustments: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  existing_problem: { type: "string" },
                  recommendation: { type: "string" },
                  rationale: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            new_care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" }
                }
              }
            },
            priority_interventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  intervention: { type: "string" },
                  timeframe: { type: "string" },
                  importance: { type: "string" }
                }
              }
            },
            coordination_needs: { type: "array", items: { type: "string" } }
          }
        }
      });

      setRecommendations(result);
      if (onRecommendationsGenerated) {
        onRecommendationsGenerated(result);
      }
      toast.success("Care plan recommendations generated");
    } catch (error) {
      console.error('Error generating recommendations:', error);
      toast.error("Failed to generate recommendations");
    }
    setGenerating(false);
  };

  const getPriorityColor = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-green-600" />
            AI Care Plan Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Select Patient</label>
            <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a patient" />
              </SelectTrigger>
              <SelectContent>
                {patients.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {patient && carePlans.length > 0 && (
            <div className="p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Current Care Plans</span>
                <Badge>{carePlans.length} total</Badge>
              </div>
              <div className="mt-2 flex gap-2">
                <Badge className="bg-green-100 text-green-800">
                  {carePlans.filter(cp => cp.status === 'met').length} met
                </Badge>
                <Badge className="bg-blue-100 text-blue-800">
                  {carePlans.filter(cp => cp.status === 'active').length} active
                </Badge>
              </div>
            </div>
          )}

          <Button 
            onClick={generateRecommendations} 
            disabled={!selectedPatientId || generating}
            className="w-full"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Recommendations...
              </>
            ) : (
              <>
                <Lightbulb className="w-4 h-4 mr-2" />
                Generate AI Recommendations
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {recommendations && (
        <div className="space-y-4">
          {/* Adjustments to Existing Care Plans */}
          {recommendations.adjustments?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Target className="w-5 h-5 text-blue-600" />
                  Recommended Care Plan Adjustments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {recommendations.adjustments.map((adj, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold">{adj.existing_problem}</h4>
                      <Badge className={getPriorityColor(adj.priority)}>
                        {adj.priority} Priority
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{adj.recommendation}</p>
                    <p className="text-xs text-gray-600 italic">{adj.rationale}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* New Care Plan Suggestions */}
          {recommendations.new_care_plans?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  New Care Plan Suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {recommendations.new_care_plans.map((plan, idx) => (
                  <div key={idx} className="bg-green-50 p-4 rounded-lg">
                    <h4 className="font-semibold text-green-900 mb-1">{plan.problem}</h4>
                    <p className="text-sm text-green-800 mb-2">
                      <strong>Goal:</strong> {plan.goal}
                    </p>
                    <div className="mb-2">
                      <p className="text-xs font-medium text-green-900 mb-1">Suggested Interventions:</p>
                      <ul className="space-y-1">
                        {plan.interventions?.map((intervention, iIdx) => (
                          <li key={iIdx} className="text-xs text-green-800 flex items-start gap-1">
                            <span>•</span>
                            <span>{intervention}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <p className="text-xs text-green-700 italic">{plan.rationale}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Priority Interventions */}
          {recommendations.priority_interventions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="w-5 h-5 text-orange-600" />
                  Priority Interventions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {recommendations.priority_interventions.map((intervention, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-orange-50 rounded-lg">
                      <div className="bg-orange-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-orange-900">{intervention.intervention}</p>
                        <div className="flex gap-3 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {intervention.timeframe}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {intervention.importance}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Coordination Needs */}
          {recommendations.coordination_needs?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Care Coordination</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {recommendations.coordination_needs.map((need, idx) => (
                    <li key={idx} className="text-sm text-gray-700 flex items-start gap-2">
                      <CheckCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span>{need}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}