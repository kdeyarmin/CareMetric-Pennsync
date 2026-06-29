import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Target, Sparkles, CheckCircle2 } from "lucide-react";

export default function AICarePlanGenerator({ patientDiagnosis, patientNeeds, onCarePlanGenerated }) {
  const ai = useAICall();
  const [generatedPlan, setGeneratedPlan] = useState(null);
  const [diagnosis, setDiagnosis] = useState(patientDiagnosis || "");
  const [needs, setNeeds] = useState(patientNeeds || "");

  const generateCarePlan = async () => {
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive home health care plan based on the following patient information:

PRIMARY DIAGNOSIS:
${diagnosis}

PATIENT NEEDS / CLINICAL SITUATION:
${needs || 'Standard home health needs for this diagnosis'}

Create a detailed care plan including:

1. **NURSING DIAGNOSES** (3-5 relevant NANDA nursing diagnoses)
2. **GOALS** (Specific, measurable, time-bound goals)
3. **INTERVENTIONS** (Detailed nursing interventions with frequency)
4. **PATIENT EDUCATION** (Key topics to cover)
5. **MONITORING PARAMETERS** (Vital signs, symptoms to track)
6. **SAFETY MEASURES** (Fall prevention, medication safety, etc.)
7. **DISCHARGE CRITERIA** (When patient can be discharged from home health)

Make the care plan specific to home health nursing, focusing on skilled nursing needs, patient/caregiver education, and functional improvement. Include frequency of visits and duration estimates.`,
        response_json_schema: {
          type: "object",
          properties: {
            nursing_diagnoses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  related_to: { type: "string" },
                  evidenced_by: { type: "string" }
                }
              }
            },
            goals: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  goal: { type: "string" },
                  timeframe: { type: "string" },
                  measurement: { type: "string" }
                }
              }
            },
            interventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  intervention: { type: "string" },
                  frequency: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            patient_education_topics: { type: "array", items: { type: "string" } },
            monitoring_parameters: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  parameter: { type: "string" },
                  frequency: { type: "string" },
                  alert_criteria: { type: "string" }
                }
              }
            },
            safety_measures: { type: "array", items: { type: "string" } },
            discharge_criteria: { type: "array", items: { type: "string" } },
            recommended_visit_frequency: { type: "string" },
            estimated_duration: { type: "string" }
          }
        }
      });

      setGeneratedPlan(result);
      onCarePlanGenerated?.(result);
    } catch (error) {
      console.error("Error generating care plan:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-green-200">
        <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="w-5 h-5 text-green-600" />
            AI Care Plan Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div>
            <label htmlFor="primary-diagnosis" className="text-sm font-medium text-slate-700 mb-2 block">
              Primary Diagnosis
            </label>
            <input
              id="primary-diagnosis"
              type="text"
              value={diagnosis}
              onChange={(e) => setDiagnosis(e.target.value)}
              placeholder="e.g., CHF, Diabetes with complications, Post-surgical recovery"
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <div>
            <label htmlFor="patient-needs" className="text-sm font-medium text-slate-700 mb-2 block">
              Patient Needs / Clinical Situation (Optional)
            </label>
            <textarea
              id="patient-needs"
              value={needs}
              onChange={(e) => setNeeds(e.target.value)}
              placeholder="Additional information about patient's condition, limitations, support system..."
              rows={3}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>

          <Button
            onClick={generateCarePlan}
            disabled={ai.loading || !diagnosis.trim()}
            className="w-full bg-green-600 hover:bg-green-700"
          >
            {ai.loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Care Plan...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate Care Plan
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {generatedPlan && (
        <Card className="border-2 border-blue-200">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
                Generated Care Plan
              </CardTitle>
              <div className="flex gap-2 text-xs">
                {generatedPlan.recommended_visit_frequency && (
                  <Badge variant="outline">{generatedPlan.recommended_visit_frequency}</Badge>
                )}
                {generatedPlan.estimated_duration && (
                  <Badge variant="outline">{generatedPlan.estimated_duration}</Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Nursing Diagnoses */}
            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
              <h3 className="font-semibold text-navy-900 mb-3">Nursing Diagnoses</h3>
              <div className="space-y-3">
                {generatedPlan.nursing_diagnoses?.map((dx, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border">
                    <p className="font-medium text-slate-900 mb-1">{dx.diagnosis}</p>
                    <p className="text-xs text-slate-600">Related to: {dx.related_to}</p>
                    <p className="text-xs text-slate-600">Evidenced by: {dx.evidenced_by}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Goals */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h3 className="font-semibold text-blue-900 mb-3">Patient Goals</h3>
              <div className="space-y-2">
                {generatedPlan.goals?.map((goal, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border">
                    <div className="flex items-start gap-2">
                      <Target className="w-4 h-4 text-blue-600 mt-1 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-slate-900">{goal.goal}</p>
                        <div className="flex gap-3 mt-1">
                          <Badge className="text-xs">{goal.timeframe}</Badge>
                          <span className="text-xs text-slate-600">{goal.measurement}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Interventions */}
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <h3 className="font-semibold text-green-900 mb-3">Nursing Interventions</h3>
              <div className="space-y-2">
                {generatedPlan.interventions?.map((intervention, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <Badge className="text-xs">{intervention.category}</Badge>
                      <Badge variant="outline" className="text-xs">{intervention.frequency}</Badge>
                    </div>
                    <p className="text-sm font-medium text-slate-900 mb-1">{intervention.intervention}</p>
                    <p className="text-xs text-slate-600 italic">{intervention.rationale}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Patient Education */}
            <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
              <h3 className="font-semibold text-yellow-900 mb-2">Patient Education Topics</h3>
              <ul className="space-y-1">
                {generatedPlan.patient_education_topics?.map((topic, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                    {topic}
                  </li>
                ))}
              </ul>
            </div>

            {/* Monitoring Parameters */}
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <h3 className="font-semibold text-orange-900 mb-2">Monitoring Parameters</h3>
              <div className="space-y-2">
                {generatedPlan.monitoring_parameters?.map((param, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-slate-900">{param.parameter}</span>
                      <Badge className="text-xs">{param.frequency}</Badge>
                    </div>
                    <p className="text-xs text-red-700">Alert if: {param.alert_criteria}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Safety Measures */}
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <h3 className="font-semibold text-red-900 mb-2">Safety Measures</h3>
              <ul className="space-y-1">
                {generatedPlan.safety_measures?.map((measure, idx) => (
                  <li key={idx} className="text-sm text-slate-700">• {measure}</li>
                ))}
              </ul>
            </div>

            {/* Discharge Criteria */}
            <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
              <h3 className="font-semibold text-indigo-900 mb-2">Discharge Criteria</h3>
              <ul className="space-y-1">
                {generatedPlan.discharge_criteria?.map((criteria, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
                    {criteria}
                  </li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}