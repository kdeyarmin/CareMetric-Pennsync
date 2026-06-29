import React, { useState, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Lightbulb,
  DollarSign,
  Shield,
  TrendingUp,
  Eye
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from 'sonner';

export default function ClinicalNoteReviewer({ 
  noteContent,
  visitType,
  diagnosis,
  patientData,
  autoReview = false,
  onApplySuggestion,
  prominent = false
}) {
  const ai = useAICall();
  const [reviewResults, setReviewResults] = useState(null);

  const reviewNote = useCallback(async () => {
    if (!noteContent || noteContent.length < 50) return;

    try {
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical documentation auditor specializing in home health Medicare compliance and billing optimization.

REVIEW THIS CLINICAL NOTE:

${noteContent}

CONTEXT:
- Visit Type: ${visitType || 'Not specified'}
- Primary Diagnosis: ${diagnosis || 'Not specified'}
- Patient: ${patientData ? `${patientData.first_name} ${patientData.last_name}, DOB: ${patientData.date_of_birth || 'Unknown'}` : 'Not specified'}
- Care Type: ${patientData?.care_type || 'home_health'}
${patientData?.current_medications?.length > 0 ? `- Current Medications: ${patientData.current_medications.map(m => m.name).slice(0, 5).join(', ')}` : ''}
${patientData?.allergies ? `- Allergies: ${patientData.allergies}` : ''}

PERFORM COMPREHENSIVE REVIEW FOR:

1. COMPLETENESS - Missing Required Elements:
   ✓ Homebound status clearly documented
   ✓ Skilled need justified
   ✓ Patient response to care
   ✓ Safety assessment
   ✓ Functional status
   ✓ Coordination of care
   ✓ Visit-specific requirements (admission, recert, discharge, etc.)

2. ACCURACY - Clinical Quality:
   ✓ Specific, measurable observations (not vague terms)
   ✓ Objective data included (vitals, measurements)
   ✓ Clinical language appropriate
   ✓ Contradictions or inconsistencies
   ✓ Terminology correctness

3. COMPLIANCE - Medicare Requirements (42 CFR 484):
   ✓ Meets CoP 484.55 (Comprehensive Assessment)
   ✓ Meets CoP 484.60 (Care Planning)
   ✓ Supports medical necessity per Medicare guidelines
   ✓ Demonstrates skilled need (cannot be performed by non-skilled personnel)
   ✓ Homebound status criteria met (leaving home is taxing effort)
   ✓ Safety measures documented
   ✓ Patient/caregiver instruction documented
   ✓ Physician coordination documented
   ✓ No compliance red flags or audit risks

4. BILLING OPTIMIZATION - Revenue Impact:
   ✓ Documentation supports appropriate PDGM clinical grouping
   ✓ All relevant comorbidities documented (for case-mix weight)
   ✓ Functional impairment level captured (ADL/IADL limitations)
   ✓ Clinical complexity reflected (medications, wound care, therapies)
   ✓ Timing factors documented (admission source, prior hospitalization)
   ✓ Secondary diagnoses that increase reimbursement identified
   ✓ Opportunities for higher case-mix category
   ✓ ICD-10 specificity sufficient

5. CLARITY & SPECIFICITY:
   ✓ Clear chronological flow
   ✓ Specific rather than generic statements
   ✓ Quantifiable when possible
   ✓ Professional language
   ✓ Free of documentation clichés

Return detailed analysis with:
- Overall scores for each category (0-100)
- Specific missing elements with severity
- Improvement suggestions with examples
- Compliance risks flagged
- Billing optimization opportunities`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_score: { type: "number" },
            completeness_score: { type: "number" },
            accuracy_score: { type: "number" },
            compliance_score: { type: "number" },
            billing_optimization_score: { type: "number" },
            clarity_score: { type: "number" },
            summary: { type: "string" },
            missing_elements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  severity: { type: "string" },
                  explanation: { type: "string" },
                  example: { type: "string" },
                  cop_reference: { type: "string" },
                  regulation: { type: "string" }
                }
              }
            },
            accuracy_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  location: { type: "string" },
                  suggestion: { type: "string" }
                }
              }
            },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" },
                  explanation: { type: "string" },
                  remediation: { type: "string" }
                }
              }
            },
            billing_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  opportunity: { type: "string" },
                  potential_impact: { type: "string" },
                  documentation_needed: { type: "string" },
                  revenue_estimate: { type: "string" },
                  icd10_suggestion: { type: "string" }
                }
              }
            },
            clarity_improvements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  current_phrase: { type: "string" },
                  suggested_phrase: { type: "string" },
                  reason: { type: "string" }
                }
              }
            },
            strengths: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setReviewResults(result);
    } catch (error) {
      console.error('Error reviewing note:', error);
      toast.error('Failed to review note. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [noteContent, visitType, diagnosis, patientData]);

  React.useEffect(() => {
    if (autoReview && noteContent && noteContent.length > 100 && !reviewResults) {
      reviewNote();
    }
  }, [autoReview, noteContent, reviewResults, reviewNote]);

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 80) return 'text-blue-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-slate-100 text-slate-800';
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-navy-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-slate-900 mb-2">Reviewing Clinical Note...</p>
          <p className="text-sm text-slate-600">Analyzing completeness, accuracy, compliance & billing optimization</p>
        </CardContent>
      </Card>
    );
  }

  if (!reviewResults) {
    return (
      <Card className={`${prominent ? 'border-4 border-navy-400 shadow-2xl bg-gradient-to-r from-navy-50 to-gold-50' : 'border-2 border-blue-300'}`}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-600" />
            AI Document Reviewer
            {prominent && <Badge className="bg-navy-600 text-white ml-2">Automatic Quality Check</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-slate-600">
            Comprehensive analysis for completeness, accuracy, Medicare compliance (42 CFR 484), and billing optimization.
          </p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 bg-white p-3 rounded border">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
              <span>Completeness</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield className="w-3 h-3 text-orange-600" />
              <span>Compliance</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-green-600" />
              <span>Billing</span>
            </div>
            <div className="flex items-center gap-1">
              <Lightbulb className="w-3 h-3 text-blue-600" />
              <span>Quality</span>
            </div>
          </div>
          <Button onClick={reviewNote} className={`w-full ${prominent ? 'bg-gradient-to-r from-navy-600 to-gold-600 hover:from-navy-700 hover:to-gold-700 text-lg py-6' : 'bg-blue-600 hover:bg-blue-700'}`}>
            <FileText className="w-4 h-4 mr-2" />
            {prominent ? 'Run Quality & Compliance Review' : 'Review Note'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall Scores */}
      <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-navy-600" />
              Clinical Note Review Results
            </span>
            <Badge className={`${getScoreColor(reviewResults.overall_score)} bg-white text-2xl px-4 py-2`}>
              {reviewResults.overall_score}%
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-700">{reviewResults.summary}</p>

          {/* Score Breakdown */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: 'Completeness', score: reviewResults.completeness_score, icon: CheckCircle2 },
              { label: 'Accuracy', score: reviewResults.accuracy_score, icon: TrendingUp },
              { label: 'Compliance', score: reviewResults.compliance_score, icon: Shield },
              { label: 'Billing', score: reviewResults.billing_optimization_score, icon: DollarSign },
              { label: 'Clarity', score: reviewResults.clarity_score, icon: Lightbulb }
            ].map((item, idx) => (
              <div key={idx} className="bg-white p-3 rounded border text-center">
                <item.icon className={`w-5 h-5 mx-auto mb-1 ${getScoreColor(item.score)}`} />
                <p className="text-xs text-slate-600 mb-1">{item.label}</p>
                <p className={`text-xl font-bold ${getScoreColor(item.score)}`}>{item.score}%</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Strengths */}
      {reviewResults.strengths?.length > 0 && (
        <Card className="border-2 border-green-300 bg-green-50">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Documentation Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {reviewResults.strengths.map((strength, i) => (
                <li key={i} className="text-sm text-green-800 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  {strength}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Accordion type="multiple" defaultValue={["missing", "compliance"]}>
        {/* Missing Elements */}
        {reviewResults.missing_elements?.length > 0 && (
          <AccordionItem value="missing">
            <AccordionTrigger className="bg-red-50 px-4 py-3 rounded-t-lg">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <span className="font-semibold">Missing Required Elements ({reviewResults.missing_elements.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg space-y-3">
              {reviewResults.missing_elements.map((missing, idx) => (
                <Card key={idx} className={`border-l-4 ${
                  missing.severity === 'critical' ? 'border-l-red-500 bg-red-50' :
                  missing.severity === 'high' ? 'border-l-orange-500 bg-orange-50' :
                  'border-l-yellow-500 bg-yellow-50'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-900">{missing.element}</p>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {missing.cop_reference && (
                            <Badge variant="outline" className="text-xs">{missing.cop_reference}</Badge>
                          )}
                          {missing.regulation && (
                            <Badge className="bg-blue-100 text-blue-800 text-xs">{missing.regulation}</Badge>
                          )}
                        </div>
                      </div>
                      <Badge className={getSeverityColor(missing.severity)}>
                        {missing.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">{missing.explanation}</p>
                    {missing.example && (
                      <div className="bg-white p-3 rounded border">
                        <p className="text-xs font-semibold text-slate-900 mb-1">Example Documentation:</p>
                        <p className="text-sm text-slate-700 italic">"{missing.example}"</p>
                        {onApplySuggestion && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="mt-2"
                            onClick={() => onApplySuggestion(missing.example)}
                          >
                            Add to Note
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Compliance Risks */}
        {reviewResults.compliance_risks?.length > 0 && (
          <AccordionItem value="compliance">
            <AccordionTrigger className="bg-orange-50 px-4 py-3 rounded-t-lg">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-orange-600" />
                <span className="font-semibold">Compliance Risks ({reviewResults.compliance_risks.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg space-y-3">
              {reviewResults.compliance_risks.map((risk, idx) => (
                <Card key={idx} className={`border-l-4 ${
                  risk.severity === 'critical' ? 'border-l-red-500' : 'border-l-orange-500'
                }`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <p className="font-semibold text-slate-900 flex-1">{risk.risk}</p>
                      <Badge className={getSeverityColor(risk.severity)}>{risk.severity}</Badge>
                    </div>
                    <div className="bg-orange-50 p-3 rounded border border-orange-200 mb-2">
                      <p className="text-xs font-semibold text-orange-900 mb-1">Why This Matters:</p>
                      <p className="text-sm text-slate-700">{risk.explanation}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded border border-green-200">
                      <p className="text-xs font-semibold text-green-900 mb-1">How to Fix:</p>
                      <p className="text-sm text-slate-700">{risk.remediation}</p>
                      {onApplySuggestion && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => onApplySuggestion(risk.remediation)}
                        >
                          Apply Fix
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Accuracy Issues */}
        {reviewResults.accuracy_issues?.length > 0 && (
          <AccordionItem value="accuracy">
            <AccordionTrigger className="bg-yellow-50 px-4 py-3 rounded-t-lg">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
                <span className="font-semibold">Accuracy & Quality Issues ({reviewResults.accuracy_issues.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg space-y-2">
              {reviewResults.accuracy_issues.map((issue, idx) => (
                <div key={idx} className="bg-yellow-50 p-3 rounded border border-yellow-200">
                  <p className="text-sm font-semibold text-slate-900">{issue.issue}</p>
                  {issue.location && (
                    <p className="text-xs text-slate-600 mt-1">Location: {issue.location}</p>
                  )}
                  <div className="bg-white p-2 rounded border mt-2">
                    <p className="text-xs font-semibold text-slate-900 mb-1">Suggested Improvement:</p>
                    <p className="text-sm text-slate-700">{issue.suggestion}</p>
                  </div>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Billing Optimization */}
        {reviewResults.billing_opportunities?.length > 0 && (
          <AccordionItem value="billing">
            <AccordionTrigger className="bg-green-50 px-4 py-3 rounded-t-lg">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-green-600" />
                <span className="font-semibold">Billing Optimization Opportunities ({reviewResults.billing_opportunities.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg space-y-3">
              {reviewResults.billing_opportunities.map((opp, idx) => (
                <Card key={idx} className="border-l-4 border-l-green-500">
                  <CardContent className="p-4">
                    <p className="font-semibold text-slate-900 mb-2">{opp.opportunity}</p>
                    <div className="grid md:grid-cols-2 gap-3">
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <p className="text-xs font-semibold text-green-900 mb-1">Potential Impact:</p>
                        <p className="text-sm text-green-800">{opp.potential_impact}</p>
                        {opp.revenue_estimate && (
                          <p className="text-xs text-green-700 font-bold mt-1">💰 {opp.revenue_estimate}</p>
                        )}
                      </div>
                      {opp.icd10_suggestion && (
                        <div className="bg-navy-50 p-3 rounded border border-navy-200">
                          <p className="text-xs font-semibold text-navy-900 mb-1">ICD-10 Suggestion:</p>
                          <p className="text-sm text-navy-800 font-mono">{opp.icd10_suggestion}</p>
                        </div>
                      )}
                    </div>
                    <div className="bg-blue-50 p-3 rounded border border-blue-200 mt-2">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Documentation Needed:</p>
                      <p className="text-sm text-slate-700">{opp.documentation_needed}</p>
                      {onApplySuggestion && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => onApplySuggestion(opp.documentation_needed)}
                        >
                          Add to Note
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}

        {/* Clarity Improvements */}
        {reviewResults.clarity_improvements?.length > 0 && (
          <AccordionItem value="clarity">
            <AccordionTrigger className="bg-blue-50 px-4 py-3 rounded-t-lg">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-blue-600" />
                <span className="font-semibold">Clarity & Specificity Improvements ({reviewResults.clarity_improvements.length})</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg space-y-2">
              {reviewResults.clarity_improvements.map((improvement, idx) => (
                <div key={idx} className="bg-blue-50 p-3 rounded border border-blue-200">
                  <div className="grid md:grid-cols-2 gap-3 mb-2">
                    <div className="bg-red-50 p-2 rounded border border-red-200">
                      <p className="text-xs font-semibold text-red-900 mb-1">Current (Vague):</p>
                      <p className="text-sm text-slate-900 italic">"{improvement.current_phrase}"</p>
                    </div>
                    <div className="bg-green-50 p-2 rounded border border-green-200">
                      <p className="text-xs font-semibold text-green-900 mb-1">Suggested (Specific):</p>
                      <p className="text-sm text-slate-900 italic">"{improvement.suggested_phrase}"</p>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600">{improvement.reason}</p>
                </div>
              ))}
            </AccordionContent>
          </AccordionItem>
        )}
      </Accordion>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setReviewResults(null);
          reviewNote();
        }}
      >
        Re-Review Note
      </Button>
    </div>
  );
}