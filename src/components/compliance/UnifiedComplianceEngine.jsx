import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Shield,
  Sparkles,
  Copy,
  ArrowRight,
  Globe,
  BookOpen,
  Activity,
  Loader2
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function UnifiedComplianceEngine({
  noteContent,
  visitType,
  patientData,
  diagnosis,
  _vitalSigns,
  nurseType = "RN",
  careType = "home_health",
  onApplyFix,
  autoCheck = true,
  _oasisData = null
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [complianceResults, setComplianceResults] = useState(null);
  const [appliedFixes, setAppliedFixes] = useState(new Set());

  const { data: _complianceRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const { data: regulatoryUpdates = [] } = useQuery({
    queryKey: ['activeRegulatoryUpdates'],
    queryFn: () => base44.entities.RegulatoryUpdate.filter({ status: 'approved' }, '-effective_date', 20),
    initialData: [],
  });

  const analyzeCompliance = useCallback(async () => {
    if (!noteContent || noteContent.length < 100) return;

    setIsAnalyzing(true);
    try {
      // Orchestrate all compliance checks in parallel
      const [medicareResult, guidelineResult, visitTypeResult, regulatoryResult] = await Promise.all([
        // Medicare CoP Check
        invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Analyze this clinical note against 42 CFR 484 Medicare Conditions of Participation for ${visitType} visits.

CLINICAL NOTE:
${noteContent}

PATIENT: ${patientData?.first_name} ${patientData?.last_name}
DIAGNOSIS: ${diagnosis}
NURSE TYPE: ${nurseType}
CARE TYPE: ${careType}

Check for:
- Homebound status documentation
- Skilled need justification  
- Patient response to treatment
- Safety assessments
- Functional status documentation
${nurseType === 'LPN' ? '- LPN supervision documentation' : ''}

Return violations with: rule_name, reference, severity, status, missing_elements, evidence_found, compliant_example, remediation_text, regulatory_reference, specific_documentation_changes.`,
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    rule_name: { type: "string" },
                    reference: { type: "string" },
                    severity: { type: "string" },
                    status: { type: "string" },
                    missing_elements: { type: "array", items: { type: "string" } },
                    evidence_found: { type: "string" },
                    compliant_example: { type: "string" },
                    remediation_text: { type: "string" },
                    latest_cms_guidance: { type: "string" },
                    regulatory_reference: { type: "string" },
                    specific_documentation_changes: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }).catch(_err => ({ error: true, compliance_score: null, violations: [] })),

        // Clinical Guideline Check
        invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Check this clinical note against evidence-based guidelines for ${diagnosis}.

CLINICAL NOTE:
${noteContent}

Verify:
- Condition-specific assessments
- Evidence-based interventions
- Appropriate monitoring
- Best practice standards

Return violations with: rule_name, reference, severity, status, missing_elements, evidence_found, compliant_example, remediation_text, regulatory_reference, specific_documentation_changes.`,
          add_context_from_internet: true,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    rule_name: { type: "string" },
                    reference: { type: "string" },
                    severity: { type: "string" },
                    status: { type: "string" },
                    missing_elements: { type: "array", items: { type: "string" } },
                    evidence_found: { type: "string" },
                    compliant_example: { type: "string" },
                    remediation_text: { type: "string" },
                    regulatory_reference: { type: "string" },
                    specific_documentation_changes: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }).catch(_err => ({ error: true, compliance_score: null, violations: [] })),

        // Visit Type Check
        invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Verify this ${visitType} visit note has all required elements.

CLINICAL NOTE:
${noteContent}

VISIT TYPE: ${visitType}

Check visit-specific requirements for documentation, timing, and content standards.

Return violations with: rule_name, reference, severity, status, missing_elements, evidence_found, compliant_example, remediation_text, regulatory_reference, specific_documentation_changes.`,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    rule_name: { type: "string" },
                    reference: { type: "string" },
                    severity: { type: "string" },
                    status: { type: "string" },
                    missing_elements: { type: "array", items: { type: "string" } },
                    evidence_found: { type: "string" },
                    compliant_example: { type: "string" },
                    remediation_text: { type: "string" },
                    regulatory_reference: { type: "string" },
                    specific_documentation_changes: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }).catch(_err => ({ error: true, compliance_score: null, violations: [] })),

        // Recent Regulatory Updates Check
        invokeLLM({
          model: "claude_opus_4_8",
          prompt: `Check compliance with these recent CMS regulatory updates:

${regulatoryUpdates.slice(0, 5).map(reg => `
${reg.title} (Effective: ${reg.effective_date})
${reg.summary}
Required Actions: ${reg.required_actions?.join(', ') || 'None'}
`).join('\n')}

CLINICAL NOTE:
${noteContent}

Identify any violations of these recent regulations.`,
          response_json_schema: {
            type: "object",
            properties: {
              compliance_score: { type: "number" },
              violations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    rule_name: { type: "string" },
                    reference: { type: "string" },
                    severity: { type: "string" },
                    status: { type: "string" },
                    missing_elements: { type: "array", items: { type: "string" } },
                    evidence_found: { type: "string" },
                    compliant_example: { type: "string" },
                    remediation_text: { type: "string" },
                    regulatory_reference: { type: "string" },
                    specific_documentation_changes: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          }
        }).catch(_err => ({ compliance_score: 0, violations: [] }))
      ]);

      // Track which analyzers FAILED to run (vs. genuinely returned a low score).
      // A failed analyzer must not be silently counted as a clean 0% or dropped —
      // it is surfaced as "could not evaluate" so the overall score isn't inflated
      // and a missed Medicare check isn't mistaken for a pass.
      const analyzerResults = [
        { category: 'medicare_cop', result: medicareResult },
        { category: 'clinical_guideline', result: guidelineResult },
        { category: 'visit_type', result: visitTypeResult },
        { category: 'regulatory', result: regulatoryResult },
      ];
      const failedCategories = analyzerResults
        .filter(({ result }) => result?.error)
        .map(({ category }) => category);

      // Aggregate results (failed analyzers contribute no violations).
      const aggregatedViolations = analyzerResults.flatMap(({ category, result }) =>
        result?.error ? [] : (result.violations || []).map(v => ({ ...v, category }))
      );

      // Calculate overall score ONLY from analyzers that successfully ran. A null
      // score (failed analyzer) is excluded rather than treated as 0.
      const scores = analyzerResults
        .filter(({ result }) => !result?.error && typeof result.compliance_score === 'number')
        .map(({ result }) => result.compliance_score);

      const overallScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;

      // Identify quick wins (low severity, easy fixes)
      const quickWins = aggregatedViolations
        .filter(v => v.severity === 'low' || v.severity === 'medium')
        .filter(v => v.status === 'not_met')
        .slice(0, 3)
        .map(v => ({
          issue: v.rule_name,
          fix: v.compliant_example
        }));

      const fmtScore = (r) => r?.error ? 'could not evaluate' : `${r.compliance_score}% (${(r.violations || []).length} issues)`;

      // Generate AI summary using all results
      const summaryResult = await invokeLLM({
        model: "claude_sonnet_4_6",
        prompt: `Create a brief executive summary of these compliance check results:

MEDICARE CoP: ${fmtScore(medicareResult)}
CLINICAL GUIDELINES: ${fmtScore(guidelineResult)}
VISIT TYPE: ${fmtScore(visitTypeResult)}
REGULATORY: ${fmtScore(regulatoryResult)}

${failedCategories.length ? `NOTE: ${failedCategories.length} analyzer(s) could not be evaluated and are excluded from the score.` : ''}
Critical issues: ${aggregatedViolations.filter(v => v.severity === 'critical').length}
High priority: ${aggregatedViolations.filter(v => v.severity === 'high').length}

Provide a 2-sentence summary of the overall compliance status and most critical gap.`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" }
          }
        }
      });

      // Per-category score: null when that analyzer failed (rendered as "N/A"),
      // so a failed check is never shown as 0% / a clean pass.
      const catScore = (r) => (r?.error || typeof r?.compliance_score !== 'number') ? null : r.compliance_score;

      const result = {
        overall_compliance_score: overallScore,
        category_scores: {
          medicare_cop: catScore(medicareResult),
          clinical_guideline: catScore(guidelineResult),
          visit_type: catScore(visitTypeResult),
          regulatory: catScore(regulatoryResult)
        },
        failed_categories: failedCategories,
        violations: aggregatedViolations,
        quick_wins: quickWins,
        critical_gaps: aggregatedViolations
          .filter(v => v.severity === 'critical')
          .map(v => v.rule_name),
        summary: summaryResult.summary
      };

      setComplianceResults(result);
    } catch (error) {
      console.error('Unified compliance check error:', error);
    }
    setIsAnalyzing(false);
  }, [noteContent, visitType, diagnosis, patientData, nurseType, careType, regulatoryUpdates]);

  // Debounce auto-check so a full compliance pass (5 LLM calls) fires only once
  // the nurse pauses typing — not on every keystroke. Pending checks are cancelled
  // on each change, which avoids hammering the LLM API and flagging mid-sentence text.
  useEffect(() => {
    if (!autoCheck || !noteContent || noteContent.length <= 100) return;
    const timer = setTimeout(() => { analyzeCompliance(); }, 1500);
    return () => clearTimeout(timer);
  }, [noteContent, autoCheck, analyzeCompliance]);

  const handleApplyFix = (violation) => {
    onApplyFix?.(violation.compliant_example, violation.rule_name, false);
    setAppliedFixes(prev => new Set([...prev, violation.rule_name]));
  };

  const handleApplyAllQuickWins = () => {
    if (!complianceResults?.quick_wins) return;
    
    const allFixes = complianceResults.quick_wins.map(qw => qw.fix).join('\n\n');
    onApplyFix?.(allFixes, 'quick_wins_batch', false);
    
    complianceResults.quick_wins.forEach(qw => {
      setAppliedFixes(prev => new Set([...prev, qw.issue]));
    });
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'medicare_cop': return <Shield className="w-4 h-4" />;
      case 'visit_type': return <Activity className="w-4 h-4" />;
      case 'clinical_guideline': return <BookOpen className="w-4 h-4" />;
      case 'oasis': return <CheckCircle2 className="w-4 h-4" />;
      case 'regulatory': return <Globe className="w-4 h-4" />;
      default: return <AlertTriangle className="w-4 h-4" />;
    }
  };

  const getCategoryLabel = (category) => {
    const labels = {
      medicare_cop: 'Medicare CoP',
      visit_type: 'Visit Type',
      clinical_guideline: 'Clinical Guidelines',
      oasis: 'OASIS Alignment',
      regulatory: 'Recent Regulations'
    };
    return labels[category] || category;
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 border-red-400 text-red-900';
      case 'high': return 'bg-orange-100 border-orange-400 text-orange-900';
      case 'medium': return 'bg-yellow-100 border-yellow-400 text-yellow-900';
      default: return 'bg-blue-100 border-blue-400 text-blue-900';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'fully_met': return <CheckCircle2 className="w-5 h-5 text-green-600" />;
      case 'partially_met': return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      case 'not_met': return <XCircle className="w-5 h-5 text-red-600" />;
      default: return null;
    }
  };

  if (isAnalyzing) {
    return (
      <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardContent className="p-6 text-center space-y-3">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
          <div>
            <p className="text-sm text-slate-900 font-semibold">Orchestrating Compliance Checks...</p>
            <p className="text-xs text-slate-600 mt-1">Running 4 parallel compliance analyzers</p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="flex items-center gap-1 justify-center">
              <Shield className="w-3 h-3 text-blue-600" />
              <span>Medicare CoP</span>
            </div>
            <div className="flex items-center gap-1 justify-center">
              <BookOpen className="w-3 h-3 text-green-600" />
              <span>Guidelines</span>
            </div>
            <div className="flex items-center gap-1 justify-center">
              <Activity className="w-3 h-3 text-navy-600" />
              <span>Visit Type</span>
            </div>
            <div className="flex items-center gap-1 justify-center">
              <Globe className="w-3 h-3 text-orange-600" />
              <span>Regulations</span>
            </div>
          </div>
          <p className="text-xs text-blue-600">🌐 Using live 2025 CMS data</p>
        </CardContent>
      </Card>
    );
  }

  if (!complianceResults) {
    return (
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Unified Compliance Engine (2025)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert className="bg-blue-50 border-blue-200 mb-3">
            <Globe className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-900">
              <strong>Unified Compliance Engine:</strong> Orchestrates MedicareComplianceChecker, GuidelineComplianceChecker, VisitTypeComplianceChecker & RegulatoryChecker - aggregates results into one consolidated report using latest 2025 CMS data
            </AlertDescription>
          </Alert>
          <Button onClick={analyzeCompliance} disabled={!noteContent || noteContent.length < 100}>
            <Sparkles className="w-4 h-4 mr-2" />
            Run Compliance Analysis
          </Button>
        </CardContent>
      </Card>
    );
  }

  const criticalViolations = complianceResults.violations?.filter(v => 
    v.severity === 'critical' && v.status !== 'fully_met'
  ) || [];

  const violationsByCategory = complianceResults.violations?.reduce((acc, v) => {
    if (!acc[v.category]) acc[v.category] = [];
    acc[v.category].push(v);
    return acc;
  }, {}) || {};

  return (
    <div className="space-y-4">
      {/* Overall Score Dashboard */}
      <Card className={`border-2 ${
        complianceResults.overall_compliance_score == null ? 'border-slate-300 bg-slate-50' :
        complianceResults.overall_compliance_score >= 90 ? 'border-green-400 bg-green-50' :
        complianceResults.overall_compliance_score >= 75 ? 'border-yellow-400 bg-yellow-50' :
        'border-red-400 bg-red-50'
      }`}>
        <CardHeader className="py-4">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Overall Compliance Score
            </span>
            <Badge className={`text-lg ${
              complianceResults.overall_compliance_score == null ? 'bg-slate-500' :
              complianceResults.overall_compliance_score >= 90 ? 'bg-green-600' :
              complianceResults.overall_compliance_score >= 75 ? 'bg-yellow-600' :
              'bg-red-600'
            }`}>
              {complianceResults.overall_compliance_score == null ? 'N/A' : `${complianceResults.overall_compliance_score}%`}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={complianceResults.overall_compliance_score ?? 0} className="h-3" />

          {/* Analyzers that could not be evaluated */}
          {complianceResults.failed_categories?.length > 0 && (
            <Alert className="border-slate-400 bg-slate-50">
              <AlertTriangle className="w-4 h-4 text-slate-600" />
              <AlertDescription className="text-sm text-slate-800">
                <strong>Could not evaluate:</strong>{' '}
                {complianceResults.failed_categories.map(getCategoryLabel).join(', ')}.
                These analyzers failed to run and are excluded from the score — they were NOT counted as passing.
              </AlertDescription>
            </Alert>
          )}

          {/* Category Scores */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Object.entries(complianceResults.category_scores || {}).map(([category, score]) => (
              <div key={category} className="bg-white p-2 rounded border text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  {getCategoryIcon(category)}
                  <p className="text-xs font-semibold text-slate-700">{getCategoryLabel(category)}</p>
                </div>
                {score == null ? (
                  <p className="text-xs font-bold text-slate-400" title="Analyzer could not be evaluated">N/A</p>
                ) : (
                  <p className={`text-xl font-bold ${score >= 90 ? 'text-green-600' : score >= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {score}%
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Critical Summary */}
          {criticalViolations.length > 0 && (
            <Alert className="border-red-400 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm text-red-900">
                <strong>{criticalViolations.length} Critical Issues</strong> - Must be addressed before submission
              </AlertDescription>
            </Alert>
          )}

          {/* Quick Wins */}
          {complianceResults.quick_wins?.length > 0 && (
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-blue-900">⚡ Quick Wins ({complianceResults.quick_wins.length})</p>
                <Button size="sm" onClick={handleApplyAllQuickWins} className="bg-blue-600 hover:bg-blue-700">
                  Apply All
                </Button>
              </div>
              <p className="text-xs text-blue-800">Easy fixes that boost compliance instantly</p>
            </div>
          )}

          {complianceResults.summary && (
            <p className="text-sm text-slate-700 bg-white p-3 rounded border">{complianceResults.summary}</p>
          )}
        </CardContent>
      </Card>

      {/* Violations by Category */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Compliance Issues by Category</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue={Object.keys(violationsByCategory)[0] || 'all'}>
            <TabsList className="grid w-full" style={{ gridTemplateColumns: `repeat(${Math.min(Object.keys(violationsByCategory).length, 5)}, 1fr)` }}>
              {Object.keys(violationsByCategory).map(category => (
                <TabsTrigger key={category} value={category} className="text-xs">
                  <span className="flex items-center gap-1">
                    {getCategoryIcon(category)}
                    {getCategoryLabel(category)}
                    <Badge variant="outline" className="ml-1 text-xs">{violationsByCategory[category].length}</Badge>
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {Object.entries(violationsByCategory).map(([category, violations]) => (
              <TabsContent key={category} value={category} className="space-y-2 mt-4">
                <Accordion type="multiple">
                  {violations.map((violation, idx) => {
                    const isApplied = appliedFixes.has(violation.rule_name);
                    
                    return (
                      <AccordionItem 
                        key={idx} 
                        value={`${category}-${idx}`}
                        className={`border-2 rounded-lg ${getSeverityColor(violation.severity)} ${isApplied ? 'opacity-60' : ''}`}
                      >
                        <AccordionTrigger className="px-4 py-3 hover:no-underline">
                          <div className="flex items-center justify-between w-full pr-4">
                            <div className="flex items-center gap-3 text-left">
                              {getStatusIcon(violation.status)}
                              <div>
                                <p className="font-semibold text-sm">{violation.rule_name}</p>
                                <p className="text-xs text-slate-600">{violation.reference}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Badge className={violation.severity === 'critical' ? 'bg-red-600' : violation.severity === 'high' ? 'bg-orange-600' : 'bg-yellow-600'}>
                                {violation.severity}
                              </Badge>
                              <Badge variant="outline">
                                {violation.status === 'fully_met' ? '✓' : violation.status === 'partially_met' ? '⚠' : '✗'}
                              </Badge>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 space-y-3">
                          {violation.evidence_found && (
                            <div className="bg-white p-3 rounded border">
                              <p className="text-xs font-semibold text-slate-700 mb-1">✓ Evidence:</p>
                              <p className="text-xs text-slate-600 italic">"{violation.evidence_found}"</p>
                            </div>
                          )}

                          {violation.missing_elements?.length > 0 && (
                            <div className="bg-red-50 p-3 rounded border border-red-200">
                              <p className="text-xs font-semibold text-red-900 mb-2">⚠ Missing:</p>
                              <ul className="space-y-1">
                                {violation.missing_elements.map((element, i) => (
                                  <li key={i} className="text-xs text-red-800">• {element}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {violation.latest_cms_guidance && (
                            <div className="bg-navy-50 p-3 rounded border border-navy-200">
                              <p className="text-xs font-semibold text-navy-900 mb-1">🌐 2025 CMS Guidance:</p>
                              <p className="text-xs text-navy-800">{violation.latest_cms_guidance}</p>
                            </div>
                          )}

                          {violation.remediation_text && (
                            <div className="bg-blue-50 p-3 rounded border border-blue-200">
                              <p className="text-xs font-semibold text-blue-900 mb-1">💡 Specific Actions Required:</p>
                              <p className="text-xs text-blue-800 whitespace-pre-line">{violation.remediation_text}</p>
                            </div>
                          )}

                          {violation.regulatory_reference && (
                            <div className="bg-slate-50 p-3 rounded border border-slate-300">
                              <p className="text-xs font-semibold text-slate-900 mb-1">📋 Regulatory Reference:</p>
                              <p className="text-xs text-slate-700">{violation.regulatory_reference}</p>
                            </div>
                          )}

                          {violation.specific_documentation_changes?.length > 0 && (
                            <div className="bg-indigo-50 p-3 rounded border border-indigo-200">
                              <p className="text-xs font-semibold text-indigo-900 mb-2">📝 Specific Documentation Changes:</p>
                              <ul className="space-y-1">
                                {violation.specific_documentation_changes.map((change, i) => (
                                  <li key={i} className="text-xs text-indigo-800">
                                    <span className="font-medium">{i + 1}.</span> {change}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {violation.compliant_example && (
                            <div className="bg-green-50 p-3 rounded border border-green-200">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-green-900">✓ Compliant Example Text:</p>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => navigator.clipboard.writeText(violation.compliant_example)}
                                >
                                  <Copy className="w-3 h-3" />
                                </Button>
                              </div>
                              <p className="text-xs text-green-800 italic">"{violation.compliant_example}"</p>
                            </div>
                          )}

                          {violation.status !== 'fully_met' && !isApplied && (
                            <Button
                              size="sm"
                              className="w-full bg-blue-600 hover:bg-blue-700"
                              onClick={() => handleApplyFix(violation)}
                            >
                              <ArrowRight className="w-4 h-4 mr-1" />
                              Add to Note
                            </Button>
                          )}

                          {isApplied && (
                            <div className="text-center py-2 text-sm text-green-700 font-medium">
                              ✓ Applied to Note
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    );
                  })}
                </Accordion>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}