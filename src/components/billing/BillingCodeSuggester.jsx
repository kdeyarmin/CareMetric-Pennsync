import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DollarSign, Copy, Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
import { toast } from "sonner";

export default function BillingCodeSuggester({ 
  noteContent, 
  diagnosis,
  visitType,
  vitalSigns,
  providerType,
  autoAnalyze = false
}) {
  const [suggestedCodes, setSuggestedCodes] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [copiedCode, setCopiedCode] = useState(null);

  // Only show for billing providers (not RN/LPN)
  const canBill = providerType && !['RN', 'LPN'].includes(providerType);

  useEffect(() => {
    if (autoAnalyze && noteContent && canBill && !suggestedCodes) {
      analyzeCodes();
    }
  }, [autoAnalyze, noteContent, canBill]);

  const analyzeCodes = async () => {
    if (!noteContent) {
      toast.error("No note content to analyze");
      return;
    }

    setIsAnalyzing(true);
    try {
      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this clinical note and suggest appropriate ICD-10 and CPT billing codes.

PROVIDER TYPE: ${providerType}
VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}

CLINICAL NOTE:
${noteContent}

VITAL SIGNS: ${vitalSigns ? Object.entries(vitalSigns).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ') : 'Not provided'}

Based on the documented visit, suggest:
1. Primary ICD-10 code(s) for diagnoses mentioned
2. Secondary ICD-10 codes if applicable
3. Appropriate CPT codes for services documented
4. Modifiers if needed

Consider:
- Provider type (${providerType}) and typical services they provide
- Visit complexity and time documented
- Procedures or assessments performed
- New vs established patient

Return accurate, specific codes with brief justifications.

Return JSON:
{
  "icd10_codes": [
    {"code": "I50.9", "description": "Heart failure, unspecified", "type": "primary", "confidence": "high"}
  ],
  "cpt_codes": [
    {"code": "99213", "description": "Office visit, est patient, low complexity", "rationale": "15-20 min visit, straightforward assessment"}
  ],
  "billing_notes": "Brief summary of coding rationale",
  "estimated_reimbursement": "Estimated range or N/A"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            icd10_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  type: { type: "string" },
                  confidence: { type: "string" }
                }
              }
            },
            cpt_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            billing_notes: { type: "string" },
            estimated_reimbursement: { type: "string" }
          }
        }
      });

      setSuggestedCodes(result);
      toast.success("Billing codes analyzed");
    } catch (error) {
      toast.error("Failed to analyze billing codes");
    }
    setIsAnalyzing(false);
  };

  const copyCode = (code, type) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast.success(`${type} code copied`);
  };

  const copyAllCodes = () => {
    const allCodes = [
      ...(suggestedCodes?.icd10_codes || []).map(c => `${c.code} - ${c.description}`),
      ...(suggestedCodes?.cpt_codes || []).map(c => `${c.code} - ${c.description}`)
    ].join('\n');
    navigator.clipboard.writeText(allCodes);
    toast.success("All codes copied");
  };

  if (!canBill) return null;

  return (
    <Card className="border-2 border-emerald-300 bg-gradient-to-br from-emerald-50 to-green-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-emerald-600" />
          Billing Code Suggestions
        </CardTitle>
        <p className="text-xs text-gray-600">AI-powered ICD-10 and CPT code analysis</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!suggestedCodes ? (
          <>
            <Alert className="bg-blue-50 border-blue-200">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-sm text-blue-900">
                AI will analyze your note and suggest appropriate billing codes based on documented services.
              </AlertDescription>
            </Alert>

            <Button
              onClick={analyzeCodes}
              disabled={isAnalyzing || !noteContent}
              className="w-full bg-emerald-600 hover:bg-emerald-700"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Codes...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Suggest Billing Codes
                </>
              )}
            </Button>
          </>
        ) : (
          <div className="space-y-4">
            {/* ICD-10 Codes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">ICD-10 Diagnosis Codes</h4>
                <Badge className="bg-blue-100 text-blue-800">
                  {suggestedCodes.icd10_codes?.length || 0} codes
                </Badge>
              </div>
              <div className="space-y-2">
                {suggestedCodes.icd10_codes?.map((code, idx) => (
                  <div
                    key={idx}
                    className="bg-white rounded-lg border border-blue-200 p-3 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-bold text-blue-700">{code.code}</code>
                          {code.type === 'primary' && (
                            <Badge className="bg-blue-600 text-white text-xs">Primary</Badge>
                          )}
                          {code.confidence === 'high' && (
                            <CheckCircle2 className="w-3 h-3 text-green-600" />
                          )}
                        </div>
                        <p className="text-xs text-gray-700">{code.description}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyCode(code.code, 'ICD-10')}
                        className="flex-shrink-0"
                      >
                        {copiedCode === code.code ? (
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* CPT Codes */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-900">CPT Procedure Codes</h4>
                <Badge className="bg-green-100 text-green-800">
                  {suggestedCodes.cpt_codes?.length || 0} codes
                </Badge>
              </div>
              <div className="space-y-2">
                {suggestedCodes.cpt_codes?.map((code, idx) => (
                  <div
                    key={idx}
                    className="bg-white rounded-lg border border-green-200 p-3 hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <code className="text-sm font-bold text-green-700 block mb-1">{code.code}</code>
                        <p className="text-xs text-gray-700 mb-1">{code.description}</p>
                        {code.rationale && (
                          <p className="text-xs text-gray-600 italic">→ {code.rationale}</p>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => copyCode(code.code, 'CPT')}
                        className="flex-shrink-0"
                      >
                        {copiedCode === code.code ? (
                          <CheckCircle2 className="w-3 h-3 text-green-600" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Billing Notes */}
            {suggestedCodes.billing_notes && (
              <Alert className="bg-amber-50 border-amber-200">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-xs text-amber-900">
                  <strong>Billing Notes:</strong> {suggestedCodes.billing_notes}
                </AlertDescription>
              </Alert>
            )}

            {/* Estimated Reimbursement */}
            {suggestedCodes.estimated_reimbursement && suggestedCodes.estimated_reimbursement !== "N/A" && (
              <div className="bg-green-100 border border-green-300 rounded-lg p-3">
                <p className="text-xs text-green-900">
                  <strong>Est. Reimbursement:</strong> {suggestedCodes.estimated_reimbursement}
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={copyAllCodes}
                variant="outline"
                size="sm"
                className="flex-1"
              >
                <Copy className="w-3 h-3 mr-1" />
                Copy All Codes
              </Button>
              <Button
                onClick={() => setSuggestedCodes(null)}
                variant="outline"
                size="sm"
              >
                Re-analyze
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}