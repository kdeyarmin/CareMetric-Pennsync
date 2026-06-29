import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Calendar,
  FileText,
  Clock,
  Copy
} from "lucide-react";
import { toast } from "sonner";

export default function AICarePlanAnalyzer({
  patientId,
  patientName,
  diagnosis,
  careType = "home_health",
  assessmentData = null,
  onInterventionsGenerated
}) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);
  const [selectedInterventions, setSelectedInterventions] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const generateAnalysis = async () => {
    if (!diagnosis || !assessmentData) {
      toast.error("Please provide diagnosis and assessment data");
      return;
    }

    try {
      const protocolType = careType === "hospice" ? "Hospice" : "Home Health";
      
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert ${protocolType} care planner specializing in personalized interventions and visit schedules.

PATIENT: ${patientName}
PRIMARY DIAGNOSIS: ${diagnosis}
CARE TYPE: ${protocolType}

ASSESSMENT DATA:
${JSON.stringify(assessmentData, null, 2)}

Analyze this patient and provide:

1. PERSONALIZED INTERVENTION STEPS (3-5 key interventions based on assessment findings)
2. RECOMMENDED VISIT FREQUENCY (specific schedule for this care type and patient profile)
3. PROTOCOL-SPECIFIC DOCUMENTATION TEMPLATES (tailored to ${protocolType} requirements)

Return JSON:
{
  "risk_assessment": {
    "overall_risk_level": "low" | "moderate" | "high",
    "key_risk_factors": ["factor1", "factor2", ...],
    "clinical_rationale": "Brief explanation"
  },
  "personalized_interventions": [
    {
      "name": "Intervention name",
      "description": "Specific, actionable intervention",
      "rationale": "Why this intervention for this patient",
      "measurement": "How to measure success",
      "frequency": "How often to perform"
    }
  ],
  "visit_schedule": {
    "initial_visit": "Within X days",
    "routine_frequency": "E.g., 2x weekly",
    "assessment_frequency": "E.g., At each visit",
    "phone_follow_up": "E.g., Between visits as needed",
    "skilled_nursing_hours_per_visit": "Estimated minutes",
    "rationale": "Why this schedule for this patient"
  },
  "documentation_templates": [
    {
      "template_name": "E.g., Initial Assessment",
      "template_type": "${protocolType}",
      "key_sections": ["Section 1", "Section 2", ...],
      "compliance_notes": "Medicare/regulatory requirements"
    }
  ],
  "clinical_summary": "2-3 sentence summary of the care plan approach"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            risk_assessment: {
              type: "object",
              properties: {
                overall_risk_level: { type: "string" },
                key_risk_factors: { type: "array", items: { type: "string" } },
                clinical_rationale: { type: "string" }
              }
            },
            personalized_interventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  rationale: { type: "string" },
                  measurement: { type: "string" },
                  frequency: { type: "string" }
                }
              }
            },
            visit_schedule: {
              type: "object",
              properties: {
                initial_visit: { type: "string" },
                routine_frequency: { type: "string" },
                assessment_frequency: { type: "string" },
                phone_follow_up: { type: "string" },
                skilled_nursing_hours_per_visit: { type: "string" },
                rationale: { type: "string" }
              }
            },
            documentation_templates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  template_name: { type: "string" },
                  template_type: { type: "string" },
                  key_sections: { type: "array", items: { type: "string" } },
                  compliance_notes: { type: "string" }
                }
              }
            },
            clinical_summary: { type: "string" }
          }
        }
      });

      setAnalysis(result);
      // Auto-select all interventions
      const autoSelected = {};
      result.personalized_interventions?.forEach((_, idx) => {
        autoSelected[idx] = true;
      });
      setSelectedInterventions(autoSelected);
    } catch (error) {
      console.error("Error analyzing care plan:", error);
      toast.error("Failed to generate analysis");
    }
  };

  const handleSaveAnalysis = async () => {
    if (!patientId) {
      toast.error("Please select a patient");
      return;
    }

    setIsSaving(true);
    try {
      // Save analysis as a care plan note/summary
      const selectedInterventionsList = (analysis.personalized_interventions || [])
        .filter((_, idx) => selectedInterventions[idx])
        .map(i => ({
          name: i.name,
          description: i.description,
          frequency: i.frequency
        }));

      await base44.entities.CarePlan.create({
        patient_id: patientId,
        problem: diagnosis,
        goal: `Implement personalized ${careType} care plan with ${selectedInterventionsList.length} key interventions`,
        interventions: selectedInterventionsList.map(i => `${i.name}: ${i.description}`),
        frequency: analysis.visit_schedule?.routine_frequency,
        status: "active",
        ai_generated: true,
        visit_schedule: JSON.stringify(analysis.visit_schedule),
        documentation_templates: JSON.stringify(analysis.documentation_templates)
      });

      toast.success("Care plan analysis saved");
      
      if (onInterventionsGenerated) {
        onInterventionsGenerated(selectedInterventionsList, analysis.visit_schedule);
      }
    } catch (error) {
      console.error("Error saving analysis:", error);
      toast.error("Failed to save care plan");
    }
    setIsSaving(false);
  };

  const getRiskColor = (level) => {
    const colors = {
      low: "bg-green-100 text-green-800 border-green-300",
      moderate: "bg-yellow-100 text-yellow-800 border-yellow-300",
      high: "bg-red-100 text-red-800 border-red-300"
    };
    return colors[level] || "bg-slate-100 text-slate-800";
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-blue-50 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI Care Plan Analyzer
        </CardTitle>
        <p className="text-sm text-slate-600 mt-2">
          Analyzes patient assessments to generate personalized interventions, visit schedules, and documentation templates
        </p>
      </CardHeader>

      <CardContent className="p-4">
        {!analysis ? (
          <div className="space-y-4">
            <Button
              onClick={generateAnalysis}
              disabled={ai.loading || !diagnosis || !assessmentData}
              className="w-full bg-navy-600 hover:bg-navy-700"
              size="lg"
            >
              {ai.loading ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing Patient Data...</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" /> Generate Personalized Care Plan</>
              )}
            </Button>
            {!diagnosis && (
              <Alert className="bg-amber-50 border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  Diagnosis and assessment data required
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="interventions">Interventions</TabsTrigger>
              <TabsTrigger value="schedule">Visit Schedule</TabsTrigger>
              <TabsTrigger value="templates">Templates</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">RISK ASSESSMENT</p>
                  <Badge className={getRiskColor(analysis.risk_assessment?.overall_risk_level)}>
                    {analysis.risk_assessment?.overall_risk_level?.toUpperCase()}
                  </Badge>
                </div>

                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">KEY RISK FACTORS</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.risk_assessment?.key_risk_factors?.map((factor, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {factor}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-sm text-blue-900">
                    {analysis.risk_assessment.clinical_rationale}
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                  <p className="text-sm text-slate-700 font-medium">Clinical Approach:</p>
                  <p className="text-sm text-slate-600 mt-1">{analysis.clinical_summary}</p>
                </div>
              </div>
            </TabsContent>

            {/* Interventions Tab */}
            <TabsContent value="interventions" className="space-y-3 mt-4">
              {analysis.personalized_interventions?.map((intervention, idx) => (
                <Card key={idx} className="border-slate-200">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-slate-900">{intervention.name}</h4>
                        <p className="text-sm text-slate-600 mt-1">{intervention.description}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedInterventions[idx] || false}
                        onChange={() => setSelectedInterventions(prev => ({
                          ...prev,
                          [idx]: !prev[idx]
                        }))}
                        className="mt-1"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded">
                      <div>
                        <p className="font-medium text-slate-700">Frequency:</p>
                        <p>{intervention.frequency}</p>
                      </div>
                      <div>
                        <p className="font-medium text-slate-700">Measurement:</p>
                        <p>{intervention.measurement}</p>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 italic">
                      <strong>Why:</strong> {intervention.rationale}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>

            {/* Visit Schedule Tab */}
            <TabsContent value="schedule" className="mt-4">
              <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-900 flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      Initial Visit
                    </p>
                    <p className="text-slate-600 text-xs mt-1">{analysis.visit_schedule.initial_visit}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900 flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      Routine Frequency
                    </p>
                    <p className="text-slate-600 text-xs mt-1">{analysis.visit_schedule.routine_frequency}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Assessment Frequency</p>
                    <p className="text-slate-600 text-xs mt-1">{analysis.visit_schedule.assessment_frequency}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-slate-900">Skilled Nursing Hours</p>
                    <p className="text-slate-600 text-xs mt-1">{analysis.visit_schedule.skilled_nursing_hours_per_visit}/visit</p>
                  </div>
                </div>
                <div className="border-t border-amber-300 pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-1">Phone Follow-up:</p>
                  <p className="text-sm text-slate-700">{analysis.visit_schedule.phone_follow_up}</p>
                </div>
                <div className="border-t border-amber-300 pt-3 bg-white rounded p-2">
                  <p className="text-xs font-medium text-slate-600 mb-1">Rationale:</p>
                  <p className="text-sm text-slate-700">{analysis.visit_schedule.rationale}</p>
                </div>
              </div>
            </TabsContent>

            {/* Documentation Templates Tab */}
            <TabsContent value="templates" className="space-y-3 mt-4">
              {analysis.documentation_templates?.map((template, idx) => (
                <Card key={idx} className="border-slate-200">
                  <CardContent className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-600" />
                          {template.template_name}
                        </h4>
                        <Badge variant="outline" className="mt-1">{template.template_type}</Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={async () => {
                          const text = [
                            template.template_name,
                            template.template_type ? `Type: ${template.template_type}` : '',
                            template.key_sections?.length ? `\nKey Sections:\n${template.key_sections.map((s) => `- ${s}`).join('\n')}` : '',
                            template.compliance_notes ? `\nCompliance Notes:\n${template.compliance_notes}` : '',
                          ].filter(Boolean).join('\n');
                          try {
                            await navigator.clipboard.writeText(text);
                            toast.success('Template copied to clipboard');
                          } catch {
                            toast.error('Could not copy to clipboard');
                          }
                        }}
                      >
                        <Copy className="w-3 h-3" /> Copy
                      </Button>
                    </div>
                    <div className="text-xs space-y-2">
                      <div>
                        <p className="font-medium text-slate-700">Key Sections:</p>
                        <ul className="list-disc list-inside text-slate-600 ml-2 mt-1">
                          {template.key_sections?.map((section, sIdx) => (
                            <li key={sIdx}>{section}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="bg-blue-50 p-2 rounded">
                        <p className="font-medium text-blue-900 mb-1">Compliance Notes:</p>
                        <p className="text-blue-800">{template.compliance_notes}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        )}

        {analysis && (
          <div className="flex gap-2 mt-6 pt-4 border-t">
            <Button
              onClick={handleSaveAnalysis}
              disabled={isSaving || Object.values(selectedInterventions).every(v => !v)}
              className="flex-1 bg-navy-600 hover:bg-navy-700"
            >
              {isSaving ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-2" /> Save Care Plan</>
              )}
            </Button>
            <Button variant="outline" onClick={() => setAnalysis(null)}>
              Reset
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}