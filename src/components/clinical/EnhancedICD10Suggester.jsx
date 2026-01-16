import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Code2, Copy, DollarSign, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function EnhancedICD10Suggester({ clinicalNote, diagnosis, customRules = [] }) {
  const [suggestions, setSuggestions] = useState(null);
  const [loading, setLoading] = useState(false);

  const analyzeCodes = async () => {
    setLoading(true);
    try {
      const customRulesContext = customRules
        .filter(rule => rule.category === 'billing' || rule.category === 'clinical')
        .map(rule => `- ${rule.rule_name}: ${rule.validation_criteria}`)
        .join('\n');

      const prompt = `You are an expert medical coding specialist with deep knowledge of ICD-10-CM coding guidelines.

Analyze the following clinical note and suggest appropriate ICD-10 codes:

CLINICAL NOTE:
${clinicalNote}

PRIMARY DIAGNOSIS: ${diagnosis}

${customRulesContext ? `ORGANIZATIONAL CODING RULES:\n${customRulesContext}\n` : ''}

Provide ICD-10 code suggestions following these guidelines:
1. Suggest codes from most specific to least specific
2. Include primary diagnosis and all relevant secondary diagnoses
3. Consider comorbidities, complications, and related conditions
4. Provide confidence level (0-100) for each suggestion
5. Explain clinical rationale for each code
6. Indicate billing impact (affects reimbursement level or not)
7. Note code specificity level (3-digit, 4-digit, 5-digit, 6-digit, 7-digit)
8. Flag any codes requiring additional documentation

Return JSON:
{
  "suggested_codes": [
    {
      "code": "I50.23",
      "description": "Acute on chronic systolic heart failure",
      "confidence": 95,
      "rationale": "Clinical explanation",
      "billing_impact": "high|medium|low",
      "specificity_level": "5-digit",
      "requires_documentation": ["specific items needed"],
      "code_category": "primary|secondary|comorbidity",
      "reimbursement_weight": "Increases case mix weight significantly"
    }
  ],
  "coding_notes": "Overall guidance",
  "documentation_gaps": ["Missing elements that would support higher specificity codes"]
}`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            suggested_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  confidence: { type: "number" },
                  rationale: { type: "string" },
                  billing_impact: { type: "string" },
                  specificity_level: { type: "string" },
                  requires_documentation: { type: "array", items: { type: "string" } },
                  code_category: { type: "string" },
                  reimbursement_weight: { type: "string" }
                }
              }
            },
            coding_notes: { type: "string" },
            documentation_gaps: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSuggestions(result);
      toast.success("ICD-10 codes analyzed");
    } catch (error) {
      toast.error("Failed to analyze codes");
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied");
  };

  const copyAllCodes = () => {
    const codes = suggestions.suggested_codes.map(s => `${s.code} - ${s.description}`).join('\n');
    navigator.clipboard.writeText(codes);
    toast.success("All codes copied");
  };

  return (
    <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-purple-600" />
            ICD-10 Code Suggestions
          </span>
          {!suggestions && (
            <Button onClick={analyzeCodes} disabled={loading} size="sm" className="bg-purple-600 hover:bg-purple-700">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Code2 className="w-4 h-4 mr-2" />
                  Suggest ICD-10 Codes
                </>
              )}
            </Button>
          )}
          {suggestions && (
            <Button onClick={copyAllCodes} variant="outline" size="sm">
              <Copy className="w-4 h-4 mr-2" />
              Copy All
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!suggestions ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 text-center py-4">
            Click "Suggest ICD-10 Codes" to analyze this note and receive coding recommendations
          </p>
        ) : (
          <div className="space-y-4">
            {/* Coding Notes */}
            {suggestions.coding_notes && (
              <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg border border-blue-200">
                <p className="text-sm text-blue-800 dark:text-blue-300">
                  <strong>Coding Guidance:</strong> {suggestions.coding_notes}
                </p>
              </div>
            )}

            {/* Suggested Codes */}
            <div className="space-y-3">
              {suggestions.suggested_codes.map((code, idx) => (
                <div key={idx} className="bg-white dark:bg-slate-900 p-4 rounded-lg border border-purple-200 dark:border-purple-800">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <code className="text-lg font-mono font-bold text-purple-700 dark:text-purple-300">
                          {code.code}
                        </code>
                        <Badge className={
                          code.confidence >= 90 ? 'bg-green-600' :
                          code.confidence >= 75 ? 'bg-yellow-600' :
                          'bg-orange-600'
                        }>
                          {code.confidence}% confidence
                        </Badge>
                        <Badge variant="outline">{code.code_category}</Badge>
                        <Badge className={
                          code.billing_impact === 'high' ? 'bg-red-600' :
                          code.billing_impact === 'medium' ? 'bg-yellow-600' :
                          'bg-blue-500'
                        }>
                          <DollarSign className="w-3 h-3 mr-1" />
                          {code.billing_impact} impact
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100 mb-2">
                        {code.description}
                      </p>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        <strong>Clinical Rationale:</strong> {code.rationale}
                      </p>
                      {code.reimbursement_weight && (
                        <div className="bg-green-50 dark:bg-green-950 p-2 rounded mb-2">
                          <p className="text-xs text-green-800 dark:text-green-300">
                            <strong>💰 Reimbursement:</strong> {code.reimbursement_weight}
                          </p>
                        </div>
                      )}
                      {code.requires_documentation?.length > 0 && (
                        <div className="bg-amber-50 dark:bg-amber-950 p-2 rounded">
                          <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
                            <AlertCircle className="w-3 h-3 inline mr-1" />
                            Required Documentation:
                          </p>
                          <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-0.5 ml-4">
                            {code.requires_documentation.map((req, i) => (
                              <li key={i}>• {req}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <p className="text-xs text-slate-500 mt-2">
                        Specificity: {code.specificity_level}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => copyCode(code.code)}>
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Documentation Gaps */}
            {suggestions.documentation_gaps?.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-950 p-4 rounded-lg border border-orange-200">
                <p className="font-medium text-orange-800 dark:text-orange-300 mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Documentation Improvements for Higher Specificity
                </p>
                <ul className="space-y-1 text-sm text-orange-700 dark:text-orange-400">
                  {suggestions.documentation_gaps.map((gap, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="text-orange-500 mt-0.5">•</span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}