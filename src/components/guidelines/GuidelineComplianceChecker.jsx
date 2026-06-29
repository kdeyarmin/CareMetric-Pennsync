import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  BookOpen,
  ExternalLink,
  ChevronRight,
  AlertCircle,
  FileText,
  Plus
} from "lucide-react";
import { retrieveRelevantGuidelines } from "../smartNote/GuidelineContextRetriever";
import { toast } from "sonner";

export default function GuidelineComplianceChecker({
  noteContent,
  diagnosis,
  visitType,
  patientData,
  careType = "home_health",
  onIssueFound,
  onApplySuggestion
}) {
  const [complianceResults, setComplianceResults] = useState(null);
  const ai = useAICall();
  const [appliedGuidelines, setAppliedGuidelines] = useState([]);

  const checkCompliance = async () => {
    if (!noteContent || noteContent.length < 50) return;

    try {
      // Retrieve relevant guidelines
      const guidelines = await retrieveRelevantGuidelines({
        diagnosis,
        visitType,
        noteContent,
        maxGuidelines: 8
      });

      setAppliedGuidelines(guidelines);

      // Build comprehensive guideline requirements
      const guidelineRequirements = guidelines.map(g => ({
        title: g.title,
        citation: g.regulatory_citation,
        category: g.category,
        summary: g.summary,
        keywords: g.keywords,
        content_excerpt: g.content_markdown?.substring(0, 1000)
      }));

      const prompt = `You are a Medicare compliance auditor. Perform GRANULAR, SENTENCE-LEVEL cross-reference of this clinical note against specific Medicare guidelines.

CLINICAL NOTE TO AUDIT:
${noteContent}

PATIENT/VISIT CONTEXT:
- Care Type: ${careType}
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis}
- Patient Status: ${patientData?.status || 'active'}

APPLICABLE MEDICARE GUIDELINES (Retrieved from official CMS documentation):
${guidelineRequirements.map((g, idx) => `
Guideline ${idx + 1}: ${g.title}
Citation: ${g.citation || 'CMS Guidelines'}
Category: ${g.category}
Requirements Summary:
${g.summary}

Key Documentation Elements Required:
${g.keywords?.join(', ')}

Detailed Requirements:
${g.content_excerpt}
`).join('\n\n---\n\n')}

GRANULAR AUDIT REQUIREMENTS:
For EACH guideline above, you must:

1. **Extract Relevant Text**: Identify EXACT sentences or phrases from the note that attempt to address each guideline requirement

2. **Assess Degree of Compliance**: For EACH requirement, provide:
   - Compliance percentage (0-100%) for that specific requirement
   - Whether it's: fully_met, partially_met, minimally_addressed, or not_addressed
   - EXACT quotes from the note that relate to this requirement
   - What's missing or weak in those quotes

3. **Granular Gap Analysis**: For each requirement NOT fully met, specify:
   - Current text from note (exact quote)
   - Why current text is insufficient (be specific)
   - What additional language would make it compliant
   - Degree of risk (critical/high/medium/low)

4. **Sentence-Level Suggestions**: Provide specific text improvements that reference what's already written

Return JSON with GRANULAR compliance analysis:
{
  "overall_compliance_score": 0-100,
  "guidelines_reviewed": ${guidelines.length},
  "compliant_count": 0,
  "non_compliant_count": 0,
  "guideline_results": [
    {
      "guideline_title": "string",
      "guideline_citation": "string",
      "category": "string",
      "compliance_status": "compliant|partial|non_compliant",
      "compliance_percentage": 0-100,
      "requirement_analysis": [
        {
          "requirement_name": "Specific requirement from guideline",
          "compliance_degree": "fully_met|partially_met|minimally_addressed|not_addressed",
          "compliance_percentage": 0-100,
          "note_excerpts": ["Exact sentence from note", "Another relevant sentence"],
          "excerpt_assessment": "Analysis of why excerpts are sufficient or insufficient",
          "gap_description": "What's missing or weak",
          "improvement_needed": "Specific improvement to make it fully compliant",
          "suggested_enhanced_text": "Improved version of the excerpt or new text to add",
          "severity": "critical|high|medium|low"
        }
      ],
      "overall_strengths": ["Aspects of note that meet this guideline well"],
      "audit_risk": "Description of audit risk if gaps remain",
      "guideline_url": "string"
    }
  ],
  "overall_recommendations": [
    {
      "priority": "critical|high|medium|low",
      "recommendation": "string",
      "affected_guidelines": ["guideline titles"]
    }
  ],
  "strengths": ["Areas where documentation meets or exceeds guidelines"]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance_score: { type: "number" },
            guidelines_reviewed: { type: "number" },
            compliant_count: { type: "number" },
            non_compliant_count: { type: "number" },
            guideline_results: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  guideline_title: { type: "string" },
                  guideline_citation: { type: "string" },
                  category: { type: "string" },
                  compliance_status: { type: "string" },
                  compliance_percentage: { type: "number" },
                  requirement_analysis: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        requirement_name: { type: "string" },
                        compliance_degree: { type: "string" },
                        compliance_percentage: { type: "number" },
                        note_excerpts: { type: "array", items: { type: "string" } },
                        excerpt_assessment: { type: "string" },
                        gap_description: { type: "string" },
                        improvement_needed: { type: "string" },
                        suggested_enhanced_text: { type: "string" },
                        severity: { type: "string" }
                      }
                    }
                  },
                  overall_strengths: { type: "array", items: { type: "string" } },
                  audit_risk: { type: "string" },
                  guideline_url: { type: "string" }
                }
              }
            },
            overall_recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string" },
                  recommendation: { type: "string" },
                  affected_guidelines: { type: "array", items: { type: "string" } }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } }
          }
        }
      });

      setComplianceResults(result);

      // Callback with issues
      if (onIssueFound && result.guideline_results) {
        const allGaps = result.guideline_results
          .flatMap(gr => gr.requirement_analysis || [])
          .filter(req => req.severity === 'critical' || req.severity === 'high')
          .filter(req => req.compliance_degree !== 'fully_met');
        onIssueFound(allGaps);
      }

    } catch (error) {
      console.error('Error checking compliance:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const getStatusIcon = (status) => {
    if (status === 'compliant') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (status === 'partial') return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const getStatusColor = (status) => {
    if (status === 'compliant') return 'border-green-300 bg-green-50';
    if (status === 'partial') return 'border-yellow-300 bg-yellow-50';
    return 'border-red-300 bg-red-50';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800',
      high: 'bg-orange-100 text-orange-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-blue-100 text-blue-800'
    };
    return colors[severity] || colors.medium;
  };

  const getDegreeIcon = (degree) => {
    if (degree === 'fully_met') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (degree === 'partially_met') return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    if (degree === 'minimally_addressed') return <AlertCircle className="w-4 h-4 text-orange-600" />;
    return <XCircle className="w-4 h-4 text-red-600" />;
  };

  const getDegreeColor = (degree) => {
    if (degree === 'fully_met') return 'bg-green-50 border-green-300';
    if (degree === 'partially_met') return 'bg-yellow-50 border-yellow-300';
    if (degree === 'minimally_addressed') return 'bg-orange-50 border-orange-300';
    return 'bg-red-50 border-red-300';
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-b from-navy-50 to-white">
      <CardHeader className="py-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-navy-600" />
            Guideline-Based Compliance Check
          </CardTitle>
          <Button
            onClick={checkCompliance}
            disabled={ai.loading || !noteContent || noteContent.length < 50}
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Checking...</>
            ) : (
              <><Shield className="w-4 h-4 mr-2" /> Check Compliance</>
            )}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!complianceResults && !ai.loading && (
          <Alert className="bg-blue-50 border-blue-200">
            <BookOpen className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 text-sm">
              Click "Check Compliance" to cross-reference your note against {appliedGuidelines.length || 'relevant'} Medicare guidelines
            </AlertDescription>
          </Alert>
        )}

        {complianceResults && (
          <>
            {/* Overall Score */}
            <div className="p-4 bg-gradient-to-r from-navy-100 to-blue-100 rounded-lg border-2 border-navy-200">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm text-slate-700">Guideline Compliance Score</p>
                  <p className={`text-3xl font-bold ${
                    complianceResults.overall_compliance_score >= 90 ? 'text-green-600' :
                    complianceResults.overall_compliance_score >= 70 ? 'text-yellow-600' :
                    'text-red-600'
                  }`}>
                    {complianceResults.overall_compliance_score}%
                  </p>
                </div>
                <div className="text-right">
                  <Badge className="bg-green-600 mb-1">
                    {complianceResults.compliant_count} Compliant
                  </Badge>
                  <br />
                  <Badge className="bg-red-600">
                    {complianceResults.non_compliant_count} Gaps
                  </Badge>
                </div>
              </div>
              <Progress 
                value={complianceResults.overall_compliance_score} 
                className="h-2"
              />
              <p className="text-xs text-slate-600 mt-2">
                Reviewed against {complianceResults.guidelines_reviewed} Medicare guidelines
              </p>
            </div>

            {/* Guideline Results */}
            <ScrollArea className="h-96">
              <div className="space-y-3 pr-4">
                {complianceResults.guideline_results?.map((result, idx) => (
                  <Card key={idx} className={`border-2 ${getStatusColor(result.compliance_status)}`}>
                    <CardHeader className="py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            {getStatusIcon(result.compliance_status)}
                            <CardTitle className="text-sm">{result.guideline_title}</CardTitle>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="text-xs">
                              {result.guideline_citation}
                            </Badge>
                            <Badge className="text-xs">
                              {result.compliance_percentage}% compliant
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="py-2 space-y-3">
                      {/* Requirement-Level Analysis */}
                      {result.requirement_analysis?.length > 0 && (
                        <div className="space-y-2">
                          {result.requirement_analysis.map((req, reqIdx) => (
                            <div key={reqIdx} className={`p-3 rounded-lg border-2 ${getDegreeColor(req.compliance_degree)}`}>
                              {/* Requirement Header */}
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex items-center gap-2 flex-1">
                                  {getDegreeIcon(req.compliance_degree)}
                                  <div>
                                    <p className="text-sm font-semibold text-slate-900">{req.requirement_name}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge className={getSeverityColor(req.severity)}>
                                        {req.severity}
                                      </Badge>
                                      <Badge variant="outline" className="text-xs">
                                        {(req.compliance_degree || '').replace(/_/g, ' ')}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className={`text-lg font-bold ${
                                    req.compliance_percentage >= 90 ? 'text-green-600' :
                                    req.compliance_percentage >= 70 ? 'text-yellow-600' :
                                    req.compliance_percentage >= 40 ? 'text-orange-600' :
                                    'text-red-600'
                                  }`}>
                                    {req.compliance_percentage}%
                                  </div>
                                  <p className="text-xs text-slate-500">compliant</p>
                                </div>
                              </div>

                              {/* Note Excerpts - What's Currently Documented */}
                              {req.note_excerpts?.length > 0 && (
                                <div className="bg-white p-2 rounded border border-slate-300 mb-2">
                                  <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    Current Documentation:
                                  </p>
                                  <div className="space-y-1">
                                    {req.note_excerpts.map((excerpt, i) => (
                                      <p key={i} className="text-xs text-slate-800 italic pl-3 border-l-2 border-blue-300">
                                        "{excerpt}"
                                      </p>
                                    ))}
                                  </div>
                                  {req.excerpt_assessment && (
                                    <p className="text-xs text-slate-600 mt-2 bg-slate-50 p-2 rounded">
                                      💬 {req.excerpt_assessment}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Gap Description */}
                              {req.compliance_degree !== 'fully_met' && req.gap_description && (
                                <div className="bg-red-50 p-2 rounded border border-red-200 mb-2">
                                  <p className="text-xs font-semibold text-red-800 mb-1">⚠️ Gap Identified:</p>
                                  <p className="text-xs text-red-700">{req.gap_description}</p>
                                </div>
                              )}

                              {/* Improvement Needed */}
                              {req.improvement_needed && (
                                <div className="bg-blue-50 p-2 rounded border border-blue-200 mb-2">
                                  <p className="text-xs font-semibold text-blue-800 mb-1">🔧 To Improve:</p>
                                  <p className="text-xs text-blue-700">{req.improvement_needed}</p>
                                </div>
                              )}

                              {/* Suggested Enhanced Text */}
                              {req.suggested_enhanced_text && (
                                <div className="bg-green-50 p-2 rounded border border-green-300">
                                  <p className="text-xs font-semibold text-green-800 mb-1">✅ Suggested Enhancement:</p>
                                  <p className="text-xs text-green-900 font-medium">"{req.suggested_enhanced_text}"</p>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-2 w-full h-6 text-xs"
                                    onClick={() => {
                                      // Actually apply the suggested text. Prefer the
                                      // dedicated apply handler; fall back to copying
                                      // so the button is never a no-op.
                                      if (onApplySuggestion) {
                                        onApplySuggestion(req.suggested_enhanced_text, req);
                                        toast.success('Enhancement added to note');
                                      } else {
                                        navigator.clipboard?.writeText(req.suggested_enhanced_text);
                                        toast.success('Enhancement copied — paste it into your note');
                                      }
                                      // Still report the gap to any diagnostics consumer.
                                      onIssueFound?.([req]);
                                    }}
                                  >
                                    <Plus className="w-3 h-3 mr-1" />
                                    Apply Enhancement
                                  </Button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Overall Strengths for this Guideline */}
                      {result.overall_strengths?.length > 0 && (
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            Compliant Elements:
                          </p>
                          <ul className="space-y-1">
                            {result.overall_strengths.map((strength, i) => (
                              <li key={i} className="text-xs text-green-700 flex items-start gap-1">
                                <span className="text-green-600">✓</span>
                                {strength}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Audit Risk */}
                      {result.audit_risk && result.compliance_status !== 'compliant' && (
                        <Alert className="bg-orange-50 border-orange-200">
                          <AlertTriangle className="w-4 h-4 text-orange-600" />
                          <AlertDescription className="text-xs text-orange-900">
                            <strong>Audit Risk:</strong> {result.audit_risk}
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* View Guideline */}
                      {result.guideline_url && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => window.open(result.guideline_url, '_blank')}
                          className="text-xs w-full"
                        >
                          <BookOpen className="w-3 h-3 mr-1" />
                          View Full Guideline
                          <ExternalLink className="w-3 h-3 ml-auto" />
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            {/* Overall Recommendations */}
            {complianceResults.overall_recommendations?.length > 0 && (
              <div className="border-t pt-4 space-y-2">
                <p className="text-sm font-semibold text-slate-900 mb-2">Priority Recommendations:</p>
                {complianceResults.overall_recommendations
                  .filter(r => r.priority === 'critical' || r.priority === 'high')
                  .map((rec, idx) => (
                    <Alert key={idx} className="bg-red-50 border-red-200">
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                      <AlertDescription className="text-sm">
                        <div className="flex items-start gap-2">
                          <Badge className="bg-red-600 text-white text-xs">
                            {rec.priority}
                          </Badge>
                          <div className="flex-1">
                            <p className="text-red-900 font-medium">{rec.recommendation}</p>
                            <p className="text-xs text-red-700 mt-1">
                              Affects: {rec.affected_guidelines.join(', ')}
                            </p>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
              </div>
            )}

            {/* Strengths */}
            {complianceResults.strengths?.length > 0 && (
              <div className="bg-green-50 p-3 rounded border border-green-200">
                <p className="text-sm font-semibold text-green-900 mb-2 flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4" />
                  Documentation Strengths
                </p>
                <ul className="space-y-1">
                  {complianceResults.strengths.map((strength, idx) => (
                    <li key={idx} className="text-xs text-green-800 flex items-start gap-2">
                      <ChevronRight className="w-3 h-3 mt-0.5 flex-shrink-0" />
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}