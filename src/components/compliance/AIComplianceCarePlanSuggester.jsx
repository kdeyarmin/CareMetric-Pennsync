import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, Loader2, CheckCircle2, Target, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function AIComplianceCarePlanSuggester({ patientId, autoGenerate = false }) {
  const [generating, setGenerating] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list(),
    select: (patients) => patients.find(p => p.id === patientId)
  });

  const { data: violations = [] } = useQuery({
    queryKey: ['patientViolations', patientId],
    queryFn: async () => {
      const visits = await base44.entities.Visit.filter({ patient_id: patientId });
      const carePlans = await base44.entities.CarePlan.filter({ patient_id: patientId });
      
      const visitIds = visits.map(v => v.id);
      const carePlanIds = carePlans.map(cp => cp.id);
      
      const allViolations = await base44.entities.ComplianceViolation.filter({ status: 'open' });
      return allViolations.filter(v => 
        (v.entity_type === 'visit' && visitIds.includes(v.entity_id)) ||
        (v.entity_type === 'care_plan' && carePlanIds.includes(v.entity_id))
      );
    },
    enabled: !!patientId
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisits', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }),
    enabled: !!patientId
  });

  const createCarePlanMutation = useMutation({
    mutationFn: (carePlanData) => base44.entities.CarePlan.create({
      ...carePlanData,
      patient_id: patientId
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientCarePlans', patientId] });
      toast.success("Care plan created successfully");
    }
  });

  React.useEffect(() => {
    if (autoGenerate && patient && violations.length > 0 && !suggestions && !generating) {
      handleGenerate();
    }
  }, [autoGenerate, patient, violations]);

  const handleGenerate = async () => {
    if (!patient) return;
    
    setGenerating(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert clinical care planner. Based on compliance gaps and patient needs, suggest targeted care plan updates.

PATIENT INFORMATION:
- Name: ${patient.first_name} ${patient.last_name}
- Diagnoses: ${patient.primary_diagnosis}, ${patient.secondary_diagnoses?.join(', ') || 'none'}
- Care Type: ${patient.care_type}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}

EXISTING CARE PLANS:
${carePlans.length === 0 ? 'No active care plans' : carePlans.map(cp => `
- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Status: ${cp.status}
  Interventions: ${cp.interventions?.join(', ') || 'none'}
`).join('\n')}

COMPLIANCE GAPS IDENTIFIED:
${violations.map(v => `
- ${v.rule_name} (${v.severity})
  Issue: ${v.violation_description}
  Recommended Action: ${v.recommended_action}
`).join('\n')}

RECENT VISIT NOTES (for context):
${visits.slice(0, 3).map(v => `
${v.visit_date} - ${v.visit_type}:
${v.nurse_notes?.substring(0, 200)}...
`).join('\n')}

Based on these compliance gaps and patient needs, suggest:
1. New care plans that address the identified compliance issues
2. Updates to existing care plans to close gaps
3. Preventive care plans to avoid future violations

For each suggestion, provide:
- problem: Clinical problem statement (must be specific and measurable)
- goal: SMART goal that addresses the compliance gap
- interventions: Specific interventions to achieve the goal
- rationale: Why this care plan addresses the compliance issue
- compliance_rules_addressed: Which violations this helps resolve
- priority: How urgent this care plan is`,
        response_json_schema: {
          type: "object",
          properties: {
            new_care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  rationale: { type: "string" },
                  compliance_rules_addressed: { type: "array", items: { type: "string" } },
                  priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  target_date: { type: "string" }
                }
              }
            },
            care_plan_updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  existing_plan_problem: { type: "string" },
                  suggested_changes: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            overall_recommendation: { type: "string" }
          }
        }
      });

      setSuggestions(response);
      toast.success(`Generated ${response.new_care_plans.length} care plan suggestions`);
    } catch (error) {
      toast.error("Failed to generate suggestions: " + error.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleCreateCarePlan = (suggestion) => {
    createCarePlanMutation.mutate({
      problem: suggestion.problem,
      goal: suggestion.goal,
      interventions: suggestion.interventions,
      target_date: suggestion.target_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'active'
    });
  };

  const priorityColors = {
    critical: "bg-red-600",
    high: "bg-orange-600",
    medium: "bg-yellow-600",
    low: "bg-blue-600"
  };

  if (violations.length === 0) {
    return (
      <Card className="border-green-200 bg-green-50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">No compliance gaps detected - care plans are adequate</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-purple-200 bg-purple-50">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600" />
          AI Care Plan Suggestions from Compliance Analysis
        </CardTitle>
        <p className="text-xs text-purple-700 mt-1">
          {violations.length} compliance gap{violations.length > 1 ? 's' : ''} detected - AI can suggest targeted care plans
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!suggestions ? (
          <div className="text-center py-4">
            <Button
              onClick={handleGenerate}
              disabled={generating}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {generating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating AI Suggestions...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Care Plan Suggestions
                </>
              )}
            </Button>
          </div>
        ) : (
          <>
            {/* Overall Recommendation */}
            <div className="p-3 bg-white rounded-lg border border-purple-200">
              <p className="text-sm font-semibold text-purple-900 mb-1">AI Recommendation</p>
              <p className="text-sm text-gray-700">{suggestions.overall_recommendation}</p>
            </div>

            {/* New Care Plan Suggestions */}
            {suggestions.new_care_plans.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Suggested New Care Plans ({suggestions.new_care_plans.length})</h4>
                <div className="space-y-3">
                  {suggestions.new_care_plans.map((suggestion, idx) => (
                    <Card key={idx} className="border-l-4 border-l-purple-500 bg-white">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <Badge className={priorityColors[suggestion.priority]}>
                            {suggestion.priority}
                          </Badge>
                          <Button
                            size="sm"
                            onClick={() => handleCreateCarePlan(suggestion)}
                            disabled={createCarePlanMutation.isPending}
                            className="bg-green-600 hover:bg-green-700"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add to Care Plans
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <p className="text-xs font-semibold text-gray-500">Problem</p>
                            <p className="text-sm font-medium text-gray-900">{suggestion.problem}</p>
                          </div>

                          <div>
                            <p className="text-xs font-semibold text-gray-500">Goal</p>
                            <p className="text-sm text-gray-800">{suggestion.goal}</p>
                          </div>

                          <div>
                            <p className="text-xs font-semibold text-gray-500">Interventions</p>
                            <ul className="space-y-1 mt-1">
                              {suggestion.interventions.map((intervention, i) => (
                                <li key={i} className="text-xs text-gray-700 flex items-start gap-2">
                                  <Target className="w-3 h-3 text-purple-600 mt-0.5 flex-shrink-0" />
                                  <span>{intervention}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="pt-2 border-t">
                            <p className="text-xs font-semibold text-gray-500">Why This Helps</p>
                            <p className="text-xs text-gray-700 mt-1">{suggestion.rationale}</p>
                          </div>

                          <div className="pt-2">
                            <p className="text-xs font-semibold text-gray-500">Addresses Compliance Rules</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {suggestion.compliance_rules_addressed.map((rule, i) => (
                                <Badge key={i} variant="outline" className="text-xs bg-purple-50">
                                  {rule}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Care Plan Updates */}
            {suggestions.care_plan_updates.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Suggested Updates to Existing Plans</h4>
                <div className="space-y-2">
                  {suggestions.care_plan_updates.map((update, idx) => (
                    <div key={idx} className="p-3 bg-white rounded-lg border border-blue-200">
                      <div className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs font-semibold text-gray-500">Plan: {update.existing_plan_problem}</p>
                          <p className="text-sm text-gray-800 mt-1">{update.suggested_changes}</p>
                          <p className="text-xs text-gray-600 mt-2 italic">{update.rationale}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={handleGenerate}
              className="w-full"
            >
              Regenerate Suggestions
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}