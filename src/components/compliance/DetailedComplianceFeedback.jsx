import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, XCircle, AlertTriangle, BookOpen, Lightbulb, FileText, Loader2, Copy } from "lucide-react";
import { toast } from "sonner";
import { getProviderCompliancePrompt, PROVIDER_COMPLIANCE_STANDARDS } from "../utils/providerSpecificConfig";

export default function DetailedComplianceFeedback({ note, providerType, visitType, onApplyFix }) {
  const [feedback, setFeedback] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const analyzeCompliance = async () => {
    if (!note?.trim()) {
      toast.error("No note to analyze");
      return;
    }

    setIsAnalyzing(true);
    try {
      const complianceContext = getProviderCompliancePrompt(providerType);
      const standards = PROVIDER_COMPLIANCE_STANDARDS[providerType];

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a compliance expert for ${providerType} clinical documentation.

${complianceContext}

CLINICAL NOTE TO REVIEW:
${note}

Visit Type: ${visitType}

Perform a comprehensive compliance analysis with:

1. COMPLIANCE SCORE (0-100): Overall compliance rating
2. REQUIRED ELEMENTS: Check each required element for ${providerType}
3. REGULATION CITATIONS: Cite specific regulations (42 CFR sections, Medicare manuals, etc.)
4. MISSING ELEMENTS: Identify what's missing with specific regulatory requirements
5. CLARITY ISSUES: Identify vague language, missing specifics, or ambiguous statements
6. IMPROVEMENT SUGGESTIONS: Specific, actionable recommendations with examples
7. STRENGTHS: What's documented well
8. RISK AREAS: Potential audit risks with regulation references

Be detailed and specific. Provide regulation section numbers and page references where applicable.`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_score: { type: "number" },
            overall_assessment: { type: "string" },
            required_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  status: { type: "string", enum: ["present", "partial", "missing"] },
                  details: { type: "string" },
                  regulation: { type: "string" }
                }
              }
            },
            missing_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  regulation: { type: "string" },
                  why_required: { type: "string" },
                  example: { type: "string" }
                }
              }
            },
            clarity_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  location: { type: "string" },
                  problem: { type: "string" },
                  suggestion: { type: "string" }
                }
              }
            },
            improvement_suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  suggestion: { type: "string" },
                  example: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } },
            audit_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  regulation: { type: "string" },
                  mitigation: { type: "string" }
                }
              }
            }
          }
        }
      });

      setFeedback(result);
      toast.success("Compliance analysis complete");
    } catch (error) {
      console.error(error);
      toast.error("Failed to analyze compliance");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return "text-green-600 bg-green-50";
    if (score >= 80) return "text-yellow-600 bg-yellow-50";
    if (score >= 70) return "text-orange-600 bg-orange-50";
    return "text-red-600 bg-red-50";
  };

  const getPriorityColor = (priority) => {
    if (priority === "high") return "bg-red-100 text-red-800";
    if (priority === "medium") return "bg-yellow-100 text-yellow-800";
    return "bg-blue-100 text-blue-800";
  };

  const getStatusIcon = (status) => {
    if (status === "present") return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (status === "partial") return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  if (!feedback) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Detailed Compliance Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={analyzeCompliance} disabled={isAnalyzing || !note} className="w-full">
            {isAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Compliance...
              </>
            ) : (
              <>
                <BookOpen className="w-4 h-4 mr-2" />
                Run Detailed Analysis
              </>
            )}
          </Button>
          <p className="text-sm text-gray-500 mt-3 text-center">
            Get comprehensive compliance feedback with regulation citations and specific improvement suggestions
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Detailed Compliance Analysis
          </CardTitle>
          <div className={`px-4 py-2 rounded-lg font-bold text-2xl ${getScoreColor(feedback.compliance_score)}`}>
            {feedback.compliance_score}/100
          </div>
        </div>
        <p className="text-sm text-gray-600 mt-2">{feedback.overall_assessment}</p>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="required" className="space-y-4">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="required">Required</TabsTrigger>
            <TabsTrigger value="missing">Missing</TabsTrigger>
            <TabsTrigger value="clarity">Clarity</TabsTrigger>
            <TabsTrigger value="suggestions">Improve</TabsTrigger>
            <TabsTrigger value="risks">Risks</TabsTrigger>
          </TabsList>

          <TabsContent value="required" className="space-y-3">
            <h3 className="font-semibold text-sm">Required Elements for {providerType}</h3>
            {feedback.required_elements?.map((element, idx) => (
              <div key={idx} className="p-3 bg-gray-50 rounded-lg border">
                <div className="flex items-start gap-2 mb-2">
                  {getStatusIcon(element.status)}
                  <div className="flex-1">
                    <p className="font-medium text-sm">{element.element}</p>
                    <p className="text-xs text-gray-600 mt-1">{element.details}</p>
                    {element.regulation && (
                      <Badge className="mt-2 text-xs bg-blue-100 text-blue-800">
                        <BookOpen className="w-3 h-3 mr-1" />
                        {element.regulation}
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="missing" className="space-y-3">
            <h3 className="font-semibold text-sm">Missing Documentation Elements</h3>
            {feedback.missing_elements?.length === 0 ? (
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>All required elements are present!</AlertDescription>
              </Alert>
            ) : (
              feedback.missing_elements?.map((missing, idx) => (
                <div key={idx} className="p-4 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-start gap-2 mb-2">
                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-red-900">{missing.element}</p>
                      <Badge className="mt-2 bg-red-100 text-red-800 text-xs">
                        <BookOpen className="w-3 h-3 mr-1" />
                        {missing.regulation}
                      </Badge>
                      <p className="text-sm text-gray-700 mt-2">
                        <span className="font-medium">Why required:</span> {missing.why_required}
                      </p>
                      {missing.example && (
                        <div className="mt-3 p-2 bg-white rounded border border-gray-200">
                          <p className="text-xs font-medium text-gray-500 mb-1">Example:</p>
                          <p className="text-sm text-gray-700 italic">{missing.example}</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="mt-2 text-xs"
                            onClick={() => copyToClipboard(missing.example)}
                          >
                            <Copy className="w-3 h-3 mr-1" />
                            Copy Example
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="clarity" className="space-y-3">
            <h3 className="font-semibold text-sm">Clarity & Specificity Issues</h3>
            {feedback.clarity_issues?.length === 0 ? (
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>Documentation is clear and specific!</AlertDescription>
              </Alert>
            ) : (
              feedback.clarity_issues?.map((issue, idx) => (
                <div key={idx} className="p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-sm text-yellow-900">{issue.issue}</p>
                      {issue.location && (
                        <p className="text-xs text-gray-600 mt-1">Location: {issue.location}</p>
                      )}
                      <p className="text-sm text-gray-700 mt-2">
                        <span className="font-medium">Problem:</span> {issue.problem}
                      </p>
                      <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                        <p className="text-xs font-medium text-green-700 mb-1">Suggestion:</p>
                        <p className="text-sm text-gray-700">{issue.suggestion}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="suggestions" className="space-y-3">
            <h3 className="font-semibold text-sm">Improvement Suggestions</h3>
            {feedback.improvement_suggestions?.map((suggestion, idx) => (
              <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-start gap-2">
                  <Lightbulb className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <p className="font-medium text-sm text-blue-900">{suggestion.category}</p>
                      <Badge className={getPriorityColor(suggestion.priority)}>
                        {suggestion.priority} priority
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700">{suggestion.suggestion}</p>
                    {suggestion.example && (
                      <div className="mt-2 p-2 bg-white rounded border border-gray-200">
                        <p className="text-xs font-medium text-gray-500 mb-1">Example:</p>
                        <p className="text-sm text-gray-700 italic">{suggestion.example}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 text-xs"
                          onClick={() => copyToClipboard(suggestion.example)}
                        >
                          <Copy className="w-3 h-3 mr-1" />
                          Copy Example
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {feedback.strengths?.length > 0 && (
              <div className="mt-4">
                <h4 className="font-semibold text-sm text-green-900 mb-2">Strengths:</h4>
                <ul className="space-y-1">
                  {feedback.strengths.map((strength, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </TabsContent>

          <TabsContent value="risks" className="space-y-3">
            <h3 className="font-semibold text-sm">Audit Risk Areas</h3>
            {feedback.audit_risks?.length === 0 ? (
              <Alert>
                <CheckCircle2 className="w-4 h-4" />
                <AlertDescription>No significant audit risks identified!</AlertDescription>
              </Alert>
            ) : (
              feedback.audit_risks?.map((risk, idx) => (
                <div key={idx} className="p-4 bg-orange-50 rounded-lg border border-orange-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-orange-900">{risk.risk}</p>
                      <Badge className="mt-2 bg-orange-100 text-orange-800 text-xs">
                        <BookOpen className="w-3 h-3 mr-1" />
                        {risk.regulation}
                      </Badge>
                      <div className="mt-3 p-2 bg-white rounded border border-gray-200">
                        <p className="text-xs font-medium text-gray-500 mb-1">How to mitigate:</p>
                        <p className="text-sm text-gray-700">{risk.mitigation}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>

        <div className="mt-4 flex gap-2">
          <Button onClick={analyzeCompliance} variant="outline" className="flex-1">
            <Loader2 className="w-4 h-4 mr-2" />
            Re-analyze
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}