import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  TrendingDown,
  ExternalLink,
  BookOpen,
  Target
} from "lucide-react";

export default function AutomatedQualityAssurance({
  oasisData,
  patientData,
  clinicalNotes,
  autoRun = false,
  onQAComplete
}) {
  const ai = useAICall();
  const [qaResults, setQaResults] = useState(null);

  const runQualityAssurance = useCallback(async () => {
    if (!oasisData) return;

    try {
      const prompt = `You are a Medicare Quality Assurance expert. Perform comprehensive QA checks on OASIS documentation.

OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

PATIENT DATA:
${JSON.stringify(patientData || {}, null, 2)}

CLINICAL NOTES:
${clinicalNotes || 'No clinical notes provided'}

PERFORM THESE QA CHECKS:

1. QUALITY MEASURE DOCUMENTATION
- Check for data needed for OASIS-based Quality Measures:
  * Improvement in Ambulation (M1860)
  * Improvement in Bed Transferring (M1850)  
  * Improvement in Bathing (M1830)
  * Improvement in Dyspnea (M1400)
  * Acute Care Hospitalization
  * Discharge to Community
  * Influenza/Pneumococcal Immunization
  * Drug Education on All Medications
- Identify missing baseline data or follow-up data needed
- Flag items that could negatively impact quality scores

2. DOCUMENTATION ERRORS
- Incomplete functional assessments
- Missing skip patterns
- Illogical scoring patterns (e.g., can bathe independently but needs total assist with grooming)
- Missing required narrative support
- Inconsistent dates or timeline issues
- Contradictory information across M-items

3. NON-OASIS COMPLIANCE ISSUES
- Missing homebound justification
- Inadequate skilled need documentation
- Insufficient safety assessment
- Missing medication reconciliation documentation
- Incomplete caregiver education documentation
- Missing coordination with physician documentation
- Inadequate infection control measures
- Missing fall risk interventions
- Insufficient pain management documentation
- Missing advance directive discussion

4. QUALITY RATING RISKS
- Risk of poor STAR ratings
- Patient experience documentation gaps
- Care coordination deficiencies
- Discharge planning inadequacies

For each failure, provide:
- Description of the issue
- Why it matters for quality/compliance
- CMS guideline reference with link
- Plain-language explanation
- Specific do's and don'ts
- Example compliant documentation
- Recommended fix`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_qa_score: { type: "number" },
            total_checks_performed: { type: "number" },
            checks_passed: { type: "number" },
            checks_failed: { type: "number" },
            quality_measure_readiness: {
              type: "object",
              properties: {
                ready_for_quality_reporting: { type: "boolean" },
                missing_measures: { type: "array", items: { type: "string" } },
                at_risk_measures: { type: "array", items: { type: "string" } }
              }
            },
            documentation_errors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  error_type: { type: "string" },
                  description: { type: "string" },
                  affected_items: { type: "array", items: { type: "string" } },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  why_it_matters: { type: "string" },
                  cms_guideline: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } },
                  compliant_example: { type: "string" },
                  non_compliant_example: { type: "string" },
                  recommended_fix: { type: "string" }
                }
              }
            },
            quality_measure_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  measure_name: { type: "string" },
                  measure_code: { type: "string" },
                  what_is_missing: { type: "string" },
                  impact_on_star_rating: { type: "string" },
                  data_needed: { type: "string" },
                  cms_guideline: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } },
                  action_required: { type: "string" }
                }
              }
            },
            non_oasis_compliance_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  compliance_area: { type: "string" },
                  issue_description: { type: "string" },
                  regulatory_requirement: { type: "string" },
                  cms_regulation: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } },
                  compliant_example: { type: "string" },
                  non_compliant_example: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  remediation_steps: { type: "array", items: { type: "string" } }
                }
              }
            },
            quality_rating_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_area: { type: "string" },
                  description: { type: "string" },
                  star_rating_impact: { type: "string" },
                  prevention_strategy: { type: "string" }
                }
              }
            },
            critical_action_items: {
              type: "array",
              items: { type: "string" }
            },
            qa_summary: { type: "string" }
          }
        }
      });

      setQaResults(result);
      if (onQAComplete) {
        onQAComplete(result);
      }
    } catch (error) {
      console.error('QA check error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [oasisData, patientData, clinicalNotes, onQAComplete]);

  useEffect(() => {
    if (autoRun && oasisData) {
      runQualityAssurance();
    }
  }, [autoRun, oasisData?.id, oasisData, runQualityAssurance]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <Card className="border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-blue-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-600" />
            Automated Quality Assurance
            {ai.loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />}
          </CardTitle>
          {!qaResults && !ai.loading && (
            <Button onClick={runQualityAssurance} className="bg-indigo-600 hover:bg-indigo-700">
              <Shield className="w-4 h-4 mr-2" />
              Run QA Checks
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-indigo-700">Running comprehensive quality assurance checks...</p>
          </div>
        )}

        {!ai.loading && !qaResults && (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-indigo-400 mx-auto mb-3" />
            <p className="text-slate-600">Click "Run QA Checks" to validate documentation quality</p>
          </div>
        )}

        {qaResults && (
          <div className="space-y-6">
            {/* QA Score Summary */}
            <Alert className={qaResults.overall_qa_score >= 85 ? 'bg-green-100 border-green-300' : qaResults.overall_qa_score >= 70 ? 'bg-yellow-100 border-yellow-300' : 'bg-red-100 border-red-300'}>
              <AlertDescription>
                <div className="grid grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="text-xs text-slate-600">QA Score</p>
                    <p className={`text-3xl font-bold ${qaResults.overall_qa_score >= 85 ? 'text-green-700' : qaResults.overall_qa_score >= 70 ? 'text-yellow-700' : 'text-red-700'}`}>
                      {qaResults.overall_qa_score}%
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Total Checks</p>
                    <p className="text-2xl font-bold text-slate-900">{qaResults.total_checks_performed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Passed</p>
                    <p className="text-2xl font-bold text-green-700">{qaResults.checks_passed}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Failed</p>
                    <p className="text-2xl font-bold text-red-700">{qaResults.checks_failed}</p>
                  </div>
                </div>
                <p className="text-sm text-slate-700 mt-3 text-center">{qaResults.qa_summary}</p>
              </AlertDescription>
            </Alert>

            {/* Quality Measure Readiness */}
            {qaResults.quality_measure_readiness && (
              <div className={`p-4 rounded-lg border-2 ${qaResults.quality_measure_readiness.ready_for_quality_reporting ? 'bg-green-50 border-green-300' : 'bg-orange-50 border-orange-300'}`}>
                <div className="flex items-center gap-2 mb-2">
                  {qaResults.quality_measure_readiness.ready_for_quality_reporting ? (
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-orange-600" />
                  )}
                  <h3 className="font-semibold">
                    {qaResults.quality_measure_readiness.ready_for_quality_reporting 
                      ? 'Ready for Quality Reporting' 
                      : 'Quality Measure Gaps Detected'}
                  </h3>
                </div>
                {qaResults.quality_measure_readiness.missing_measures?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-medium text-orange-800">Missing Quality Measures:</p>
                    <ul className="text-xs text-orange-700 list-disc list-inside">
                      {qaResults.quality_measure_readiness.missing_measures.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {qaResults.quality_measure_readiness.at_risk_measures?.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-red-800">At-Risk Quality Measures:</p>
                    <ul className="text-xs text-red-700 list-disc list-inside">
                      {qaResults.quality_measure_readiness.at_risk_measures.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Critical Action Items */}
            {qaResults.critical_action_items?.length > 0 && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription>
                  <p className="font-semibold text-red-900 mb-2">Critical Action Items</p>
                  <ol className="space-y-1">
                    {qaResults.critical_action_items.map((item, idx) => (
                      <li key={idx} className="text-sm text-red-800 flex items-start gap-2">
                        <span className="bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                          {idx + 1}
                        </span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </AlertDescription>
              </Alert>
            )}

            <Accordion type="multiple" className="space-y-2">
              {/* Documentation Errors */}
              {qaResults.documentation_errors?.length > 0 && (
                <AccordionItem value="errors" className="border-2 border-red-300 rounded-lg bg-red-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold">Documentation Errors ({qaResults.documentation_errors.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <ScrollArea className="max-h-96">
                      <div className="space-y-3">
                        {qaResults.documentation_errors.map((error, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-red-200 p-4">
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <h4 className="font-semibold text-red-900">{error.error_type}</h4>
                                  <Badge className={getSeverityColor(error.severity)}>
                                    {error.severity}
                                  </Badge>
                                </div>
                                {error.affected_items?.length > 0 && (
                                  <p className="text-xs text-slate-600">
                                    Affects: {error.affected_items.join(', ')}
                                  </p>
                                )}
                              </div>
                            </div>

                            <p className="text-sm text-slate-800 mb-3">{error.description}</p>

                            <div className="bg-yellow-50 p-3 rounded mb-3 border border-yellow-200">
                              <p className="font-semibold text-xs text-yellow-900 mb-1">⚠️ Why It Matters</p>
                              <p className="text-xs text-yellow-800">{error.why_it_matters}</p>
                            </div>

                            {error.cms_guideline && (
                              <div className="bg-indigo-50 p-3 rounded mb-3 border border-indigo-200">
                                <p className="font-semibold text-xs text-indigo-900 mb-1 flex items-center gap-2">
                                  <BookOpen className="w-3 h-3" />
                                  CMS Guideline
                                </p>
                                <p className="text-xs text-indigo-800 mb-1">{error.cms_guideline}</p>
                                {error.cms_reference_link && (
                                  <a 
                                    href={error.cms_reference_link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-xs text-indigo-600 underline hover:text-indigo-800 flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    View Official CMS Documentation
                                  </a>
                                )}
                              </div>
                            )}

                            {error.plain_language_explanation && (
                              <div className="bg-blue-50 p-3 rounded mb-3 border border-blue-200">
                                <p className="font-semibold text-xs text-blue-900 mb-1">📘 Plain English</p>
                                <p className="text-xs text-blue-800">{error.plain_language_explanation}</p>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {error.documentation_dos?.length > 0 && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="font-semibold text-xs text-green-900 mb-1">✓ DO:</p>
                                  <ul className="text-xs text-green-800 space-y-1">
                                    {error.documentation_dos.map((item, i) => (
                                      <li key={i}>• {item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {error.documentation_donts?.length > 0 && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="font-semibold text-xs text-red-900 mb-1">✗ DON'T:</p>
                                  <ul className="text-xs text-red-800 space-y-1">
                                    {error.documentation_donts.map((item, i) => (
                                      <li key={i}>• {item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {error.compliant_example && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="font-semibold text-xs text-green-900 mb-1">✓ Good Example:</p>
                                  <p className="text-xs text-green-800 italic">"{error.compliant_example}"</p>
                                </div>
                              )}
                              {error.non_compliant_example && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="font-semibold text-xs text-red-900 mb-1">✗ Bad Example:</p>
                                  <p className="text-xs text-red-800 italic">"{error.non_compliant_example}"</p>
                                </div>
                              )}
                            </div>

                            <div className="bg-blue-50 p-3 rounded border border-blue-300">
                              <p className="font-semibold text-xs text-blue-900 mb-1">🔧 Recommended Fix:</p>
                              <p className="text-sm text-blue-800">{error.recommended_fix}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Quality Measure Gaps */}
              {qaResults.quality_measure_gaps?.length > 0 && (
                <AccordionItem value="quality-gaps" className="border-2 border-navy-300 rounded-lg bg-navy-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <Target className="w-5 h-5 text-navy-600" />
                      <span className="font-semibold">Quality Measure Gaps ({qaResults.quality_measure_gaps.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="space-y-3">
                      {qaResults.quality_measure_gaps.map((gap, idx) => (
                        <div key={idx} className="bg-white rounded-lg border-2 border-navy-200 p-4">
                          <div className="flex items-center justify-between mb-2">
                            <div>
                              <h4 className="font-semibold text-navy-900">{gap.measure_name}</h4>
                              {gap.measure_code && (
                                <Badge variant="outline" className="mt-1 text-xs">{gap.measure_code}</Badge>
                              )}
                            </div>
                            <Badge className="bg-navy-600 text-white">STAR Impact</Badge>
                          </div>

                          <p className="text-sm text-slate-800 mb-3">{gap.what_is_missing}</p>

                          <div className="bg-orange-50 p-2 rounded mb-3 text-xs border border-orange-200">
                            <p className="font-semibold text-orange-900 mb-1">📊 STAR Rating Impact:</p>
                            <p className="text-orange-800">{gap.impact_on_star_rating}</p>
                          </div>

                          {gap.cms_guideline && (
                            <div className="bg-indigo-50 p-3 rounded mb-3 border border-indigo-200">
                              <p className="font-semibold text-xs text-indigo-900 mb-1 flex items-center gap-2">
                                <BookOpen className="w-3 h-3" />
                                CMS Guideline
                              </p>
                              <p className="text-xs text-indigo-800 mb-1">{gap.cms_guideline}</p>
                              {gap.cms_reference_link && (
                                <a 
                                  href={gap.cms_reference_link} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-xs text-indigo-600 underline hover:text-indigo-800 flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View Official CMS Guideline
                                </a>
                              )}
                            </div>
                          )}

                          {gap.plain_language_explanation && (
                            <div className="bg-blue-50 p-3 rounded mb-3 border border-blue-200">
                              <p className="font-semibold text-xs text-blue-900 mb-1">📘 What This Means</p>
                              <p className="text-xs text-blue-800">{gap.plain_language_explanation}</p>
                            </div>
                          )}

                          <div className="grid grid-cols-2 gap-2 mb-3">
                            {gap.documentation_dos?.length > 0 && (
                              <div className="bg-green-50 p-2 rounded border border-green-200">
                                <p className="font-semibold text-xs text-green-900 mb-1">✓ DO:</p>
                                <ul className="text-xs text-green-800 space-y-1">
                                  {gap.documentation_dos.map((item, i) => (
                                    <li key={i}>• {item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {gap.documentation_donts?.length > 0 && (
                              <div className="bg-red-50 p-2 rounded border border-red-200">
                                <p className="font-semibold text-xs text-red-900 mb-1">✗ DON'T:</p>
                                <ul className="text-xs text-red-800 space-y-1">
                                  {gap.documentation_donts.map((item, i) => (
                                    <li key={i}>• {item}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <div className="bg-blue-50 p-3 rounded border border-blue-300">
                            <p className="font-semibold text-xs text-blue-900 mb-1">📋 Data Needed:</p>
                            <p className="text-sm text-blue-800">{gap.data_needed}</p>
                          </div>

                          <div className="bg-green-50 p-3 rounded mt-2 border border-green-300">
                            <p className="font-semibold text-xs text-green-900 mb-1">✅ Action Required:</p>
                            <p className="text-sm text-green-800">{gap.action_required}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Non-OASIS Compliance Issues */}
              {qaResults.non_oasis_compliance_issues?.length > 0 && (
                <AccordionItem value="compliance" className="border-2 border-orange-300 rounded-lg bg-orange-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-orange-600" />
                      <span className="font-semibold">Non-OASIS Compliance Issues ({qaResults.non_oasis_compliance_issues.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <ScrollArea className="max-h-96">
                      <div className="space-y-3">
                        {qaResults.non_oasis_compliance_issues.map((issue, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-orange-200 p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-orange-900">{issue.compliance_area}</h4>
                              <Badge className={getSeverityColor(issue.severity)}>
                                {issue.severity}
                              </Badge>
                            </div>

                            <p className="text-sm text-slate-800 mb-3">{issue.issue_description}</p>

                            <div className="bg-red-50 p-2 rounded mb-3 text-xs border border-red-200">
                              <p className="font-semibold text-red-900 mb-1">📜 Regulatory Requirement:</p>
                              <p className="text-red-800">{issue.regulatory_requirement}</p>
                            </div>

                            {issue.cms_regulation && (
                              <div className="bg-indigo-50 p-3 rounded mb-3 border border-indigo-200">
                                <p className="font-semibold text-xs text-indigo-900 mb-1 flex items-center gap-2">
                                  <BookOpen className="w-3 h-3" />
                                  CMS Regulation
                                </p>
                                <p className="text-xs text-indigo-800 mb-1">{issue.cms_regulation}</p>
                                {issue.cms_reference_link && (
                                  <a 
                                    href={issue.cms_reference_link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-xs text-indigo-600 underline hover:text-indigo-800 flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    View Official CMS Regulation
                                  </a>
                                )}
                              </div>
                            )}

                            {issue.plain_language_explanation && (
                              <div className="bg-blue-50 p-3 rounded mb-3 border border-blue-200">
                                <p className="font-semibold text-xs text-blue-900 mb-1">📘 Plain English Explanation</p>
                                <p className="text-xs text-blue-800">{issue.plain_language_explanation}</p>
                              </div>
                            )}

                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {issue.documentation_dos?.length > 0 && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="font-semibold text-xs text-green-900 mb-1">✓ DO:</p>
                                  <ul className="text-xs text-green-800 space-y-1">
                                    {issue.documentation_dos.map((item, i) => (
                                      <li key={i}>• {item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                              {issue.documentation_donts?.length > 0 && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="font-semibold text-xs text-red-900 mb-1">✗ DON'T:</p>
                                  <ul className="text-xs text-red-800 space-y-1">
                                    {issue.documentation_donts.map((item, i) => (
                                      <li key={i}>• {item}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>

                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {issue.compliant_example && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="font-semibold text-xs text-green-900 mb-1">✓ Compliant Example:</p>
                                  <p className="text-xs text-green-800 italic">"{issue.compliant_example}"</p>
                                </div>
                              )}
                              {issue.non_compliant_example && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="font-semibold text-xs text-red-900 mb-1">✗ Non-Compliant Example:</p>
                                  <p className="text-xs text-red-800 italic">"{issue.non_compliant_example}"</p>
                                </div>
                              )}
                            </div>

                            <div className="bg-white p-2 rounded border">
                              <p className="font-semibold text-xs text-slate-700 mb-1">Remediation Steps:</p>
                              <ol className="text-xs text-slate-700 space-y-1">
                                {issue.remediation_steps?.map((step, sidx) => (
                                  <li key={sidx}>{sidx + 1}. {step}</li>
                                ))}
                              </ol>
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              )}

              {/* Quality Rating Risks */}
              {qaResults.quality_rating_risks?.length > 0 && (
                <AccordionItem value="rating-risks" className="border-2 border-yellow-300 rounded-lg bg-yellow-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <TrendingDown className="w-5 h-5 text-yellow-600" />
                      <span className="font-semibold">Quality Rating Risks ({qaResults.quality_rating_risks.length})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="space-y-3">
                      {qaResults.quality_rating_risks.map((risk, idx) => (
                        <div key={idx} className="bg-white rounded-lg border p-3">
                          <h4 className="font-semibold text-yellow-900 mb-2">{risk.risk_area}</h4>
                          <p className="text-sm text-slate-800 mb-2">{risk.description}</p>
                          <div className="bg-orange-50 p-2 rounded mb-2 text-xs border border-orange-200">
                            <p className="font-semibold text-orange-900 mb-1">⭐ STAR Rating Impact:</p>
                            <p className="text-orange-800">{risk.star_rating_impact}</p>
                          </div>
                          <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                            <p className="font-semibold text-green-900 mb-1">Prevention Strategy:</p>
                            <p className="text-green-800">{risk.prevention_strategy}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            <Button onClick={runQualityAssurance} variant="outline" className="w-full">
              Re-run QA Checks
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}