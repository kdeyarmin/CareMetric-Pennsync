import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader, CheckCircle2, AlertCircle, BookOpen, ThumbsUp, Edit3 } from "lucide-react";
import { toast } from "sonner";
import NoteFeedbackForm from "./NoteFeedbackForm";
import InlineNoteEditor from "./InlineNoteEditor";

export default function EnhancedDocumentationAssistant({
  generatedNote = "",
  diagnosis = "",
  visitType = "",
  patientId = "",
  patientHistory = null,
  isLoading = false,
  roughNote = "",
  providerType = "RN"
}) {
  const [activeTab, setActiveTab] = useState("compliance");
  const [complianceAnalysis, setComplianceAnalysis] = useState(null);
  const [educationMaterials, setEducationMaterials] = useState(null);
  const [noteSummary, setNoteSummary] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [showInlineEditor, setShowInlineEditor] = useState(false);

  useEffect(() => {
    if (generatedNote && !isLoading) {
      runAnalysis();
    }
  }, [generatedNote, isLoading]);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      await Promise.all([
        analyzeCompliance(),
        suggestEducationMaterials(),
        generateSummary()
      ]);
    } catch (error) {
      toast.error("Analysis failed");
    }
    setAnalyzing(false);
  };

  const analyzeCompliance = async () => {
    try {
      const historyContext = patientHistory ? `

PATIENT HISTORY CONTEXT:
- Current Conditions: ${patientHistory.secondary_diagnoses?.join(', ') || 'N/A'}
- Allergies: ${patientHistory.allergies || 'None documented'}
- Current Medications: ${patientHistory.current_medications?.map(m => `${m.name} ${m.dosage || ''}`).join(', ') || 'N/A'}
- Functional Status: ${patientHistory.functional_status?.adl_independence || 'N/A'}
- Recent Vitals: BP ${patientHistory.baseline_vitals?.blood_pressure_systolic || 'N/A'}/${patientHistory.baseline_vitals?.blood_pressure_diastolic || 'N/A'}` : '';

      const visitTypeGuidelines = {
        admission: "Must include: homebound verification, skilled need justification, comprehensive assessment, baseline vitals, medications, allergies, prior history, functional assessment, living situation, initial care plan, patient education",
        routine_visit: "Must include: vital signs, patient response, assessment, interventions, education, care plan adherence, condition changes, safety assessment",
        recertification: "Must include: physician signature, updated assessment, progress toward goals, OASIS update, care plan modification, homebound re-verification, skilled need validation",
        discharge: "Must include: discharge reason, final assessment, goals status, disposition, discharge instructions, education summary, follow-up, physician notification",
        prn: "Must include: reason for visit, assessment, actions taken, patient response, physician notification, follow-up plan"
      };

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a Medicare home health compliance expert. Conduct comprehensive compliance analysis of this clinical note.

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}
${historyContext}

REQUIRED ELEMENTS FOR ${visitType.toUpperCase()}:
${visitTypeGuidelines[visitType] || visitTypeGuidelines.routine_visit}

CLINICAL NOTE:
${generatedNote}

Analyze completeness, Medicare CoP adherence (42 CFR 484), skilled nursing need justification, and OASIS alignment. Return JSON:
{
  "overall_score": (0-100),
  "completeness_percentage": (0-100),
  "compliance_status": "compliant/minor_gaps/major_gaps",
  "critical_issues": ["specific CMS regulation citation with issue"],
  "high_priority_gaps": ["missing element with why it matters"],
  "recommendations": ["specific action with regulatory reference"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number" },
            compliance_status: { type: "string" },
            findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  status: { type: "string" },
                  suggestion: { type: "string" }
                }
              }
            },
            completeness_percentage: { type: "number" },
            critical_issues: { type: "array", items: { type: "string" } },
            high_priority_gaps: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });
      setComplianceAnalysis(result);
    } catch (error) {
      console.error("Compliance analysis failed:", error);
    }
  };

  const suggestEducationMaterials = async () => {
    try {
      const historyContext = patientHistory ? `
PATIENT CONDITIONS: ${patientHistory.secondary_diagnoses?.join(', ') || diagnosis}
MEDICATIONS: ${patientHistory.current_medications?.map(m => m.name).join(', ') || 'N/A'}` : '';

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a patient education specialist for home health. Suggest relevant education materials based on the patient's diagnosis and visit type.

DIAGNOSIS: ${diagnosis}
VISIT TYPE: ${visitType}
${historyContext}

Return a JSON with education material suggestions:
{
  "materials": [
    {
      "topic": "Education topic",
      "description": "What patient should learn",
      "suggested_format": "video/handout/interactive",
      "priority": "high/medium/low",
      "key_points": ["point1", "point2"]
    }
  ],
  "teaching_focus": "Main focus areas for this patient"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            materials: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  description: { type: "string" },
                  suggested_format: { type: "string" },
                  priority: { type: "string" },
                  key_points: { type: "array", items: { type: "string" } }
                }
              }
            },
            teaching_focus: { type: "string" }
          }
        }
      });
      setEducationMaterials(result);
    } catch (error) {
      console.error("Education materials failed:", error);
    }
  };

  const generateSummary = async () => {
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Create a concise 2-3 sentence summary of this visit note for the patient's family/care team.

CLINICAL NOTE:
${generatedNote}

Return JSON:
{
  "patient_summary": "Summary in simple language",
  "key_findings": ["finding1", "finding2"],
  "next_steps": "What happens next"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            patient_summary: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            next_steps: { type: "string" }
          }
        }
      });
      setNoteSummary(result);
    } catch (error) {
      console.error("Summary generation failed:", error);
    }
  };

  if (!generatedNote) {
    return null;
  }

  return (
    <Card className="w-full border-purple-200 bg-purple-50">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-purple-600" />
            Documentation Assistant
          </CardTitle>
          {generatedNote && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowInlineEditor(!showInlineEditor)}
                className="text-xs"
              >
                <Edit3 className="w-3 h-3 mr-1" />
                Inline Feedback
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowFeedbackForm(!showFeedbackForm)}
                className="text-xs"
              >
                <ThumbsUp className="w-3 h-3 mr-1" />
                Overall Feedback
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="compliance" className="text-xs">Compliance</TabsTrigger>
                    <TabsTrigger value="education" className="text-xs">Education</TabsTrigger>
                    <TabsTrigger value="summary" className="text-xs">Summary</TabsTrigger>
                    <TabsTrigger value="inline" className="text-xs">Inline Feedback</TabsTrigger>
                  </TabsList>

          {/* Compliance Tab */}
          <TabsContent value="compliance" className="space-y-3 mt-4">
            {analyzing && <div className="flex items-center gap-2 text-sm text-purple-600"><Loader className="w-4 h-4 animate-spin" /> Analyzing...</div>}
            {complianceAnalysis && (
              <>
                <div className="bg-white p-3 rounded border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">Compliance Score</span>
                    <span className={`text-lg font-bold ${complianceAnalysis.overall_score >= 80 ? 'text-green-600' : complianceAnalysis.overall_score >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {complianceAnalysis.overall_score}%
                    </span>
                  </div>
                  <p className={`text-xs font-medium ${
                    complianceAnalysis.compliance_status === 'compliant' ? 'text-green-700' :
                    complianceAnalysis.compliance_status === 'minor_gaps' ? 'text-yellow-700' : 'text-red-700'
                  }`}>
                    {complianceAnalysis.compliance_status}
                  </p>
                </div>

                {complianceAnalysis.critical_issues?.length > 0 && (
                  <Alert className="bg-red-50 border-red-200">
                    <AlertCircle className="w-4 h-4 text-red-600" />
                    <AlertDescription className="text-xs text-red-800 mt-1">
                      <strong>Critical Issues:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {complianceAnalysis.critical_issues.map((issue, idx) => (
                          <li key={idx}>{issue}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {complianceAnalysis.high_priority_gaps?.length > 0 && (
                  <Alert className="bg-yellow-50 border-yellow-200">
                    <AlertCircle className="w-4 h-4 text-yellow-600" />
                    <AlertDescription className="text-xs text-yellow-800 mt-1">
                      <strong>High Priority Gaps:</strong>
                      <ul className="list-disc list-inside mt-1">
                        {complianceAnalysis.high_priority_gaps.map((gap, idx) => (
                          <li key={idx}>{gap}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}

                {complianceAnalysis.recommendations?.length > 0 && (
                  <div className="bg-white p-3 rounded border">
                    <p className="text-xs font-semibold mb-2">Recommendations:</p>
                    <ul className="space-y-1">
                      {complianceAnalysis.recommendations.map((rec, idx) => (
                        <li key={idx} className="text-xs text-gray-700 flex gap-2">
                          <CheckCircle2 className="w-3 h-3 text-blue-600 flex-shrink-0 mt-0.5" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </TabsContent>

          {/* Education Tab */}
          <TabsContent value="education" className="space-y-3 mt-4">
            {analyzing && <div className="flex items-center gap-2 text-sm text-purple-600"><Loader className="w-4 h-4 animate-spin" /> Analyzing...</div>}
            {educationMaterials?.materials && (
              <div className="space-y-2">
                <p className="text-xs text-gray-700 font-medium">Teaching Focus: {educationMaterials.teaching_focus}</p>
                {educationMaterials.materials.map((material, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h4 className="text-xs font-semibold text-gray-900">{material.topic}</h4>
                      <span className={`text-xs px-2 py-1 rounded ${
                        material.priority === 'high' ? 'bg-red-100 text-red-700' :
                        material.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                      }`}>
                        {material.priority}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mb-1">{material.description}</p>
                    <p className="text-xs text-gray-500 mb-1">Format: {material.suggested_format}</p>
                    <ul className="text-xs text-gray-700 space-y-0.5">
                      {material.key_points?.map((point, i) => (
                        <li key={i} className="flex gap-1">• {point}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Inline Feedback Tab */}
          <TabsContent value="inline" className="space-y-3 mt-4">
            <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200 dark:border-blue-800">
              <p className="text-xs text-blue-900 dark:text-blue-100">
                <strong>Select text in the note below</strong> and click "Suggest Improvement" to provide feedback on specific sections.
              </p>
            </div>
            <InlineNoteEditor
              noteContent={generatedNote}
              patientId={patientId}
              providerType={providerType}
              visitType={visitType}
              diagnosis={diagnosis}
            />
          </TabsContent>

          {/* Summary Tab */}
          <TabsContent value="summary" className="space-y-3 mt-4">
            {analyzing && <div className="flex items-center gap-2 text-sm text-purple-600"><Loader className="w-4 h-4 animate-spin" /> Analyzing...</div>}
            {noteSummary && (
              <>
                <div className="bg-white p-3 rounded border">
                  <p className="text-xs font-semibold mb-2">Visit Summary</p>
                  <p className="text-sm text-gray-700">{noteSummary.patient_summary}</p>
                </div>

                <div className="bg-white p-3 rounded border">
                  <p className="text-xs font-semibold mb-2">Key Findings</p>
                  <ul className="space-y-1">
                    {noteSummary.key_findings?.map((finding, idx) => (
                      <li key={idx} className="text-xs text-gray-700 flex gap-2">
                        <span className="text-blue-600">→</span> {finding}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-blue-50 p-3 rounded border border-blue-200">
                  <p className="text-xs font-semibold text-blue-900 mb-1">Next Steps</p>
                  <p className="text-xs text-blue-800">{noteSummary.next_steps}</p>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>

        {!analyzing && (
          <Button
            onClick={runAnalysis}
            size="sm"
            variant="outline"
            className="w-full mt-3 text-xs"
          >
            Re-analyze
          </Button>
        )}
      </CardContent>

      {showFeedbackForm && (
        <CardContent className="border-t pt-4">
          <NoteFeedbackForm
            generatedNote={generatedNote}
            roughNote={roughNote}
            patientId={patientId}
            providerType={providerType}
            visitType={visitType}
            diagnosis={diagnosis}
            onFeedbackSubmitted={() => {
              setShowFeedbackForm(false);
              toast.success("Thank you for your feedback!");
            }}
            onClose={() => setShowFeedbackForm(false)}
          />
        </CardContent>
      )}
    </Card>
  );
}