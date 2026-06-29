import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Sparkles, Loader2, FileText, CheckCircle2, Copy } from "lucide-react";

export default function AIAssessmentDrafter({ visitNotes, patientData, onDraftComplete }) {
  const ai = useAICall();
  const [draftedAssessment, setDraftedAssessment] = useState(null);
  const [customNotes, setCustomNotes] = useState(visitNotes || "");

  const generateAssessment = async () => {
    
    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a comprehensive OASIS assessment draft based on the following patient visit notes and data:

VISIT NOTES:
${customNotes}

PATIENT DATA:
${patientData ? JSON.stringify(patientData, null, 2) : 'No additional patient data provided'}

Create a structured OASIS assessment including:

1. **HOMEBOUND STATUS (M1840)** - Clear documentation of why patient qualifies as homebound
2. **CLINICAL FINDINGS** - Key observations from visit notes
3. **FUNCTIONAL STATUS** - Assessment of ADLs, mobility, transfers based on notes
4. **COGNITIVE STATUS** - Mental status observations
5. **MEDICATION REVIEW** - Medication management assessment
6. **SAFETY ASSESSMENT** - Home safety concerns identified
7. **SKILLED NEED JUSTIFICATION** - Why skilled nursing is required
8. **RECOMMENDATIONS** - Care plan recommendations

Format the response professionally for OASIS documentation. Be specific and use clinical terminology. Ensure all statements support medical necessity and homebound status if applicable.`,
        response_json_schema: {
          type: "object",
          properties: {
            homebound_status: {
              type: "object",
              properties: {
                status: { type: "string" },
                justification: { type: "string" },
                supporting_details: { type: "array", items: { type: "string" } }
              }
            },
            clinical_findings: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  finding: { type: "string" }
                }
              }
            },
            functional_status: {
              type: "object",
              properties: {
                ambulation: { type: "string" },
                transfers: { type: "string" },
                adl_independence: { type: "string" },
                assistive_devices: { type: "string" }
              }
            },
            cognitive_status: { type: "string" },
            medication_assessment: { type: "string" },
            safety_concerns: { type: "array", items: { type: "string" } },
            skilled_need: {
              type: "object",
              properties: {
                primary_reasons: { type: "array", items: { type: "string" } },
                justification: { type: "string" }
              }
            },
            care_recommendations: { type: "array", items: { type: "string" } },
            suggested_m_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item: { type: "string" },
                  suggested_value: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            }
          }
        }
      });

      setDraftedAssessment(result);
      onDraftComplete?.(result);
    } catch (error) {
      console.error("Error generating assessment:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-navy-200">
        <CardHeader className="bg-gradient-to-r from-navy-50 to-indigo-50">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI OASIS Assessment Drafter
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          <div>
            <label htmlFor="visit-notes" className="text-sm font-medium text-slate-700 mb-2 block">
              Visit Notes / Clinical Information
            </label>
            <Textarea
              id="visit-notes"
              value={customNotes}
              onChange={(e) => setCustomNotes(e.target.value)}
              placeholder="Enter visit notes, observations, or patient information to generate OASIS assessment..."
              rows={6}
              className="text-sm"
            />
          </div>

          <Button
            onClick={generateAssessment}
            disabled={ai.loading || !customNotes.trim()}
            className="w-full bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating OASIS Assessment...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Generate OASIS Assessment Draft
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {draftedAssessment && (
        <Card className="border-2 border-green-200">
          <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-green-600" />
              Generated OASIS Assessment
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Homebound Status */}
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-blue-900">Homebound Status (M1840)</h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(draftedAssessment.homebound_status?.justification)}
                >
                  <Copy className="w-3 h-3" />
                </Button>
              </div>
              <Badge className="mb-2">{draftedAssessment.homebound_status?.status}</Badge>
              <p className="text-sm text-slate-700 mb-2">{draftedAssessment.homebound_status?.justification}</p>
              <ul className="text-sm text-slate-600 space-y-1">
                {draftedAssessment.homebound_status?.supporting_details?.map((detail, idx) => (
                  <li key={idx}>• {detail}</li>
                ))}
              </ul>
            </div>

            {/* Clinical Findings */}
            <div className="bg-slate-50 p-4 rounded-lg">
              <h3 className="font-semibold text-slate-900 mb-2">Clinical Findings</h3>
              <div className="space-y-2">
                {draftedAssessment.clinical_findings?.map((finding, idx) => (
                  <div key={idx} className="bg-white p-2 rounded border">
                    <Badge className="text-xs mb-1">{finding.category}</Badge>
                    <p className="text-sm text-slate-700">{finding.finding}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Functional Status */}
            <div className="bg-navy-50 p-4 rounded-lg border border-navy-200">
              <h3 className="font-semibold text-navy-900 mb-2">Functional Status</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="font-medium text-navy-800">Ambulation:</p>
                  <p className="text-slate-700">{draftedAssessment.functional_status?.ambulation}</p>
                </div>
                <div>
                  <p className="font-medium text-navy-800">Transfers:</p>
                  <p className="text-slate-700">{draftedAssessment.functional_status?.transfers}</p>
                </div>
                <div>
                  <p className="font-medium text-navy-800">ADL Independence:</p>
                  <p className="text-slate-700">{draftedAssessment.functional_status?.adl_independence}</p>
                </div>
                <div>
                  <p className="font-medium text-navy-800">Assistive Devices:</p>
                  <p className="text-slate-700">{draftedAssessment.functional_status?.assistive_devices}</p>
                </div>
              </div>
            </div>

            {/* Skilled Need */}
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <h3 className="font-semibold text-orange-900 mb-2">Skilled Need Justification</h3>
              <ul className="mb-2 space-y-1">
                {draftedAssessment.skilled_need?.primary_reasons?.map((reason, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-700">{draftedAssessment.skilled_need?.justification}</p>
            </div>

            {/* Suggested M-Items */}
            {draftedAssessment.suggested_m_items?.length > 0 && (
              <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
                <h3 className="font-semibold text-indigo-900 mb-2">Suggested OASIS M-Items</h3>
                <div className="space-y-2">
                  {draftedAssessment.suggested_m_items.map((item, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="text-xs">{item.m_item}</Badge>
                        <span className="text-sm font-medium">{item.suggested_value}</span>
                      </div>
                      <p className="text-xs text-slate-600">{item.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Safety Concerns */}
            {draftedAssessment.safety_concerns?.length > 0 && (
              <Alert>
                <AlertDescription>
                  <p className="font-semibold mb-1">Safety Concerns:</p>
                  <ul className="text-sm space-y-1">
                    {draftedAssessment.safety_concerns.map((concern, idx) => (
                      <li key={idx}>• {concern}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Care Recommendations */}
            <div className="bg-green-50 p-4 rounded-lg">
              <h3 className="font-semibold text-green-900 mb-2">Care Recommendations</h3>
              <ul className="text-sm text-slate-700 space-y-1">
                {draftedAssessment.care_recommendations?.map((rec, idx) => (
                  <li key={idx}>• {rec}</li>
                ))}
              </ul>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}