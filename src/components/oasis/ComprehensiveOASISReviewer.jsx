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
  FileSearch,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  BookOpen,
  TrendingUp,
  Shield,
  Info,
  ChevronDown,
  ChevronUp
} from "lucide-react";

export default function ComprehensiveOASISReviewer({
  oasisData,
  analysisResults,
  patientData,
  autoReview = true
}) {
  const ai = useAICall();
  const [reviewResults, setReviewResults] = useState(null);
  const [expandedSections, setExpandedSections] = useState(['compliance', 'quality', 'inconsistencies']);

  const performComprehensiveReview = useCallback(async () => {
    if (!oasisData || !analysisResults) return;

    try {
      const prompt = `You are a Medicare OASIS compliance expert. Perform a COMPREHENSIVE review of this OASIS assessment.

OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

ANALYSIS RESULTS:
${JSON.stringify(analysisResults, null, 2)}

PATIENT CONTEXT:
${JSON.stringify(patientData || {}, null, 2)}

PERFORM COMPREHENSIVE REVIEW IN 3 AREAS:

1. COMPLIANCE RISKS
Identify specific compliance violations or risks:
- Missing required M-items or skip patterns
- CMS CoP (Conditions of Participation) violations
- Medicare coverage requirement gaps
- Homebound status insufficiency
- Skilled need justification gaps
- Assessment timing issues
- Discharge planning deficiencies
- Patient rights documentation
- Infection control requirements
- Safety assessment gaps

For EACH compliance risk, provide:
- Risk description
- Severity level (critical/high/medium/low)
- Specific CMS regulation violated
- Official CMS guideline link (use real CMS.gov URLs from 42 CFR 484)
- Plain-language explanation (as if explaining to a non-clinician)
- Specific corrective action required
- Example of compliant documentation
- Timeline to fix (immediate/within 24hrs/within week)

2. QUALITY MEASURE IMPROVEMENTS
Analyze OASIS-based Quality Measures:
- Improvement in Ambulation (M1860)
- Improvement in Bed Transferring (M1850)
- Improvement in Bathing (M1830)
- Improvement in Dyspnea (M1400)
- Acute Care Hospitalization rates
- Discharge to Community
- Drug Education on All Medications
- Influenza Immunization
- Pneumococcal Immunization

For EACH quality measure opportunity, provide:
- Measure name and NQF number
- Current status (at-risk/missing/good)
- What data is missing or weak
- Impact on STAR ratings
- CMS Quality Reporting guideline link
- Plain-language explanation of the measure
- Specific documentation to add
- Expected improvement in score

3. DOCUMENTATION INCONSISTENCIES
Identify contradictions and logical errors:
- Functional scores vs narrative mismatches
- Comorbidity vs medication contradictions
- Wound status vs treatment plan conflicts
- Cognitive score vs independence contradictions
- Safety risk vs interventions mismatches
- Timeline/date inconsistencies
- Clinical group vs diagnosis conflicts

For EACH inconsistency, provide:
- Description of the contradiction
- Data points involved (specific M-items)
- Why it matters (revenue/audit/quality impact)
- Plain-language explanation
- Which data point is likely incorrect
- How to reconcile the inconsistency
- CMS guidance on proper documentation

Return detailed JSON with all findings.`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            review_summary: { type: "string" },
            overall_risk_level: { type: "string", enum: ["critical", "high", "moderate", "low", "minimal"] },
            total_findings: { type: "number" },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_title: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  cms_regulation: { type: "string" },
                  cms_guideline_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  corrective_action: { type: "string" },
                  compliant_example: { type: "string" },
                  timeline_to_fix: { type: "string", enum: ["immediate", "within_24hrs", "within_week", "within_month"] },
                  affected_m_items: { type: "array", items: { type: "string" } },
                  audit_impact: { type: "string" },
                  revenue_impact: { type: "string" }
                }
              }
            },
            quality_measure_opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  measure_name: { type: "string" },
                  nqf_number: { type: "string" },
                  current_status: { type: "string", enum: ["at_risk", "missing_data", "good", "needs_improvement"] },
                  what_is_missing: { type: "string" },
                  star_rating_impact: { type: "string" },
                  cms_quality_reporting_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  specific_documentation_needed: { type: "string" },
                  expected_score_improvement: { type: "string" },
                  implementation_priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  baseline_data_needed: { type: "boolean" },
                  discharge_data_needed: { type: "boolean" }
                }
              }
            },
            documentation_inconsistencies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  inconsistency_title: { type: "string" },
                  description: { type: "string" },
                  data_points_involved: { type: "array", items: { type: "string" } },
                  why_it_matters: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  likely_incorrect_value: { type: "string" },
                  how_to_reconcile: { type: "string" },
                  cms_guidance: { type: "string" },
                  cms_guidance_link: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                  impact_on_revenue: { type: "string" },
                  impact_on_quality: { type: "string" },
                  impact_on_audit: { type: "string" }
                }
              }
            },
            critical_action_items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  urgency: { type: "string" },
                  expected_outcome: { type: "string" }
                }
              }
            },
            strengths: { type: "array", items: { type: "string" } }
          }
        }
      });

      setReviewResults(result);
    } catch (error) {
      console.error('Comprehensive review error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, oasisData, patientData]);

  useEffect(() => {
    if (autoReview && oasisData && analysisResults) {
      performComprehensiveReview();
    }
  }, [oasisData?.id, autoReview, analysisResults, oasisData, performComprehensiveReview]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-400';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-400';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-400';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-400';
      default: return 'bg-slate-100 text-slate-800 border-slate-400';
    }
  };

  const getRiskLevelColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-700 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-green-600 text-white';
      case 'minimal': return 'bg-green-700 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const getTimelineIcon = (timeline) => {
    switch (timeline) {
      case 'immediate': return '🚨';
      case 'within_24hrs': return '⏰';
      case 'within_week': return '📅';
      case 'within_month': return '🗓️';
      default: return '⏱️';
    }
  };

  return (
    <Card className="border-2 border-indigo-400 bg-gradient-to-br from-indigo-50 to-blue-50 shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileSearch className="w-6 h-6 text-indigo-600" />
            Comprehensive OASIS Review
            {ai.loading && <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />}
          </CardTitle>
          {reviewResults && (
            <Badge className={getRiskLevelColor(reviewResults.overall_risk_level)} size="lg">
              {reviewResults.overall_risk_level?.toUpperCase()} RISK
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-16 h-16 animate-spin text-indigo-600 mx-auto mb-4" />
            <p className="text-indigo-700 font-medium mb-2">AI performing comprehensive OASIS review...</p>
            <p className="text-sm text-slate-600">Analyzing compliance, quality measures, and documentation consistency</p>
          </div>
        )}

        {!ai.loading && !reviewResults && (
          <div className="text-center py-8">
            <FileSearch className="w-16 h-16 text-indigo-300 mx-auto mb-4" />
            <p className="text-slate-600 mb-4">Click below to perform a comprehensive AI review</p>
            <Button onClick={performComprehensiveReview} className="bg-indigo-600 hover:bg-indigo-700">
              <FileSearch className="w-4 h-4 mr-2" />
              Start Comprehensive Review
            </Button>
          </div>
        )}

        {reviewResults && (
          <div className="space-y-4">
            {/* Review Summary */}
            <Alert className={
              reviewResults.overall_risk_level === 'critical' || reviewResults.overall_risk_level === 'high'
                ? 'bg-red-100 border-red-400'
                : reviewResults.overall_risk_level === 'moderate'
                ? 'bg-yellow-100 border-yellow-400'
                : 'bg-green-100 border-green-400'
            }>
              <AlertDescription>
                <div className="flex items-center justify-between mb-2">
                  <p className="font-semibold text-slate-900">Review Summary</p>
                  <Badge variant="outline">{reviewResults.total_findings} findings</Badge>
                </div>
                <p className="text-sm text-slate-800">{reviewResults.review_summary}</p>
              </AlertDescription>
            </Alert>

            {/* Critical Action Items */}
            {reviewResults.critical_action_items?.length > 0 && (
              <Alert className="bg-red-50 border-red-400">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <AlertDescription>
                  <p className="font-semibold text-red-900 mb-3">🚨 Critical Actions Required</p>
                  <div className="space-y-2">
                    {reviewResults.critical_action_items.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-lg border border-red-300">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="bg-red-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs flex-shrink-0">
                            {idx + 1}
                          </span>
                          <p className="font-semibold text-red-900">{item.action}</p>
                        </div>
                        <Badge className="text-xs mb-2">{item.urgency}</Badge>
                        <p className="text-sm text-slate-700">{item.expected_outcome}</p>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <Accordion type="multiple" value={expandedSections} onValueChange={setExpandedSections} className="space-y-3">
              {/* Compliance Risks */}
              <AccordionItem value="compliance" className="border-2 border-red-400 rounded-lg bg-red-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-red-600" />
                    <span className="font-semibold text-red-900">
                      Compliance Risks ({reviewResults.compliance_risks?.length || 0})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {reviewResults.compliance_risks?.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">No compliance risks detected</p>
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[600px]">
                      <div className="space-y-4">
                        {reviewResults.compliance_risks?.map((risk, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-red-300 p-4">
                            <div className="flex items-start justify-between mb-3">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <h4 className="font-semibold text-red-900">{risk.risk_title}</h4>
                                  <Badge className={getSeverityColor(risk.severity)}>
                                    {risk.severity}
                                  </Badge>
                                  <span className="text-xl">{getTimelineIcon(risk.timeline_to_fix)}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {risk.timeline_to_fix?.replace('_', ' ')}
                                  </Badge>
                                </div>
                                {risk.affected_m_items?.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mb-2">
                                    {risk.affected_m_items.map((item, i) => (
                                      <Badge key={i} variant="outline" className="text-xs font-mono">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            <p className="text-sm text-slate-800 mb-3">{risk.description}</p>

                            {/* Plain Language Explanation */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <div className="flex items-center gap-2 mb-1">
                                <Info className="w-4 h-4 text-blue-600" />
                                <p className="font-semibold text-xs text-blue-900">Plain English</p>
                              </div>
                              <p className="text-sm text-blue-800">{risk.plain_language_explanation}</p>
                            </div>

                            {/* CMS Regulation Reference */}
                            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300 mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <BookOpen className="w-4 h-4 text-indigo-600" />
                                <p className="font-semibold text-xs text-indigo-900">CMS Regulation</p>
                              </div>
                              <p className="text-sm text-indigo-800 mb-2">{risk.cms_regulation}</p>
                              {risk.cms_guideline_link && (
                                <a
                                  href={risk.cms_guideline_link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-sm text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  View Official CMS Guideline
                                </a>
                              )}
                            </div>

                            {/* Impact Analysis */}
                            <div className="grid grid-cols-2 gap-2 mb-3">
                              {risk.audit_impact && (
                                <div className="bg-orange-50 p-2 rounded border border-orange-200">
                                  <p className="text-xs text-orange-700 font-semibold mb-1">📋 Audit Impact</p>
                                  <p className="text-xs text-orange-800">{risk.audit_impact}</p>
                                </div>
                              )}
                              {risk.revenue_impact && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="text-xs text-green-700 font-semibold mb-1">💰 Revenue Impact</p>
                                  <p className="text-xs text-green-800">{risk.revenue_impact}</p>
                                </div>
                              )}
                            </div>

                            {/* Corrective Action */}
                            <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                              <p className="font-semibold text-xs text-yellow-900 mb-1">🔧 Corrective Action Required</p>
                              <p className="text-sm text-yellow-800">{risk.corrective_action}</p>
                            </div>

                            {/* Compliant Example */}
                            {risk.compliant_example && (
                              <div className="bg-green-50 p-3 rounded-lg border border-green-300">
                                <p className="font-semibold text-xs text-green-900 mb-1">✓ Compliant Example</p>
                                <p className="text-sm text-green-800 italic">"{risk.compliant_example}"</p>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Quality Measure Opportunities */}
              <AccordionItem value="quality" className="border-2 border-navy-400 rounded-lg bg-navy-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-navy-600" />
                    <span className="font-semibold text-navy-900">
                      Quality Measure Opportunities ({reviewResults.quality_measure_opportunities?.length || 0})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {reviewResults.quality_measure_opportunities?.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">All quality measures well-documented</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {reviewResults.quality_measure_opportunities?.map((measure, idx) => (
                        <div key={idx} className="bg-white rounded-lg border-2 border-navy-300 p-4">
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <h4 className="font-semibold text-navy-900">{measure.measure_name}</h4>
                              {measure.nqf_number && (
                                <Badge variant="outline" className="text-xs mt-1">
                                  {measure.nqf_number}
                                </Badge>
                              )}
                            </div>
                            <div className="text-right">
                              <Badge className={
                                measure.current_status === 'at_risk' ? 'bg-red-600 text-white' :
                                measure.current_status === 'missing_data' ? 'bg-orange-600 text-white' :
                                measure.current_status === 'needs_improvement' ? 'bg-yellow-600 text-white' :
                                'bg-green-600 text-white'
                              }>
                                {measure.current_status?.replace('_', ' ')}
                              </Badge>
                              <Badge className={getSeverityColor(measure.implementation_priority)} size="sm">
                                {measure.implementation_priority} priority
                              </Badge>
                            </div>
                          </div>

                          {/* Plain Language Explanation */}
                          <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                            <div className="flex items-center gap-2 mb-1">
                              <Info className="w-4 h-4 text-blue-600" />
                              <p className="font-semibold text-xs text-blue-900">What This Measure Means</p>
                            </div>
                            <p className="text-sm text-blue-800">{measure.plain_language_explanation}</p>
                          </div>

                          {/* Missing Data */}
                          <div className="bg-orange-50 p-3 rounded-lg border border-orange-300 mb-3">
                            <p className="font-semibold text-xs text-orange-900 mb-1">⚠️ What's Missing</p>
                            <p className="text-sm text-orange-800">{measure.what_is_missing}</p>
                          </div>

                          {/* STAR Rating Impact */}
                          <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                            <p className="font-semibold text-xs text-yellow-900 mb-1">⭐ STAR Rating Impact</p>
                            <p className="text-sm text-yellow-800">{measure.star_rating_impact}</p>
                          </div>

                          {/* CMS Quality Reporting Link */}
                          {measure.cms_quality_reporting_link && (
                            <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300 mb-3">
                              <div className="flex items-center gap-2 mb-2">
                                <BookOpen className="w-4 h-4 text-indigo-600" />
                                <p className="font-semibold text-xs text-indigo-900">CMS Quality Reporting</p>
                              </div>
                              <a
                                href={measure.cms_quality_reporting_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sm text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                              >
                                <ExternalLink className="w-3 h-3" />
                                View Quality Measure Specifications
                              </a>
                            </div>
                          )}

                          {/* Specific Documentation Needed */}
                          <div className="bg-green-50 p-3 rounded-lg border border-green-300 mb-3">
                            <p className="font-semibold text-xs text-green-900 mb-1">📝 Documentation to Add</p>
                            <p className="text-sm text-green-800">{measure.specific_documentation_needed}</p>
                          </div>

                          {/* Data Requirements */}
                          <div className="flex gap-2">
                            {measure.baseline_data_needed && (
                              <Badge className="bg-blue-600 text-white text-xs">
                                Baseline Data Required
                              </Badge>
                            )}
                            {measure.discharge_data_needed && (
                              <Badge className="bg-navy-600 text-white text-xs">
                                Discharge Data Required
                              </Badge>
                            )}
                          </div>

                          {/* Expected Improvement */}
                          {measure.expected_score_improvement && (
                            <div className="mt-3 bg-gradient-to-r from-green-50 to-emerald-50 p-2 rounded border border-green-300">
                              <p className="text-xs text-green-700 font-semibold">
                                📈 Expected Improvement: {measure.expected_score_improvement}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Documentation Inconsistencies */}
              <AccordionItem value="inconsistencies" className="border-2 border-orange-400 rounded-lg bg-orange-50">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-orange-600" />
                    <span className="font-semibold text-orange-900">
                      Documentation Inconsistencies ({reviewResults.documentation_inconsistencies?.length || 0})
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pt-2">
                  {reviewResults.documentation_inconsistencies?.length === 0 ? (
                    <div className="bg-green-50 p-4 rounded-lg border border-green-300 text-center">
                      <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                      <p className="text-green-800 font-medium">No documentation inconsistencies found</p>
                    </div>
                  ) : (
                    <ScrollArea className="max-h-[600px]">
                      <div className="space-y-4">
                        {reviewResults.documentation_inconsistencies?.map((inconsistency, idx) => (
                          <div key={idx} className="bg-white rounded-lg border-2 border-orange-300 p-4">
                            <div className="flex items-start justify-between mb-3">
                              <h4 className="font-semibold text-orange-900 flex-1">{inconsistency.inconsistency_title}</h4>
                              <Badge className={getSeverityColor(inconsistency.severity)}>
                                {inconsistency.severity}
                              </Badge>
                            </div>

                            {/* Data Points Involved */}
                            {inconsistency.data_points_involved?.length > 0 && (
                              <div className="mb-3">
                                <p className="text-xs text-slate-600 mb-1">Data Points Involved:</p>
                                <div className="flex flex-wrap gap-1">
                                  {inconsistency.data_points_involved.map((point, i) => (
                                    <Badge key={i} variant="outline" className="text-xs font-mono bg-white">
                                      {point}
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            )}

                            <p className="text-sm text-slate-800 mb-3">{inconsistency.description}</p>

                            {/* Plain Language Explanation */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <div className="flex items-center gap-2 mb-1">
                                <Info className="w-4 h-4 text-blue-600" />
                                <p className="font-semibold text-xs text-blue-900">What This Means</p>
                              </div>
                              <p className="text-sm text-blue-800">{inconsistency.plain_language_explanation}</p>
                            </div>

                            {/* Why It Matters */}
                            <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-300 mb-3">
                              <p className="font-semibold text-xs text-yellow-900 mb-1">⚠️ Why It Matters</p>
                              <p className="text-sm text-yellow-800">{inconsistency.why_it_matters}</p>
                            </div>

                            {/* Impact Analysis */}
                            <div className="grid grid-cols-3 gap-2 mb-3">
                              {inconsistency.impact_on_revenue && (
                                <div className="bg-green-50 p-2 rounded border border-green-200">
                                  <p className="text-xs text-green-700 font-semibold mb-1">💰 Revenue</p>
                                  <p className="text-xs text-green-800">{inconsistency.impact_on_revenue}</p>
                                </div>
                              )}
                              {inconsistency.impact_on_quality && (
                                <div className="bg-navy-50 p-2 rounded border border-navy-200">
                                  <p className="text-xs text-navy-700 font-semibold mb-1">⭐ Quality</p>
                                  <p className="text-xs text-navy-800">{inconsistency.impact_on_quality}</p>
                                </div>
                              )}
                              {inconsistency.impact_on_audit && (
                                <div className="bg-red-50 p-2 rounded border border-red-200">
                                  <p className="text-xs text-red-700 font-semibold mb-1">🔍 Audit</p>
                                  <p className="text-xs text-red-800">{inconsistency.impact_on_audit}</p>
                                </div>
                              )}
                            </div>

                            {/* Likely Incorrect Value */}
                            {inconsistency.likely_incorrect_value && (
                              <div className="bg-red-50 p-2 rounded border border-red-300 mb-3">
                                <p className="text-xs text-red-700 font-semibold mb-1">❌ Likely Incorrect</p>
                                <p className="text-sm text-red-800">{inconsistency.likely_incorrect_value}</p>
                              </div>
                            )}

                            {/* How to Reconcile */}
                            <div className="bg-blue-50 p-3 rounded-lg border border-blue-300 mb-3">
                              <p className="font-semibold text-xs text-blue-900 mb-1">🔧 How to Fix</p>
                              <p className="text-sm text-blue-800">{inconsistency.how_to_reconcile}</p>
                            </div>

                            {/* CMS Guidance */}
                            {inconsistency.cms_guidance && (
                              <div className="bg-indigo-50 p-3 rounded-lg border border-indigo-300">
                                <div className="flex items-center gap-2 mb-2">
                                  <BookOpen className="w-4 h-4 text-indigo-600" />
                                  <p className="font-semibold text-xs text-indigo-900">CMS Guidance</p>
                                </div>
                                <p className="text-sm text-indigo-800 mb-2">{inconsistency.cms_guidance}</p>
                                {inconsistency.cms_guidance_link && (
                                  <a
                                    href={inconsistency.cms_guidance_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-indigo-600 hover:text-indigo-800 underline flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    View CMS Documentation Guidance
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  )}
                </AccordionContent>
              </AccordionItem>

              {/* Strengths */}
              {reviewResults.strengths?.length > 0 && (
                <AccordionItem value="strengths" className="border-2 border-green-400 rounded-lg bg-green-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="font-semibold text-green-900">
                        Documentation Strengths ({reviewResults.strengths.length})
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="bg-white p-4 rounded-lg border border-green-300">
                      <ul className="space-y-2">
                        {reviewResults.strengths.map((strength, idx) => (
                          <li key={idx} className="text-sm text-green-800 flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            {strength}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              )}
            </Accordion>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                onClick={performComprehensiveReview}
                variant="outline"
                disabled={ai.loading}
                className="flex-1"
              >
                {ai.loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Re-reviewing...</>
                ) : (
                  'Re-run Comprehensive Review'
                )}
              </Button>
              <Button
                onClick={() => {
                  const expanded = expandedSections.length === 3 ? [] : ['compliance', 'quality', 'inconsistencies'];
                  setExpandedSections(expanded);
                }}
                variant="outline"
              >
                {expandedSections.length === 3 ? (
                  <><ChevronUp className="w-4 h-4 mr-2" /> Collapse All</>
                ) : (
                  <><ChevronDown className="w-4 h-4 mr-2" /> Expand All</>
                )}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}