import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Shield, AlertTriangle, Loader2, TrendingUp, FileText, CheckCircle2, BookOpen } from "lucide-react";

export default function AdvancedComplianceAnalyzer({ analysisResults, pdgmData, patientId }) {
  const ai = useAICall();
  const [complianceReport, setComplianceReport] = useState(null);
  const [autoAnalyze, setAutoAnalyze] = useState(false);

  // Fetch historical OASIS data for pattern analysis
  const { data: historicalOASIS = [] } = useQuery({
    queryKey: ['historicalOASIS', patientId],
    queryFn: () => {
      if (patientId) {
        return base44.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 50);
      }
      return base44.entities.OASISUpload.list('-created_date', 100);
    },
    enabled: !!analysisResults
  });

  // Fetch historical compliance audits
  const { data: historicalAudits = [] } = useQuery({
    queryKey: ['complianceAudits'],
    queryFn: () => base44.entities.ComplianceAudit.list('-audit_date', 100),
    enabled: !!analysisResults
  });

  const analyzeCompliance = useCallback(async () => {
    if (!analysisResults || !pdgmData) return;

    try {
      // Calculate historical compliance metrics
      const historicalMetrics = {
        total_assessments: historicalOASIS.length,
        avg_compliance_score: historicalOASIS.reduce((sum, h) => sum + (h.scores?.compliance || 0), 0) / (historicalOASIS.length || 1),
        common_issues: {},
        recurring_patterns: []
      };

      // Identify recurring issues
      historicalOASIS.forEach(h => {
        if (h.analysis_results?.compliance_concerns) {
          h.analysis_results.compliance_concerns.forEach(concern => {
            const key = concern.area || 'unknown';
            historicalMetrics.common_issues[key] = (historicalMetrics.common_issues[key] || 0) + 1;
          });
        }
      });

      // Get top recurring issues
      historicalMetrics.recurring_patterns = Object.entries(historicalMetrics.common_issues)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([area, count]) => ({ area, count }));

      // Prepare audit history context
      const auditContext = historicalAudits
        .filter(a => a.status === 'flagged' || a.status === 'critical')
        .slice(0, 10)
        .map(a => ({
          issues: a.issues?.slice(0, 3),
          compliance_score: a.compliance_score,
          date: a.audit_date
        }));

      // Advanced AI analysis with regulatory knowledge
      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert OASIS compliance auditor with deep knowledge of CMS regulations, Medicare Conditions of Participation (CoPs), and OASIS-E guidance.

CURRENT OASIS ASSESSMENT DATA:
${JSON.stringify({
  compliance_score: analysisResults.compliance_score,
  accuracy_score: analysisResults.accuracy_score,
  primary_diagnosis: pdgmData.primary_diagnosis,
  functional_scores: pdgmData.functional_scores,
  clinical_group: pdgmData.clinical_group,
  episode_timing: pdgmData.episode_timing,
  admission_source: pdgmData.admission_source,
  existing_concerns: analysisResults.compliance_concerns?.slice(0, 5),
  existing_accuracy_issues: analysisResults.accuracy_issues?.slice(0, 5)
}, null, 2)}

HISTORICAL PATTERN ANALYSIS:
- Total Past Assessments: ${historicalMetrics.total_assessments}
- Historical Avg Compliance: ${historicalMetrics.avg_compliance_score.toFixed(1)}%
- Recurring Issues: ${JSON.stringify(historicalMetrics.recurring_patterns)}

PREVIOUS AUDIT FLAGS:
${JSON.stringify(auditContext.slice(0, 3), null, 2)}

COMPLIANCE ANALYSIS REQUIREMENTS:

1. PROACTIVE RISK IDENTIFICATION:
   - Analyze subtle data patterns that may indicate non-compliance (e.g., consistently high functional scores that don't match narrative, missing comorbidities for complex diagnoses)
   - Identify "soft" compliance risks that aren't obvious errors but could trigger audits
   - Flag patterns that historically led to compliance issues in similar cases
   - Detect documentation that is technically correct but lacks sufficient clinical justification

2. REGULATORY CITATIONS:
   - Provide SPECIFIC CMS references (e.g., "CMS Conditions of Participation 484.55(c)", "OASIS-E Guidance Manual Chapter 3, Section D")
   - Cite relevant Medicare coverage criteria and Local Coverage Determinations (LCDs)
   - Reference applicable state regulations if relevant to home health/hospice
   - Include CFR (Code of Federal Regulations) citations where applicable

3. TAILORED REMEDIATION:
   - Provide patient-specific recommendations based on diagnosis, functional status, and clinical context
   - Suggest exact documentation language that satisfies regulatory requirements
   - Prioritize fixes by audit risk level and revenue impact
   - Include preventive measures to avoid similar issues in future assessments

DELIVER A COMPREHENSIVE COMPLIANCE RISK REPORT.`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: {
              type: "object",
              properties: {
                overall_risk_level: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                risk_score: { type: "number", description: "0-100 scale" },
                total_risks_identified: { type: "number" },
                regulatory_violations: { type: "number" },
                key_findings: { type: "array", items: { type: "string" } }
              }
            },
            proactive_risk_identification: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_id: { type: "string" },
                  risk_type: { type: "string", enum: ["pattern_based", "historical_recurrence", "soft_compliance", "documentation_gap", "clinical_logic", "coverage_risk"] },
                  severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  data_pattern_detected: { type: "string" },
                  why_this_matters: { type: "string" },
                  audit_trigger_likelihood: { type: "string", enum: ["very_high", "high", "moderate", "low"] },
                  historical_context: { type: "string" }
                }
              }
            },
            regulatory_compliance_report: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  violation_type: { type: "string" },
                  severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                  affected_items: { type: "array", items: { type: "string" } },
                  regulatory_citations: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        citation: { type: "string" },
                        regulation_text: { type: "string" },
                        compliance_requirement: { type: "string" },
                        how_violated: { type: "string" }
                      }
                    }
                  },
                  potential_consequences: { type: "array", items: { type: "string" } },
                  audit_appeal_risk: { type: "string" }
                }
              }
            },
            context_aware_remediation: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue_being_addressed: { type: "string" },
                  priority_level: { type: "number", description: "1-10 scale" },
                  immediate_actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        action_step: { type: "string" },
                        exact_documentation_needed: { type: "string" },
                        m_items_to_review: { type: "array", items: { type: "string" } },
                        time_estimate: { type: "string" }
                      }
                    }
                  },
                  patient_specific_context: { type: "string" },
                  clinical_rationale: { type: "string" },
                  sample_compliant_narrative: { type: "string" },
                  preventive_measures: { type: "array", items: { type: "string" } }
                }
              }
            },
            trend_analysis: {
              type: "object",
              properties: {
                improvement_areas: { type: "array", items: { type: "string" } },
                deterioration_areas: { type: "array", items: { type: "string" } },
                stability_indicators: { type: "array", items: { type: "string" } },
                predicted_future_risks: { type: "array", items: { type: "string" } }
              }
            },
            action_plan: {
              type: "object",
              properties: {
                immediate_priorities: { type: "array", items: { type: "string" } },
                short_term_goals: { type: "array", items: { type: "string" } },
                long_term_improvements: { type: "array", items: { type: "string" } },
                estimated_compliance_improvement: { type: "string" }
              }
            }
          }
        }
      });

      setComplianceReport(result);
    } catch (error) {
      console.error("Advanced compliance analysis error:", error);
      setComplianceReport({ error: "Failed to generate advanced compliance analysis. Please try again." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, pdgmData, historicalOASIS, historicalAudits]);

  // Auto-analyze when data is available
  useEffect(() => {
    if (analysisResults && !complianceReport && !ai.loading && !autoAnalyze && historicalOASIS.length >= 0) {
      setAutoAnalyze(true);
      analyzeCompliance();
    }
  }, [analysisResults, historicalOASIS, complianceReport, ai.loading, autoAnalyze, analyzeCompliance]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'moderate': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  const getRiskTypeIcon = (type) => {
    switch (type) {
      case 'pattern_based': return '📊';
      case 'historical_recurrence': return '🔁';
      case 'soft_compliance': return '⚠️';
      case 'documentation_gap': return '📝';
      case 'clinical_logic': return '🧠';
      case 'coverage_risk': return '💰';
      default: return '🔍';
    }
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-red-300 shadow-lg">
      <CardHeader className="bg-gradient-to-r from-red-50 to-gold-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-red-600" />
            Advanced AI Compliance Analysis
          </CardTitle>
          <Button
            onClick={analyzeCompliance}
            disabled={ai.loading}
            className="bg-red-600 hover:bg-red-700"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Analyzing...</>
            ) : (
              <><Shield className="w-4 h-4 mr-2" /> {complianceReport ? 'Refresh Analysis' : 'Generate Report'}</>
            )}
          </Button>
        </div>
      </CardHeader>

      {complianceReport && !complianceReport.error && (
        <CardContent className="pt-6 space-y-6">
          {/* Executive Summary */}
          <Card className={`border-2 ${
            complianceReport.executive_summary?.overall_risk_level === 'critical' ? 'border-red-500 bg-red-50' :
            complianceReport.executive_summary?.overall_risk_level === 'high' ? 'border-orange-500 bg-orange-50' :
            complianceReport.executive_summary?.overall_risk_level === 'moderate' ? 'border-yellow-500 bg-yellow-50' :
            'border-green-500 bg-green-50'
          }`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Executive Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 gap-4 mb-4">
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Risk Level</p>
                  <Badge className={getSeverityColor(complianceReport.executive_summary?.overall_risk_level)} size="lg">
                    {complianceReport.executive_summary?.overall_risk_level?.toUpperCase()}
                  </Badge>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Risk Score</p>
                  <p className="text-2xl font-bold text-red-600">{complianceReport.executive_summary?.risk_score}/100</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Risks Found</p>
                  <p className="text-2xl font-bold text-orange-600">{complianceReport.executive_summary?.total_risks_identified}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-slate-600 mb-1">Violations</p>
                  <p className="text-2xl font-bold text-red-700">{complianceReport.executive_summary?.regulatory_violations}</p>
                </div>
              </div>
              
              {complianceReport.executive_summary?.key_findings?.length > 0 && (
                <div className="bg-white p-3 rounded border">
                  <p className="text-sm font-semibold text-slate-900 mb-2">Key Findings:</p>
                  <ul className="space-y-1">
                    {complianceReport.executive_summary.key_findings.map((finding, idx) => (
                      <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                        <span className="text-red-600">•</span>
                        {finding}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Proactive Risk Identification */}
          {complianceReport.proactive_risk_identification?.length > 0 && (
            <Card className="border-2 border-orange-300">
              <CardHeader className="bg-gradient-to-r from-orange-50 to-yellow-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  Proactive Risk Identification ({complianceReport.proactive_risk_identification.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  {complianceReport.proactive_risk_identification.map((risk, idx) => (
                    <Card key={idx} className={`border-l-4 ${
                      risk.severity === 'critical' ? 'border-l-red-600 bg-red-50' :
                      risk.severity === 'high' ? 'border-l-orange-500 bg-orange-50' :
                      risk.severity === 'moderate' ? 'border-l-yellow-500 bg-yellow-50' :
                      'border-l-blue-500 bg-blue-50'
                    }`}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl">{getRiskTypeIcon(risk.risk_type)}</span>
                            <div>
                              <p className="font-semibold text-slate-900">{risk.title}</p>
                              <p className="text-xs text-slate-500">Type: {risk.risk_type?.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <Badge className={getSeverityColor(risk.severity)}>{risk.severity}</Badge>
                            <p className="text-xs text-slate-600 mt-1">Audit Trigger: {risk.audit_trigger_likelihood}</p>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="bg-white p-2 rounded border">
                            <p className="text-xs text-slate-500 mb-1">Description:</p>
                            <p className="text-sm text-slate-800">{risk.description}</p>
                          </div>

                          <div className="bg-amber-50 p-2 rounded border border-amber-200">
                            <p className="text-xs text-amber-700 font-medium mb-1">Pattern Detected:</p>
                            <p className="text-sm text-amber-900">{risk.data_pattern_detected}</p>
                          </div>

                          <div className="bg-red-50 p-2 rounded border border-red-200">
                            <p className="text-xs text-red-700 font-medium mb-1">Why This Matters:</p>
                            <p className="text-sm text-red-900">{risk.why_this_matters}</p>
                          </div>

                          {risk.historical_context && (
                            <div className="bg-navy-50 p-2 rounded border border-navy-200">
                              <p className="text-xs text-navy-700 font-medium mb-1">Historical Context:</p>
                              <p className="text-sm text-navy-900">{risk.historical_context}</p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Regulatory Compliance Report */}
          {complianceReport.regulatory_compliance_report?.length > 0 && (
            <Card className="border-2 border-red-400">
              <CardHeader className="bg-gradient-to-r from-red-50 to-red-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-red-600" />
                  Regulatory Compliance Report ({complianceReport.regulatory_compliance_report.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <Accordion type="single" collapsible className="space-y-3">
                  {complianceReport.regulatory_compliance_report.map((violation, idx) => (
                    <AccordionItem key={idx} value={`violation-${idx}`} className="border rounded-lg">
                      <AccordionTrigger className="px-4 hover:no-underline">
                        <div className="flex items-center justify-between w-full pr-4">
                          <div className="flex items-center gap-3">
                            <Badge className={getSeverityColor(violation.severity)}>{violation.severity}</Badge>
                            <span className="font-semibold text-slate-900">{violation.violation_type}</span>
                          </div>
                          {violation.affected_items?.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              {violation.affected_items.length} items affected
                            </Badge>
                          )}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="px-4 pb-4">
                        {/* Affected Items */}
                        {violation.affected_items?.length > 0 && (
                          <div className="mb-3">
                            <p className="text-xs text-slate-600 mb-1">Affected M-Items:</p>
                            <div className="flex flex-wrap gap-1">
                              {violation.affected_items.map((item, iIdx) => (
                                <Badge key={iIdx} variant="outline" className="font-mono text-xs">{item}</Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Regulatory Citations */}
                        {violation.regulatory_citations?.length > 0 && (
                          <div className="space-y-3 mb-4">
                            <p className="text-sm font-semibold text-slate-900">Regulatory Citations:</p>
                            {violation.regulatory_citations.map((citation, cIdx) => (
                              <Card key={cIdx} className="bg-blue-50 border-blue-200">
                                <CardContent className="p-3">
                                  <div className="flex items-start gap-2 mb-2">
                                    <BookOpen className="w-4 h-4 text-blue-600 mt-0.5" />
                                    <div className="flex-1">
                                      <p className="text-sm font-semibold text-blue-900">{citation.citation}</p>
                                      <p className="text-xs text-blue-700 mt-1 italic">{citation.regulation_text}</p>
                                    </div>
                                  </div>
                                  <div className="bg-white p-2 rounded border border-blue-200 mt-2">
                                    <p className="text-xs text-slate-600 mb-1">Compliance Requirement:</p>
                                    <p className="text-sm text-slate-900">{citation.compliance_requirement}</p>
                                  </div>
                                  <div className="bg-red-50 p-2 rounded border border-red-200 mt-2">
                                    <p className="text-xs text-red-600 mb-1">How It's Violated:</p>
                                    <p className="text-sm text-red-900">{citation.how_violated}</p>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>
                        )}

                        {/* Potential Consequences */}
                        {violation.potential_consequences?.length > 0 && (
                          <Alert className="bg-orange-50 border-orange-300 mb-3">
                            <AlertTriangle className="w-4 h-4 text-orange-600" />
                            <AlertDescription>
                              <p className="text-sm font-semibold text-orange-900 mb-2">Potential Consequences:</p>
                              <ul className="space-y-1">
                                {violation.potential_consequences.map((consequence, cIdx) => (
                                  <li key={cIdx} className="text-sm text-orange-800">• {consequence}</li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}

                        {violation.audit_appeal_risk && (
                          <div className="bg-navy-50 p-3 rounded border border-navy-200">
                            <p className="text-xs text-navy-700 font-medium mb-1">Audit/Appeal Risk:</p>
                            <p className="text-sm text-navy-900">{violation.audit_appeal_risk}</p>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </CardContent>
            </Card>
          )}

          {/* Context-Aware Remediation */}
          {complianceReport.context_aware_remediation?.length > 0 && (
            <Card className="border-2 border-green-300">
              <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  Patient-Specific Remediation Plan ({complianceReport.context_aware_remediation.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-4">
                  {complianceReport.context_aware_remediation
                    .sort((a, b) => b.priority_level - a.priority_level)
                    .map((remediation, idx) => (
                    <Card key={idx} className="border-l-4 border-l-green-600">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <p className="font-semibold text-slate-900 mb-1">{remediation.issue_being_addressed}</p>
                            <p className="text-xs text-slate-600">Priority: {remediation.priority_level}/10</p>
                          </div>
                        </div>

                        {/* Patient-Specific Context */}
                        <div className="bg-blue-50 p-3 rounded border border-blue-200 mb-3">
                          <p className="text-xs text-blue-700 font-medium mb-1">Patient Context:</p>
                          <p className="text-sm text-blue-900">{remediation.patient_specific_context}</p>
                        </div>

                        {/* Clinical Rationale */}
                        <div className="bg-navy-50 p-3 rounded border border-navy-200 mb-3">
                          <p className="text-xs text-navy-700 font-medium mb-1">Clinical Rationale:</p>
                          <p className="text-sm text-navy-900">{remediation.clinical_rationale}</p>
                        </div>

                        {/* Immediate Actions */}
                        {remediation.immediate_actions?.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-semibold text-slate-900 mb-2">Immediate Actions:</p>
                            <div className="space-y-2">
                              {remediation.immediate_actions.map((action, aIdx) => (
                                <div key={aIdx} className="bg-white p-3 rounded border">
                                  <div className="flex items-start justify-between mb-2">
                                    <p className="text-sm font-medium text-slate-900">Step {aIdx + 1}: {action.action_step}</p>
                                    {action.time_estimate && (
                                      <Badge variant="outline" className="text-xs">{action.time_estimate}</Badge>
                                    )}
                                  </div>
                                  
                                  {action.exact_documentation_needed && (
                                    <div className="bg-green-50 p-2 rounded border border-green-200 mb-2">
                                      <p className="text-xs text-green-700 font-medium mb-1">📝 Exact Documentation Needed:</p>
                                      <p className="text-sm text-green-900 italic">"{action.exact_documentation_needed}"</p>
                                    </div>
                                  )}

                                  {action.m_items_to_review?.length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-2">
                                      <p className="text-xs text-slate-600 w-full mb-1">Review M-Items:</p>
                                      {action.m_items_to_review.map((item, mIdx) => (
                                        <Badge key={mIdx} variant="outline" className="font-mono text-xs">{item}</Badge>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Sample Compliant Narrative */}
                        {remediation.sample_compliant_narrative && (
                          <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-3 rounded border-2 border-green-300 mb-3">
                            <p className="text-xs text-green-700 font-medium mb-2">✅ Sample Compliant Narrative:</p>
                            <p className="text-sm text-slate-900 italic leading-relaxed">"{remediation.sample_compliant_narrative}"</p>
                          </div>
                        )}

                        {/* Preventive Measures */}
                        {remediation.preventive_measures?.length > 0 && (
                          <div className="bg-indigo-50 p-3 rounded border border-indigo-200">
                            <p className="text-xs text-indigo-700 font-medium mb-2">🛡️ Preventive Measures for Future:</p>
                            <ul className="space-y-1">
                              {remediation.preventive_measures.map((measure, mIdx) => (
                                <li key={mIdx} className="text-sm text-indigo-900">• {measure}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Trend Analysis */}
          {complianceReport.trend_analysis && (
            <Card className="border-2 border-navy-300">
              <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
                <CardTitle className="text-lg flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-navy-600" />
                  Compliance Trend Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {complianceReport.trend_analysis.improvement_areas?.length > 0 && (
                    <div className="bg-green-50 p-3 rounded border border-green-200">
                      <p className="text-sm font-semibold text-green-900 mb-2 flex items-center gap-1">
                        <CheckCircle2 className="w-4 h-4" />
                        Improvement Areas
                      </p>
                      <ul className="space-y-1">
                        {complianceReport.trend_analysis.improvement_areas.map((area, idx) => (
                          <li key={idx} className="text-sm text-green-800">✓ {area}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {complianceReport.trend_analysis.deterioration_areas?.length > 0 && (
                    <div className="bg-red-50 p-3 rounded border border-red-200">
                      <p className="text-sm font-semibold text-red-900 mb-2 flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4" />
                        Deterioration Areas
                      </p>
                      <ul className="space-y-1">
                        {complianceReport.trend_analysis.deterioration_areas.map((area, idx) => (
                          <li key={idx} className="text-sm text-red-800">⚠ {area}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {complianceReport.trend_analysis.predicted_future_risks?.length > 0 && (
                  <div className="bg-orange-50 p-3 rounded border border-orange-200 mt-4">
                    <p className="text-sm font-semibold text-orange-900 mb-2">🔮 Predicted Future Risks:</p>
                    <ul className="space-y-1">
                      {complianceReport.trend_analysis.predicted_future_risks.map((risk, idx) => (
                        <li key={idx} className="text-sm text-orange-800">• {risk}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Action Plan */}
          {complianceReport.action_plan && (
            <Card className="border-2 border-indigo-300 bg-gradient-to-r from-indigo-50 to-blue-50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="w-5 h-5 text-indigo-600" />
                  Compliance Action Plan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {complianceReport.action_plan.immediate_priorities?.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-red-900 mb-2">🚨 Immediate Priorities:</p>
                      <ol className="space-y-1">
                        {complianceReport.action_plan.immediate_priorities.map((priority, idx) => (
                          <li key={idx} className="text-sm text-slate-800 flex items-start gap-2">
                            <span className="bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                              {idx + 1}
                            </span>
                            {priority}
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {complianceReport.action_plan.short_term_goals?.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-orange-900 mb-2">📅 Short-Term Goals (1-2 weeks):</p>
                      <ul className="space-y-1">
                        {complianceReport.action_plan.short_term_goals.map((goal, idx) => (
                          <li key={idx} className="text-sm text-slate-800">• {goal}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {complianceReport.action_plan.long_term_improvements?.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold text-blue-900 mb-2">🎯 Long-Term Improvements:</p>
                      <ul className="space-y-1">
                        {complianceReport.action_plan.long_term_improvements.map((improvement, idx) => (
                          <li key={idx} className="text-sm text-slate-800">• {improvement}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {complianceReport.action_plan.estimated_compliance_improvement && (
                    <div className="bg-green-100 p-3 rounded border-2 border-green-400 mt-4">
                      <p className="text-sm font-semibold text-green-900">
                        📈 Estimated Compliance Improvement: {complianceReport.action_plan.estimated_compliance_improvement}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </CardContent>
      )}

      {complianceReport?.error && (
        <CardContent>
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800">{complianceReport.error}</AlertDescription>
          </Alert>
        </CardContent>
      )}

      {!complianceReport && !ai.loading && (
        <CardContent className="py-8 text-center">
          <Shield className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600 mb-4">Click "Generate Report" to perform advanced compliance analysis</p>
          <p className="text-xs text-slate-500">
            Analyzes {historicalOASIS.length} historical assessments and {historicalAudits.length} past audits
          </p>
        </CardContent>
      )}
    </Card>
  );
}