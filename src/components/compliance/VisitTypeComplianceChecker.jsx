import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  BookOpen,
  Loader2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink
} from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function VisitTypeComplianceChecker({ 
  visitType, 
  noteContent,
  oasisData,
  patientData,
  vitalSigns,
  careType = "home_health",
  autoCheck = true,
  onIssuesDetected
}) {
  const ai = useAICall();
  const [complianceResults, setComplianceResults] = useState(null);
  const [isExpanded, setIsExpanded] = useState(true);

  const performComplianceCheck = useCallback(async () => {
    if (!visitType || !noteContent) return;

    try {
      const visitTypeRequirements = {
        admission: {
          display: "Start of Care/Admission",
          cms_reference: "42 CFR 484.55(c)",
          required_elements: [
            "Complete patient assessment within 5 days of SOC",
            "Physician orders obtained and documented",
            "Patient/caregiver rights and responsibilities reviewed",
            "Emergency preparedness plan established",
            "Comprehensive care plan developed",
            "OASIS-E assessment completed",
            "Initial skilled nursing assessment",
            "Patient's understanding of plan of care documented",
            "Medication reconciliation completed",
            "Safety assessment of home environment",
            "Infection control procedures reviewed"
          ]
        },
        recertification: {
          display: "Recertification",
          cms_reference: "42 CFR 484.60",
          required_elements: [
            "Updated physician orders for continuing care",
            "Progress toward care plan goals documented",
            "Comprehensive reassessment completed",
            "OASIS-E recertification assessment",
            "Justification for continuing skilled services",
            "Patient's current functional status compared to baseline",
            "Medication review and reconciliation",
            "Evidence of ongoing skilled need",
            "Plan of care updates based on current condition",
            "Physician communication documented"
          ]
        },
        discharge: {
          display: "Discharge/Transfer",
          cms_reference: "42 CFR 484.50",
          required_elements: [
            "Reason for discharge clearly stated",
            "OASIS-E discharge assessment completed",
            "Final visit comprehensive assessment",
            "Summary of care provided and outcomes achieved",
            "Patient's discharge condition and functional status",
            "Discharge instructions provided to patient/caregiver",
            "Post-discharge plan documented",
            "Community resources/referrals provided",
            "Physician notification of discharge",
            "Equipment needs for post-discharge period",
            "Follow-up appointments scheduled/recommended"
          ]
        },
        skilled_nursing: {
          display: "Skilled Nursing Visit",
          cms_reference: "42 CFR 484.75",
          required_elements: [
            "Skilled assessment of patient's condition",
            "Comparison to previous visit findings",
            "Intervention(s) requiring nursing skill",
            "Patient response to treatment/interventions",
            "Progress toward care plan goals",
            "Patient/caregiver education provided",
            "Vital signs and clinical observations",
            "Medication management/teaching",
            "Safety and environmental assessment"
          ]
        },
        routine_visit: {
          display: "Routine Visit",
          cms_reference: "42 CFR 484.75",
          required_elements: [
            "Assessment of patient's current condition",
            "Skilled interventions performed",
            "Patient response to care",
            "Progress notes related to care plan goals",
            "Vital signs documentation",
            "Patient/caregiver teaching as appropriate",
            "Changes in condition reported"
          ]
        }
      };

      const requirements = visitTypeRequirements[visitType] || visitTypeRequirements.routine_visit;

      const prompt = `You are a Medicare compliance expert specializing in home health documentation. Perform a detailed compliance review for this ${requirements.display} visit.

CMS REGULATION: ${requirements.cms_reference}

REQUIRED ELEMENTS FOR ${requirements.display.toUpperCase()}:
${requirements.required_elements.map((el, idx) => `${idx + 1}. ${el}`).join('\n')}

VISIT TYPE: ${visitType}
CARE TYPE: ${careType === 'hospice' ? 'Hospice' : 'Home Health'}

DOCUMENTATION TO REVIEW:
${noteContent}

${oasisData ? `OASIS DATA AVAILABLE:
- Assessment Type: ${oasisData.assessment_type || 'Unknown'}
- Clinical Group: ${oasisData.pdgm_data?.clinical_group || 'Not specified'}
- Functional Level: ${oasisData.pdgm_data?.functional_level || 'Not specified'}
- Primary Diagnosis: ${oasisData.extracted_data?.primary_diagnosis || 'Not specified'}
` : 'No OASIS data available for this visit'}

${patientData ? `PATIENT CONTEXT:
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Care Type: ${patientData.care_type || 'home_health'}
- Admission Date: ${patientData.admission_date || 'Not specified'}
` : ''}

VITAL SIGNS DOCUMENTED:
${vitalSigns ? Object.entries(vitalSigns).filter(([_k,v]) => v).map(([k,v]) => `- ${k}: ${v}`).join('\n') : 'No vitals provided'}

PERFORM COMPREHENSIVE COMPLIANCE CHECK:

1. Evaluate each required element against the documentation
2. Identify what's PRESENT, PARTIAL, or MISSING
3. For missing/partial elements, provide specific CMS-compliant language to add
4. Flag critical compliance gaps that could impact reimbursement or audits
5. Reference specific CMS regulations violated

Return detailed compliance analysis in JSON format.`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance_score: { type: "number" },
            compliance_grade: { type: "string" },
            audit_risk_level: { 
              type: "string",
              enum: ["critical", "high", "moderate", "low", "minimal"]
            },
            elements_status: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  element: { type: "string" },
                  status: { 
                    type: "string",
                    enum: ["present", "partial", "missing"]
                  },
                  cms_requirement: { type: "string" },
                  found_in_note: { type: "string" },
                  gap_description: { type: "string" },
                  recommendation: { type: "string" },
                  suggested_text: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low"]
                  }
                }
              }
            },
            critical_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  gap: { type: "string" },
                  cms_citation: { type: "string" },
                  impact: { type: "string" },
                  immediate_action: { type: "string" }
                }
              }
            },
            visit_type_specific_issues: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  issue: { type: "string" },
                  regulation: { type: "string" },
                  fix: { type: "string" }
                }
              }
            },
            strengths: {
              type: "array",
              items: { type: "string" }
            },
            next_steps: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setComplianceResults({
        ...result,
        visitTypeDisplay: requirements.display,
        cmsReference: requirements.cms_reference,
        totalElements: requirements.required_elements.length
      });

      if (onIssuesDetected) {
        const issues = result.elements_status?.filter(e => e.status !== 'present') || [];
        onIssuesDetected(issues);
      }
    } catch (error) {
      console.error("Compliance check error:", error);
      setComplianceResults({ error: "Failed to perform compliance check" });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [visitType, noteContent, careType, oasisData, patientData, vitalSigns, onIssuesDetected]);

  useEffect(() => {
    if (autoCheck && visitType && noteContent?.length > 50) {
      performComplianceCheck();
    }
  }, [visitType, noteContent, autoCheck, performComplianceCheck]);

  const _getStatusIcon = (status) => {
    switch (status) {
      case 'present': return <CheckCircle2 className="w-4 h-4 text-green-600" />;
      case 'partial': return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
      case 'missing': return <XCircle className="w-4 h-4 text-red-600" />;
      default: return null;
    }
  };

  const _getStatusColor = (status) => {
    switch (status) {
      case 'present': return 'bg-green-50 border-green-200';
      case 'partial': return 'bg-yellow-50 border-yellow-200';
      case 'missing': return 'bg-red-50 border-red-200';
      default: return 'bg-slate-50 border-slate-200';
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-600 text-white';
      case 'moderate': return 'bg-yellow-600 text-white';
      case 'low': return 'bg-blue-600 text-white';
      case 'minimal': return 'bg-green-600 text-white';
      default: return 'bg-slate-600 text-white';
    }
  };

  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
  };

  if (!visitType) return null;

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="w-5 h-5 text-navy-600" />
            Visit-Type Compliance Review
            {complianceResults && (
              <Badge className={getRiskColor(complianceResults.audit_risk_level)}>
                {complianceResults.audit_risk_level} Risk
              </Badge>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            {!ai.loading && !complianceResults && (
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  performComplianceCheck();
                }}
                className="bg-navy-600 hover:bg-navy-700"
              >
                Check Compliance
              </Button>
            )}
            {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
          </div>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {ai.loading && (
            <div className="flex items-center justify-center py-6 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-navy-600" />
              <span className="text-sm text-navy-700">Running compliance check...</span>
            </div>
          )}

          {complianceResults?.error && (
            <Alert className="bg-red-50 border-red-200">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {complianceResults.error}
              </AlertDescription>
            </Alert>
          )}

          {complianceResults && !complianceResults.error && (
            <>
              {/* Overall Score Summary */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-2 border-navy-200">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-slate-600 mb-1">Compliance Score</p>
                    <p className="text-2xl font-bold text-navy-700">
                      {complianceResults.overall_compliance_score}%
                    </p>
                    <Badge variant="outline" className="mt-1 text-xs">
                      Grade {complianceResults.compliance_grade}
                    </Badge>
                  </CardContent>
                </Card>

                <Card className="border-2 border-navy-200">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-slate-600 mb-1">Visit Type</p>
                    <p className="text-sm font-bold text-slate-900">
                      {complianceResults.visitTypeDisplay}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {complianceResults.cmsReference}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-2 border-navy-200">
                  <CardContent className="p-3 text-center">
                    <p className="text-xs text-slate-600 mb-1">Elements</p>
                    <p className="text-2xl font-bold text-slate-900">
                      {complianceResults.elements_status?.filter(e => e.status === 'present').length}/{complianceResults.totalElements}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">Complete</p>
                  </CardContent>
                </Card>
              </div>

              {/* Critical Gaps Alert */}
              {complianceResults.critical_gaps?.length > 0 && (
                <Alert className="bg-red-50 border-red-300">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <AlertDescription>
                    <p className="font-semibold text-red-900 mb-2">
                      {complianceResults.critical_gaps.length} Critical Gap{complianceResults.critical_gaps.length !== 1 ? 's' : ''} Detected
                    </p>
                    <div className="space-y-2">
                      {complianceResults.critical_gaps.map((gap, idx) => (
                        <div key={idx} className="bg-white p-3 rounded border border-red-200">
                          <p className="text-sm font-semibold text-red-900">{gap.gap}</p>
                          <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                            <div>
                              <span className="text-red-600 font-medium">CMS Citation:</span>
                              <p className="text-red-800">{gap.cms_citation}</p>
                            </div>
                            <div>
                              <span className="text-red-600 font-medium">Impact:</span>
                              <p className="text-red-800">{gap.impact}</p>
                            </div>
                          </div>
                          <div className="mt-2 bg-red-100 p-2 rounded">
                            <p className="text-xs text-red-900">
                              <strong>Action Required:</strong> {gap.immediate_action}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              )}

              {/* Elements Breakdown */}
              <Accordion type="single" collapsible className="space-y-2">
                <AccordionItem value="missing" className="border-2 border-red-200 rounded-lg bg-red-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <XCircle className="w-5 h-5 text-red-600" />
                      <span className="font-semibold">Missing Elements</span>
                      <Badge className="bg-red-600 text-white ml-2">
                        {complianceResults.elements_status?.filter(e => e.status === 'missing').length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <ScrollArea className="max-h-96">
                      <div className="space-y-3">
                        {complianceResults.elements_status?.filter(e => e.status === 'missing').map((element, idx) => (
                          <Card key={idx} className="bg-white">
                            <CardContent className="p-3 space-y-2">
                              <div className="flex items-start justify-between">
                                <p className="font-semibold text-sm text-slate-900 flex-1">{element.element}</p>
                                <Badge className={getSeverityColor(element.severity)}>
                                  {element.severity}
                                </Badge>
                              </div>
                              
                              <div className="bg-red-50 p-2 rounded text-xs border border-red-200">
                                <p className="text-red-900">
                                  <strong>Gap:</strong> {element.gap_description}
                                </p>
                              </div>

                              <div className="bg-blue-50 p-2 rounded text-xs border border-blue-200">
                                <p className="text-blue-900">
                                  <strong>CMS Requirement:</strong> {element.cms_requirement}
                                </p>
                              </div>

                              {element.suggested_text && (
                                <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="font-semibold text-green-900">Suggested Documentation:</p>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 text-green-700"
                                      onClick={() => handleCopyText(element.suggested_text)}
                                    >
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </div>
                                  <p className="text-green-900 italic">{element.suggested_text}</p>
                                </div>
                              )}

                              <p className="text-xs text-slate-700">
                                <strong>Recommendation:</strong> {element.recommendation}
                              </p>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="partial" className="border-2 border-yellow-200 rounded-lg bg-yellow-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-yellow-600" />
                      <span className="font-semibold">Partially Documented</span>
                      <Badge className="bg-yellow-600 text-white ml-2">
                        {complianceResults.elements_status?.filter(e => e.status === 'partial').length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="space-y-3">
                      {complianceResults.elements_status?.filter(e => e.status === 'partial').map((element, idx) => (
                        <Card key={idx} className="bg-white">
                          <CardContent className="p-3 space-y-2">
                            <div className="flex items-start justify-between">
                              <p className="font-semibold text-sm text-slate-900">{element.element}</p>
                              <Badge className={getSeverityColor(element.severity)}>
                                {element.severity}
                              </Badge>
                            </div>

                            <div className="bg-blue-50 p-2 rounded text-xs">
                              <p className="text-blue-900">
                                <strong>Found:</strong> {element.found_in_note}
                              </p>
                            </div>

                            <div className="bg-yellow-50 p-2 rounded text-xs border border-yellow-200">
                              <p className="text-yellow-900">
                                <strong>What's Missing:</strong> {element.gap_description}
                              </p>
                            </div>

                            {element.suggested_text && (
                              <div className="bg-green-50 p-2 rounded text-xs border border-green-200">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="font-semibold text-green-900">Add This:</p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 text-green-700"
                                    onClick={() => handleCopyText(element.suggested_text)}
                                  >
                                    <Copy className="w-3 h-3" />
                                  </Button>
                                </div>
                                <p className="text-green-900 italic">{element.suggested_text}</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>

                <AccordionItem value="present" className="border-2 border-green-200 rounded-lg bg-green-50">
                  <AccordionTrigger className="px-4 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                      <span className="font-semibold">Compliant Elements</span>
                      <Badge className="bg-green-600 text-white ml-2">
                        {complianceResults.elements_status?.filter(e => e.status === 'present').length}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pt-2">
                    <div className="space-y-2">
                      {complianceResults.elements_status?.filter(e => e.status === 'present').map((element, idx) => (
                        <div key={idx} className="bg-white p-2 rounded border border-green-200 text-sm">
                          <p className="text-green-900">✓ {element.element}</p>
                        </div>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>

              {/* Visit-Type Specific Issues */}
              {complianceResults.visit_type_specific_issues?.length > 0 && (
                <Card className="border-2 border-orange-300">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-orange-600" />
                      {complianceResults.visitTypeDisplay}-Specific Compliance Issues
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {complianceResults.visit_type_specific_issues.map((issue, idx) => (
                      <div key={idx} className="bg-white p-3 rounded border">
                        <div className="flex items-start gap-2 mb-2">
                          <AlertTriangle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-semibold text-slate-900">{issue.issue}</p>
                            <p className="text-xs text-orange-700 mt-1">
                              <ExternalLink className="w-3 h-3 inline mr-1" />
                              {issue.regulation}
                            </p>
                          </div>
                        </div>
                        <div className="bg-blue-50 p-2 rounded text-xs">
                          <p className="text-blue-900">
                            <strong>Fix:</strong> {issue.fix}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Documentation Strengths */}
              {complianceResults.strengths?.length > 0 && (
                <div className="bg-green-50 p-3 rounded border border-green-200">
                  <p className="text-sm font-semibold text-green-900 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    Documentation Strengths
                  </p>
                  <ul className="space-y-1">
                    {complianceResults.strengths.map((strength, idx) => (
                      <li key={idx} className="text-xs text-green-800">
                        ✓ {strength}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next Steps */}
              {complianceResults.next_steps?.length > 0 && (
                <div className="bg-navy-100 p-3 rounded border border-navy-300">
                  <p className="text-sm font-semibold text-navy-900 mb-2">
                    Recommended Next Steps
                  </p>
                  <ol className="space-y-1">
                    {complianceResults.next_steps.map((step, idx) => (
                      <li key={idx} className="text-xs text-navy-900 flex items-start gap-2">
                        <span className="bg-navy-600 text-white rounded-full w-5 h-5 flex items-center justify-center flex-shrink-0 text-xs">
                          {idx + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Re-check Button */}
              <div className="flex justify-center pt-2 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={performComplianceCheck}
                  disabled={ai.loading}
                >
                  {ai.loading ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Re-checking...</>
                  ) : (
                    <><Shield className="w-4 h-4 mr-2" /> Re-check Compliance</>
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}