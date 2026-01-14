import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { getCarePlanPrompt, PROVIDER_CARE_PLAN_FOCUS } from "../utils/providerSpecificConfig";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Loader2,
  Target,
  CheckCircle2,
  Edit2,
  X,
  Plus,
  AlertCircle,
  ClipboardList,
  Calendar
} from "lucide-react";
import { format, addDays } from "date-fns";

export default function AICarePlanGenerator({
  patientId,
  patientName,
  diagnosis,
  careType = "home_health",
  extractedData = null,
  existingCarePlans = [],
  onCarePlansCreated
}) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPlans, setGeneratedPlans] = useState([]);
  const [selectedPlans, setSelectedPlans] = useState({});
  const [editingPlan, setEditingPlan] = useState(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createdCount, setCreatedCount] = useState(0);

  const generateCarePlans = async () => {
    if (!diagnosis) {
      alert("Please provide a diagnosis to generate care plans.");
      return;
    }

    setIsGenerating(true);
    setGeneratedPlans([]);
    setCreatedCount(0);

    try {
      // Build context from extracted data
      let additionalContext = "";
      if (extractedData) {
        // Enhanced note takes priority for context
        if (extractedData.enhanced_note) {
          additionalContext += `\n\nCOMPLETE CLINICAL DOCUMENTATION:\n${extractedData.enhanced_note}`;
        }
        
        if (extractedData.vital_signs) {
          const vitals = Object.entries(extractedData.vital_signs)
            .filter(([_, v]) => v && k !== 'o2Source' && k !== 'o2Flow')
            .map(([k, v]) => `${k}: ${v}`)
            .join(', ');
          if (vitals) additionalContext += `\n\nVITAL SIGNS: ${vitals}`;
        }
        
        if (extractedData.symptoms?.length > 0) {
          additionalContext += `\nIDENTIFIED SYMPTOMS:\n${extractedData.symptoms.map(s => `- ${s.symptom} (${s.severity})`).join('\n')}`;
        }
        
        if (extractedData.medications?.length > 0) {
          additionalContext += `\nMEDICATIONS:\n${extractedData.medications.map(m => `- ${m.name}`).join('\n')}`;
        }
      }

      // Get existing care plan problems to avoid duplicates
      const existingProblems = existingCarePlans.map(cp => cp.problem?.toLowerCase()).filter(Boolean);

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are an expert home health/hospice clinical documentation specialist. Generate comprehensive, Medicare-compliant care plans based on actual clinical documentation.

PATIENT: ${patientName || 'Patient'}
PRIMARY DIAGNOSIS: ${diagnosis}
CARE TYPE: ${careType === 'hospice' ? 'Hospice' : 'Home Health'}
${additionalContext}

EXISTING CARE PLANS (avoid duplicating these):
${existingProblems.length > 0 ? existingProblems.join('\n') : 'None'}

Analyze the clinical documentation above and generate 3-5 appropriate care plans that directly address the patient's documented needs, problems, and clinical findings. Each care plan MUST be:

1. MEDICARE COMPLIANT:
   - Problem statement must be a nursing diagnosis, not a medical diagnosis
   - Goals must be SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
   - Interventions must require skilled nursing judgment
   ${careType === 'home_health' ? '- Must support homebound status and skilled need' : '- Must focus on comfort and symptom management'}

2. EVIDENCE-BASED:
   - Use current clinical guidelines
   - Include appropriate assessment frequencies
   - Specify measurable outcomes

3. PATIENT-CENTERED:
   - Consider functional limitations
   - Include patient/caregiver education
   - Address quality of life

Return JSON:
{
  "care_plans": [
    {
      "problem": "Nursing diagnosis statement (e.g., 'Risk for falls related to...')",
      "goal": "SMART goal with specific measurable outcome and timeframe",
      "interventions": [
        "Specific skilled nursing intervention 1",
        "Specific skilled nursing intervention 2",
        "Patient/caregiver education intervention",
        "Coordination/communication intervention"
      ],
      "baseline_measurement": "What to measure at baseline",
      "frequency": "Assessment frequency (e.g., 'Each visit', 'Weekly')",
      "target_days": 30 or 60,
      "priority": "high" | "medium" | "low",
      "rationale": "Clinical rationale for this care plan",
      "expected_outcome": "What success looks like"
    }
  ],
  "clinical_notes": "Any additional clinical considerations for the clinician"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            care_plans: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  baseline_measurement: { type: "string" },
                  frequency: { type: "string" },
                  target_days: { type: "number" },
                  priority: { type: "string" },
                  rationale: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            clinical_notes: { type: "string" }
          }
        }
      });

      setGeneratedPlans(result.care_plans || []);
      
      // Auto-select high priority plans
      const autoSelected = {};
      result.care_plans?.forEach((plan, idx) => {
        if (plan.priority === 'high') {
          autoSelected[idx] = true;
        }
      });
      setSelectedPlans(autoSelected);

    } catch (error) {
      console.error("Error generating care plans:", error);
      alert("Error generating care plans. Please try again.");
    }
    setIsGenerating(false);
  };

  const togglePlanSelection = (idx) => {
    setSelectedPlans(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const selectAllPlans = () => {
    const allSelected = {};
    generatedPlans.forEach((_, idx) => {
      allSelected[idx] = true;
    });
    setSelectedPlans(allSelected);
  };

  const handleEditPlan = (idx) => {
    setEditingPlan({ idx, ...generatedPlans[idx] });
  };

  const handleSaveEdit = () => {
    if (editingPlan) {
      const updated = [...generatedPlans];
      updated[editingPlan.idx] = {
        problem: editingPlan.problem,
        goal: editingPlan.goal,
        interventions: editingPlan.interventions,
        baseline_measurement: editingPlan.baseline_measurement,
        frequency: editingPlan.frequency,
        target_days: editingPlan.target_days,
        priority: editingPlan.priority,
        rationale: editingPlan.rationale,
        expected_outcome: editingPlan.expected_outcome
      };
      setGeneratedPlans(updated);
      setEditingPlan(null);
    }
  };

  const handleAddIntervention = () => {
    if (editingPlan) {
      setEditingPlan({
        ...editingPlan,
        interventions: [...editingPlan.interventions, ""]
      });
    }
  };

  const handleRemoveIntervention = (interventionIdx) => {
    if (editingPlan) {
      setEditingPlan({
        ...editingPlan,
        interventions: editingPlan.interventions.filter((_, i) => i !== interventionIdx)
      });
    }
  };

  const handleInterventionChange = (interventionIdx, value) => {
    if (editingPlan) {
      const updated = [...editingPlan.interventions];
      updated[interventionIdx] = value;
      setEditingPlan({ ...editingPlan, interventions: updated });
    }
  };

  const createSelectedCarePlans = async () => {
    if (!patientId) {
      alert("Please select a patient first.");
      return;
    }

    const selected = generatedPlans.filter((_, idx) => selectedPlans[idx]);
    if (selected.length === 0) {
      alert("Please select at least one care plan to create.");
      return;
    }

    setIsCreating(true);
    try {
      const createdPlans = [];
      for (const plan of selected) {
        const targetDate = format(addDays(new Date(), plan.target_days || 60), 'yyyy-MM-dd');
        
        const carePlan = await base44.entities.CarePlan.create({
          patient_id: patientId,
          problem: plan.problem,
          goal: plan.goal,
          interventions: plan.interventions,
          baseline_measurement: plan.baseline_measurement,
          frequency: plan.frequency,
          target_date: targetDate,
          status: 'active'
        });
        createdPlans.push(carePlan);
      }

      setCreatedCount(createdPlans.length);
      setSelectedPlans({});
      
      if (onCarePlansCreated) {
        onCarePlansCreated(createdPlans);
      }

    } catch (error) {
      console.error("Error creating care plans:", error);
      alert("Error creating care plans. Please try again.");
    }
    setIsCreating(false);
  };

  // REMOVED: Auto-task generation was creating too many tasks without user control
  // Tasks now generated only when user explicitly requests via TaskGenerator

  const getPriorityColor = (priority) => {
    const colors = {
      high: "bg-red-100 text-red-800 border-red-300",
      medium: "bg-yellow-100 text-yellow-800 border-yellow-300",
      low: "bg-blue-100 text-blue-800 border-blue-300"
    };
    return colors[priority] || "bg-gray-100 text-gray-800";
  };

  const selectedCount = Object.values(selectedPlans).filter(Boolean).length;

  return (
    <Card className="border-2 border-green-200">
      <CardHeader className="py-4 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-green-600" />
            AI Care Plan Generator
          </div>
          {diagnosis && (
            <Badge variant="outline" className="text-xs">
              {diagnosis}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {generatedPlans.length === 0 ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Generate Medicare-compliant care plans based on the patient's diagnosis and clinical data.
              The AI will create SMART goals, evidence-based interventions, and measurable outcomes.
            </p>
            <Button
              onClick={generateCarePlans}
              disabled={isGenerating || !diagnosis}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {isGenerating ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Care Plans...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Care Plans from Diagnosis</>
              )}
            </Button>
            {!diagnosis && (
              <p className="text-xs text-orange-600 text-center">
                Select a diagnosis to generate care plans
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {/* Success Message */}
            {createdCount > 0 && (
              <Alert className="bg-green-50 border-green-200">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  Successfully created {createdCount} care plan(s)!
                </AlertDescription>
              </Alert>
            )}

            {/* Selection Controls */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {generatedPlans.length} care plan(s) generated
              </span>
              <Button size="sm" variant="outline" onClick={selectAllPlans}>
                Select All
              </Button>
            </div>

            {/* Generated Plans List */}
            <div className="space-y-3 max-h-[500px] overflow-y-auto">
              {generatedPlans.map((plan, idx) => (
                <Card 
                  key={idx} 
                  className={`border transition-all ${
                    selectedPlans[idx] 
                      ? 'border-green-400 bg-green-50' 
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <CardContent className="p-4">
                    {editingPlan?.idx === idx ? (
                      /* Edit Mode */
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-gray-600">Problem/Nursing Diagnosis</label>
                          <Textarea
                            value={editingPlan.problem}
                            onChange={(e) => setEditingPlan({...editingPlan, problem: e.target.value})}
                            className="mt-1 text-sm"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600">SMART Goal</label>
                          <Textarea
                            value={editingPlan.goal}
                            onChange={(e) => setEditingPlan({...editingPlan, goal: e.target.value})}
                            className="mt-1 text-sm"
                            rows={2}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-600 flex items-center justify-between">
                            Interventions
                            <Button size="sm" variant="ghost" className="h-6" onClick={handleAddIntervention}>
                              <Plus className="w-3 h-3 mr-1" /> Add
                            </Button>
                          </label>
                          <div className="space-y-2 mt-1">
                            {editingPlan.interventions.map((intervention, iIdx) => (
                              <div key={iIdx} className="flex gap-2">
                                <Input
                                  value={intervention}
                                  onChange={(e) => handleInterventionChange(iIdx, e.target.value)}
                                  className="text-sm flex-1"
                                  placeholder="Intervention..."
                                />
                                <Button 
                                  size="sm" 
                                  variant="ghost" 
                                  className="h-9 w-9 p-0 text-red-500"
                                  onClick={() => handleRemoveIntervention(iIdx)}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600">Baseline Measurement</label>
                            <Input
                              value={editingPlan.baseline_measurement}
                              onChange={(e) => setEditingPlan({...editingPlan, baseline_measurement: e.target.value})}
                              className="mt-1 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600">Frequency</label>
                            <Input
                              value={editingPlan.frequency}
                              onChange={(e) => setEditingPlan({...editingPlan, frequency: e.target.value})}
                              className="mt-1 text-sm"
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="text-xs font-medium text-gray-600">Target Days</label>
                            <Input
                              type="number"
                              value={editingPlan.target_days}
                              onChange={(e) => setEditingPlan({...editingPlan, target_days: parseInt(e.target.value)})}
                              className="mt-1 text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs font-medium text-gray-600">Priority</label>
                            <Select 
                              value={editingPlan.priority} 
                              onValueChange={(v) => setEditingPlan({...editingPlan, priority: v})}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="high">High</SelectItem>
                                <SelectItem value="medium">Medium</SelectItem>
                                <SelectItem value="low">Low</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2 border-t">
                          <Button size="sm" variant="outline" onClick={() => setEditingPlan(null)}>
                            Cancel
                          </Button>
                          <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={handleSaveEdit}>
                            <CheckCircle2 className="w-4 h-4 mr-1" /> Save Changes
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* View Mode */
                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <Checkbox
                            checked={selectedPlans[idx] || false}
                            onCheckedChange={() => togglePlanSelection(idx)}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge className={getPriorityColor(plan.priority)}>
                                {plan.priority}
                              </Badge>
                              <Badge variant="outline" className="text-xs">
                                <Calendar className="w-3 h-3 mr-1" />
                                {plan.target_days} days
                              </Badge>
                            </div>
                            <h4 className="font-semibold text-gray-900">{plan.problem}</h4>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="shrink-0"
                            onClick={() => handleEditPlan(idx)}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </div>

                        <div className="pl-7 space-y-2">
                          <div>
                            <p className="text-xs font-medium text-gray-500">SMART Goal:</p>
                            <p className="text-sm text-gray-700">{plan.goal}</p>
                          </div>

                          <div>
                            <p className="text-xs font-medium text-gray-500">Interventions:</p>
                            <ul className="text-sm text-gray-700 list-disc list-inside">
                              {plan.interventions.map((int, iIdx) => (
                                <li key={iIdx}>{int}</li>
                              ))}
                            </ul>
                          </div>

                          <div className="flex gap-4 text-xs text-gray-500">
                            <span><strong>Baseline:</strong> {plan.baseline_measurement}</span>
                            <span><strong>Frequency:</strong> {plan.frequency}</span>
                          </div>

                          {plan.expected_outcome && (
                            <div className="bg-blue-50 p-2 rounded text-xs text-blue-800">
                              <strong>Expected Outcome:</strong> {plan.expected_outcome}
                            </div>
                          )}

                          {plan.rationale && (
                            <p className="text-xs text-gray-500 italic">
                              💡 {plan.rationale}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700"
                onClick={createSelectedCarePlans}
                disabled={selectedCount === 0 || isCreating || !patientId}
              >
                {isCreating ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Creating...</>
                ) : (
                  <><CheckCircle2 className="w-4 h-4 mr-2" /> Create {selectedCount} Care Plan(s)</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setGeneratedPlans([]);
                  setCreatedCount(0);
                }}
              >
                Reset
              </Button>
            </div>

            {!patientId && selectedCount > 0 && (
              <p className="text-xs text-orange-600 text-center">
                <AlertCircle className="w-3 h-3 inline mr-1" />
                Select a patient to create care plans
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}