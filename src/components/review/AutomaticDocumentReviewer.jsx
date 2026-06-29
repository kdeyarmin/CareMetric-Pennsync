import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Award,
  BookOpen,
  FileCheck,
  TrendingUp,
  Eye,
  ThumbsUp
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from 'sonner';

export default function AutomaticDocumentReviewer({
  noteContent,
  visitType,
  diagnosis,
  patientData,
  vitalSigns,
  visitId,
  nurseEmail,
  autoReview = false,
  onReviewComplete,
  onApplySuggestion
}) {
  const ai = useAICall();
  const [reviewResults, setReviewResults] = useState(null);
  const queryClient = useQueryClient();

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const performReview = useCallback(async () => {
    if (!noteContent || noteContent.length < 50) {
      toast.error('Note is too short for comprehensive review');
      return;
    }

    try {
      // Get relevant Medicare rules
      const relevantRules = medicareRules.filter(rule => 
        rule.category === 'homebound_status' ||
        rule.category === 'skilled_need' ||
        rule.category === 'patient_response' ||
        rule.category === 'functional_status' ||
        rule.category === 'plan_of_care'
      );

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert Medicare home health compliance auditor and clinical documentation specialist for Pennsylvania home health agencies. Perform a comprehensive review of this clinical note.

CLINICAL NOTE TO REVIEW:
${noteContent}

VISIT CONTEXT:
- Visit Type: ${visitType || 'Unknown'}
- Primary Diagnosis: ${diagnosis || 'Not specified'}
- Patient Age: ${patientData?.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / 31557600000) : 'Unknown'}
- Vital Signs: ${vitalSigns ? JSON.stringify(vitalSigns) : 'Not documented'}

MEDICARE COMPLIANCE REQUIREMENTS (42 CFR 484):
${relevantRules.map(r => `- ${r.rule_name} (${r.cop_reference}): ${r.description}`).join('\n')}

PENNSYLVANIA HOME HEALTH REGULATIONS:
- Must document coordination with physician
- Infection control measures required
- Patient rights acknowledgment
- Emergency preparedness assessment

REVIEW CRITERIA:

1. COMPLETENESS ANALYSIS (0-100):
   - Are all required Medicare elements present?
   - Is homebound status clearly documented with specific limitations?
   - Is skilled nursing need explicitly stated?
   - Is patient response to interventions documented?
   - Are functional limitations described?
   - Is care plan referenced/updated?

2. ACCURACY ASSESSMENT:
   - Are vital signs within normal/expected ranges?
   - Do interventions match diagnosis?
   - Are medications reconciled?
   - Is clinical reasoning sound?
   - Are measurements specific (not vague)?

3. MEDICARE COMPLIANCE (42 CFR 484):
   - 484.55: Homebound status documentation
   - 484.60: Skilled nursing need justification
   - 484.80: Plan of care compliance
   - Identify specific CoP violations

4. PENNSYLVANIA STATE COMPLIANCE:
   - Physician coordination documented
   - Infection control noted
   - Patient education addressed

5. QUALITY INDICATORS:
   - Professional language and grammar
   - Specific vs vague terminology
   - Clinical depth and detail
   - Evidence-based practice references

6. DOCUMENTATION ISSUES:
   Identify specific problems:
   - Missing elements (with CoP reference)
   - Vague language needing specificity
   - Compliance gaps
   - Clinical reasoning gaps

7. EXEMPLARY ELEMENTS:
   - What is documented exceptionally well?
   - Could this be training material?
   - Specific phrases/sections to highlight

8. IMPROVEMENT SUGGESTIONS:
   - Specific, actionable recommendations
   - Compliant replacement text
   - Priority level for each

Return detailed JSON analysis.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number", description: "0-100 overall quality score" },
            completeness_score: { type: "number" },
            accuracy_score: { type: "number" },
            medicare_compliance_score: { type: "number" },
            pennsylvania_compliance_score: { type: "number" },
            quality_score: { type: "number" },
            is_exemplary: { type: "boolean", description: "Suitable for training?" },
            executive_summary: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            critical_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  cop_reference: { type: "string" },
                  impact: { type: "string" },
                  severity: { type: "string" }
                }
              }
            },
            missing_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  cop_requirement: { type: "string" },
                  why_required: { type: "string" }
                }
              }
            },
            vague_language: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  vague_text: { type: "string" },
                  specific_replacement: { type: "string" },
                  rationale: { type: "string" }
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
                  compliant_text: { type: "string" },
                  priority: { type: "string" }
                }
              }
            },
            exemplary_sections: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  section: { type: "string" },
                  excerpt: { type: "string" },
                  why_exemplary: { type: "string" }
                }
              }
            },
            training_value: { type: "string", description: "Why this could be training material" },
            recommended_training: { type: "array", items: { type: "string" } }
          }
        }
      });

      setReviewResults(result);

      // If note is exemplary, flag it for training
      if (result.is_exemplary && result.overall_score >= 90) {
        try {
          // Could create a training module or flag for review
          await base44.entities.TrainingRecommendation.create({
            nurse_email: nurseEmail || currentUser?.email,
            recommendation_type: 'documentation',
            recommendation_text: `Exemplary documentation identified for training: ${result.executive_summary}`,
            source: 'automatic_document_review',
            severity: 'low',
            addressed: false,
            visit_id: visitId,
            context_data: {
              element: 'exemplary_documentation',
              note_snippet: noteContent.substring(0, 200),
              overall_score: result.overall_score,
              training_value: result.training_value
            }
          });
        } catch (error) {
          console.error('Error flagging exemplary documentation:', error);
        }
      }

      // Track issues for training recommendations
      if (result.recommended_training?.length > 0) {
        for (const training of result.recommended_training) {
          try {
            await base44.entities.TrainingRecommendation.create({
              nurse_email: nurseEmail || currentUser?.email,
              recommendation_type: 'documentation',
              recommendation_text: training,
              source: 'automatic_document_review',
              severity: result.critical_issues?.length > 0 ? 'high' : 'medium',
              addressed: false,
              visit_id: visitId
            });
          } catch (error) {
            console.error('Error creating training recommendation:', error);
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ['trainingRecommendations'] });
      onReviewComplete?.(result);

    } catch (error) {
      console.error('Error reviewing document:', error);
      toast.error('Failed to review document. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [currentUser?.email, diagnosis, medicareRules, noteContent, nurseEmail, onReviewComplete, patientData?.date_of_birth, queryClient, visitId, visitType, vitalSigns]);

  useEffect(() => {
    if (autoReview && noteContent && noteContent.length > 100 && !reviewResults) {
      performReview();
    }
  }, [autoReview, noteContent, reviewResults, performReview]);

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 80) return 'text-blue-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBadge = (score) => {
    if (score >= 90) return 'bg-green-600';
    if (score >= 80) return 'bg-blue-600';
    if (score >= 70) return 'bg-yellow-600';
    return 'bg-red-600';
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-200">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-navy-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-slate-900 mb-2">AI Comprehensive Review in Progress</p>
          <p className="text-sm text-slate-600">
            Analyzing note against 42 CFR 484, Pennsylvania regulations, and quality standards...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!reviewResults && !autoReview) {
    return (
      <Card className="border-2 border-navy-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="w-5 h-5 text-navy-600" />
            Automatic Document Review
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            Comprehensive AI review of clinical documentation for Medicare compliance, accuracy, and quality.
          </p>
          <Button onClick={performReview} className="w-full bg-navy-600 hover:bg-navy-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Start Comprehensive Review
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!reviewResults) return null;

  return (
    <div className="space-y-4">
      {/* Exemplary Badge */}
      {reviewResults.is_exemplary && (
        <Alert className="border-2 border-green-500 bg-green-50">
          <Award className="w-5 h-5 text-green-600" />
          <AlertDescription>
            <p className="font-bold text-green-900 mb-1">🎉 Exemplary Documentation Identified!</p>
            <p className="text-sm text-green-800">
              This note demonstrates high-quality clinical documentation suitable for training purposes. 
              Score: {reviewResults.overall_score}/100
            </p>
          </AlertDescription>
        </Alert>
      )}

      {/* Overall Summary */}
      <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileCheck className="w-5 h-5 text-navy-600" />
              Comprehensive Review Results
            </span>
            <Badge className={getScoreBadge(reviewResults.overall_score)}>
              {reviewResults.overall_score}/100
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Executive Summary */}
          <div className="bg-white p-4 rounded-lg border">
            <h3 className="font-bold text-slate-900 mb-2">Executive Summary</h3>
            <p className="text-sm text-slate-700">{reviewResults.executive_summary}</p>
          </div>

          {/* Score Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Completeness', score: reviewResults.completeness_score },
              { label: 'Accuracy', score: reviewResults.accuracy_score },
              { label: 'Medicare', score: reviewResults.medicare_compliance_score },
              { label: 'PA State', score: reviewResults.pennsylvania_compliance_score },
              { label: 'Quality', score: reviewResults.quality_score }
            ].map((metric, idx) => (
              <div key={idx} className="bg-white p-3 rounded border text-center">
                <p className={`text-2xl font-bold ${getScoreColor(metric.score)}`}>
                  {metric.score}
                </p>
                <p className="text-xs text-slate-600">{metric.label}</p>
                <Progress value={metric.score} className="h-1 mt-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Accordion type="multiple" className="space-y-3">
        {/* Strengths */}
        {reviewResults.strengths?.length > 0 && (
          <AccordionItem value="strengths" className="border-2 border-green-200 rounded-lg bg-green-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <ThumbsUp className="w-4 h-4 text-green-600" />
                <span className="font-semibold">Strengths ({reviewResults.strengths.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4">
              <ul className="space-y-2">
                {reviewResults.strengths.map((strength, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                    <span className="text-green-900">{strength}</span>
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Critical Issues */}
        {reviewResults.critical_issues?.length > 0 && (
          <AccordionItem value="critical" className="border-2 border-red-300 rounded-lg bg-red-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <XCircle className="w-4 h-4 text-red-600" />
                <span className="font-semibold">Critical Issues ({reviewResults.critical_issues.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              {reviewResults.critical_issues.map((issue, idx) => (
                <div key={idx} className="bg-white p-3 rounded border-l-4 border-l-red-500">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-red-900">{issue.issue}</p>
                    <Badge className="bg-red-600">{issue.severity}</Badge>
                  </div>
                  <p className="text-xs text-slate-600 mb-1">
                    <strong>CoP:</strong> {issue.cop_reference}
                  </p>
                  <p className="text-sm text-red-800">{issue.impact}</p>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Missing Elements */}
        {reviewResults.missing_elements?.length > 0 && (
          <AccordionItem value="missing" className="border-2 border-orange-200 rounded-lg bg-orange-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <span className="font-semibold">Missing Elements ({reviewResults.missing_elements.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              {reviewResults.missing_elements.map((element, idx) => (
                <div key={idx} className="bg-white p-3 rounded border">
                  <p className="font-semibold text-orange-900 mb-1">{element.element}</p>
                  <p className="text-xs text-slate-600 mb-2">
                    <strong>Required by:</strong> {element.cop_requirement}
                  </p>
                  <p className="text-sm text-orange-800">{element.why_required}</p>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Vague Language */}
        {reviewResults.vague_language?.length > 0 && (
          <AccordionItem value="vague" className="border-2 border-yellow-200 rounded-lg bg-yellow-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Eye className="w-4 h-4 text-yellow-600" />
                <span className="font-semibold">Vague Language to Improve ({reviewResults.vague_language.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              {reviewResults.vague_language.map((item, idx) => (
                <div key={idx} className="bg-white p-3 rounded border">
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Vague:</p>
                    <p className="text-sm text-red-700 italic">"{item.vague_text}"</p>
                  </div>
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Better:</p>
                    <p className="text-sm text-green-700 font-medium">"{item.specific_replacement}"</p>
                  </div>
                  <p className="text-xs text-slate-600">{item.rationale}</p>
                  {onApplySuggestion && (
                    <Button
                      size="sm"
                      className="mt-2"
                      onClick={() => onApplySuggestion(item.specific_replacement)}
                    >
                      Apply Suggestion
                    </Button>
                  )}
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Improvement Suggestions */}
        {reviewResults.improvement_suggestions?.length > 0 && (
          <AccordionItem value="improvements" className="border-2 border-blue-200 rounded-lg bg-blue-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <span className="font-semibold">Improvement Suggestions ({reviewResults.improvement_suggestions.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              {reviewResults.improvement_suggestions.map((suggestion, idx) => (
                <div key={idx} className="bg-white p-3 rounded border">
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-semibold text-blue-900">{suggestion.category}</p>
                    <Badge className={
                      suggestion.priority === 'high' ? 'bg-red-600' :
                      suggestion.priority === 'medium' ? 'bg-yellow-600' : 'bg-blue-600'
                    }>
                      {suggestion.priority}
                    </Badge>
                  </div>
                  <p className="text-sm text-slate-700 mb-2">{suggestion.suggestion}</p>
                  {suggestion.compliant_text && (
                    <>
                      <p className="text-xs font-semibold text-slate-600 mb-1">Suggested Text:</p>
                      <p className="text-sm text-blue-800 bg-blue-50 p-2 rounded border border-blue-200">
                        {suggestion.compliant_text}
                      </p>
                      {onApplySuggestion && (
                        <Button
                          size="sm"
                          className="mt-2"
                          onClick={() => onApplySuggestion(suggestion.compliant_text)}
                        >
                          Apply Suggestion
                        </Button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Exemplary Sections */}
        {reviewResults.exemplary_sections?.length > 0 && (
          <AccordionItem value="exemplary" className="border-2 border-green-300 rounded-lg bg-green-50">
            <AccordionTrigger className="px-4 py-3">
              <div className="flex items-center gap-2">
                <Award className="w-4 h-4 text-green-600" />
                <span className="font-semibold">Exemplary Documentation ({reviewResults.exemplary_sections.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-4 space-y-3">
              {reviewResults.exemplary_sections.map((section, idx) => (
                <div key={idx} className="bg-white p-3 rounded border-l-4 border-l-green-500">
                  <p className="font-semibold text-green-900 mb-2">{section.section}</p>
                  <div className="bg-green-50 p-2 rounded border border-green-200 mb-2">
                    <p className="text-sm text-green-900 italic">"{section.excerpt}"</p>
                  </div>
                  <p className="text-xs text-slate-700">{section.why_exemplary}</p>
                </div>
              ))}
              {reviewResults.training_value && (
                <div className="bg-green-100 p-3 rounded border-2 border-green-400">
                  <div className="flex items-center gap-2 mb-2">
                    <BookOpen className="w-4 h-4 text-green-700" />
                    <p className="font-bold text-green-900">Training Value</p>
                  </div>
                  <p className="text-sm text-green-800">{reviewResults.training_value}</p>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setReviewResults(null);
          performReview();
        }}
        className="w-full"
      >
        Run Review Again
      </Button>
    </div>
  );
}