import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Loader2,
  Copy,
  Download,
  Sparkles,
  AlertTriangle
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export default function OASISDraftGenerator({
  patientData,
  clinicalContext,
  visitType = "admission",
  onDraftGenerated
}) {
  const ai = useAICall();
  const [draftDocumentation, setDraftDocumentation] = useState(null);
  const [activeTab, setActiveTab] = useState("narrative");

  const generateDraft = async () => {
    try {
      const prompt = `Generate comprehensive OASIS documentation based on patient context.

PATIENT DATA:
${JSON.stringify(patientData || {}, null, 2)}

CLINICAL CONTEXT:
${clinicalContext || 'No additional context provided'}

VISIT TYPE: ${visitType}

GENERATE:
1. Clinical narrative for OASIS assessment
2. Functional status documentation (M1800-M1860)
3. Clinical status documentation (wounds, pain, dyspnea)
4. Cognitive/behavioral documentation
5. Homebound justification
6. Skilled need justification
7. Goals and interventions
8. Safety assessment

Make documentation:
- Medicare-compliant
- Detailed and specific
- Objective and measurable
- Supportive of skilled need
- Defensible in audit`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            clinical_narrative: { type: "string" },
            functional_status: {
              type: "object",
              properties: {
                grooming: { type: "string" },
                dressing_upper: { type: "string" },
                dressing_lower: { type: "string" },
                bathing: { type: "string" },
                toileting: { type: "string" },
                transferring: { type: "string" },
                ambulation: { type: "string" },
                summary: { type: "string" }
              }
            },
            clinical_status: {
              type: "object",
              properties: {
                wounds_skin: { type: "string" },
                pain_management: { type: "string" },
                respiratory_status: { type: "string" },
                cardiac_status: { type: "string" },
                elimination: { type: "string" },
                nutrition_hydration: { type: "string" }
              }
            },
            cognitive_behavioral: {
              type: "object",
              properties: {
                cognitive_functioning: { type: "string" },
                behavioral_status: { type: "string" },
                depression_anxiety: { type: "string" }
              }
            },
            homebound_justification: { type: "string" },
            skilled_need_justification: { type: "string" },
            goals_and_interventions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  goal: { type: "string" },
                  interventions: { type: "array", items: { type: "string" } },
                  timeframe: { type: "string" }
                }
              }
            },
            safety_assessment: { type: "string" },
            medication_management: { type: "string" },
            caregiver_support: { type: "string" }
          }
        }
      });

      setDraftDocumentation(result);
      if (onDraftGenerated) {
        onDraftGenerated(result);
      }
    } catch (error) {
      console.error('Draft generation error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const exportAllDocumentation = () => {
    if (!draftDocumentation) return;
    
    const fullDoc = `OASIS DRAFT DOCUMENTATION — AI-GENERATED, REQUIRES CLINICIAN REVIEW
*** This is an AI-generated DRAFT. A licensed clinician must verify every item
*** against the actual assessment before it is used in the medical record.
*** It is NOT a vetted or attested clinical document. ***

Generated: ${new Date().toLocaleString()}
Patient: ${patientData?.first_name} ${patientData?.last_name}
Visit Type: ${visitType}

=== CLINICAL NARRATIVE ===
${draftDocumentation.clinical_narrative}

=== FUNCTIONAL STATUS ===
${Object.entries(draftDocumentation.functional_status || {}).map(([key, val]) => `${key.replace(/_/g, ' ').toUpperCase()}: ${val}`).join('\n\n')}

=== CLINICAL STATUS ===
${Object.entries(draftDocumentation.clinical_status || {}).map(([key, val]) => `${key.replace(/_/g, ' ').toUpperCase()}: ${val}`).join('\n\n')}

=== COGNITIVE/BEHAVIORAL ===
${Object.entries(draftDocumentation.cognitive_behavioral || {}).map(([key, val]) => `${key.replace(/_/g, ' ').toUpperCase()}: ${val}`).join('\n\n')}

=== HOMEBOUND JUSTIFICATION ===
${draftDocumentation.homebound_justification}

=== SKILLED NEED JUSTIFICATION ===
${draftDocumentation.skilled_need_justification}

=== GOALS AND INTERVENTIONS ===
${draftDocumentation.goals_and_interventions?.map((g, i) => `
Goal ${i + 1}: ${g.goal}
Problem: ${g.problem}
Interventions: ${g.interventions.join('; ')}
Timeframe: ${g.timeframe}
`).join('\n')}

=== SAFETY ASSESSMENT ===
${draftDocumentation.safety_assessment}

=== MEDICATION MANAGEMENT ===
${draftDocumentation.medication_management}

=== CAREGIVER SUPPORT ===
${draftDocumentation.caregiver_support}`;

    const blob = new Blob([fullDoc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `OASIS_Draft_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            OASIS Draft Documentation Generator
          </CardTitle>
          {!draftDocumentation && (
            <Button
              onClick={generateDraft}
              disabled={ai.loading}
              className="bg-navy-600 hover:bg-navy-700"
            >
              {ai.loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate Draft
                </>
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {!draftDocumentation && !ai.loading && (
          <div className="text-center py-8 text-slate-600">
            <FileText className="w-12 h-12 text-navy-400 mx-auto mb-3" />
            <p>Click "Generate Draft" to create comprehensive OASIS documentation</p>
          </div>
        )}

        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <p className="text-navy-700">Generating Medicare-compliant documentation...</p>
          </div>
        )}

        {draftDocumentation && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border-2 border-amber-300 bg-amber-50 px-3 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800"><strong>AI-generated draft.</strong> A licensed clinician must verify every item against the actual assessment before it is used in the medical record. This is not a vetted or attested clinical document.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={exportAllDocumentation}
              >
                <Download className="w-4 h-4 mr-2" />
                Export All
              </Button>
              <Button
                size="sm"
                onClick={generateDraft}
                disabled={ai.loading}
              >
                Regenerate
              </Button>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="narrative">Narrative</TabsTrigger>
                <TabsTrigger value="functional">Functional</TabsTrigger>
                <TabsTrigger value="clinical">Clinical</TabsTrigger>
                <TabsTrigger value="justification">Justification</TabsTrigger>
              </TabsList>

              <TabsContent value="narrative" className="space-y-3">
                <div className="bg-white p-4 rounded-lg border">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">Clinical Narrative</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(draftDocumentation.clinical_narrative)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <Textarea
                    value={draftDocumentation.clinical_narrative}
                    readOnly
                    rows={12}
                    className="text-sm"
                  />
                </div>
              </TabsContent>

              <TabsContent value="functional" className="space-y-3">
                {Object.entries(draftDocumentation.functional_status || {}).map(([key, value]) => (
                  <div key={key} className="bg-white p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-sm">
                        {key.replace(/_/g, ' ').toUpperCase()}
                      </h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(value)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-sm text-slate-700">{value}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="clinical" className="space-y-3">
                {Object.entries(draftDocumentation.clinical_status || {}).map(([key, value]) => (
                  <div key={key} className="bg-white p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold text-sm">
                        {key.replace(/_/g, ' ').toUpperCase()}
                      </h4>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyToClipboard(value)}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                    <p className="text-sm text-slate-700">{value}</p>
                  </div>
                ))}

                <div className="bg-white p-3 rounded-lg border">
                  <h4 className="font-semibold mb-2">Cognitive/Behavioral</h4>
                  {Object.entries(draftDocumentation.cognitive_behavioral || {}).map(([key, value]) => (
                    <div key={key} className="mb-3">
                      <p className="text-xs text-slate-500 font-medium">
                        {key.replace(/_/g, ' ').toUpperCase()}
                      </p>
                      <p className="text-sm text-slate-700">{value}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>

              <TabsContent value="justification" className="space-y-3">
                <div className="bg-green-50 p-4 rounded-lg border border-green-300">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-green-900">Homebound Justification</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(draftDocumentation.homebound_justification)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-green-900">{draftDocumentation.homebound_justification}</p>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg border border-blue-300">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold text-blue-900">Skilled Need Justification</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => copyToClipboard(draftDocumentation.skilled_need_justification)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-sm text-blue-900">{draftDocumentation.skilled_need_justification}</p>
                </div>

                <div className="bg-navy-50 p-4 rounded-lg border border-navy-300">
                  <h4 className="font-semibold text-navy-900 mb-3">Goals & Interventions</h4>
                  {draftDocumentation.goals_and_interventions?.map((goal, idx) => (
                    <div key={idx} className="bg-white p-3 rounded mb-2">
                      <Badge className="mb-2">Goal {idx + 1}</Badge>
                      <p className="text-sm font-medium text-navy-900 mb-1">{goal.goal}</p>
                      <p className="text-xs text-slate-600 mb-2">Problem: {goal.problem}</p>
                      <p className="text-xs text-slate-700 mb-1">
                        <strong>Interventions:</strong> {goal.interventions.join('; ')}
                      </p>
                      <p className="text-xs text-slate-500">Timeframe: {goal.timeframe}</p>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </CardContent>
    </Card>
  );
}