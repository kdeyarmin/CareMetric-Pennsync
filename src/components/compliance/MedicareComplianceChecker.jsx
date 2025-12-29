import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
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
  FileText,
  Sparkles,
  Copy,
  ArrowRight,
  Shield
} from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export default function MedicareComplianceChecker({
  noteContent,
  visitType,
  patientData,
  diagnosis,
  vitalSigns,
  nurseType = "RN",
  onApplyFix,
  autoCheck = true
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [complianceResults, setComplianceResults] = useState(null);
  const [appliedFixes, setAppliedFixes] = useState(new Set());

  const { data: complianceRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  useEffect(() => {
    if (autoCheck && noteContent && noteContent.length > 100 && complianceRules.length > 0) {
      analyzeCompliance();
    }
  }, [noteContent, autoCheck, complianceRules]);

  const analyzeCompliance = async () => {
    if (!noteContent || noteContent.length < 100) return;

    setIsAnalyzing(true);
    try {
      // Filter rules applicable to this visit type
      const applicableRules = complianceRules.filter(rule => 
        rule.is_active && 
        (!rule.applies_to_visit_types || rule.applies_to_visit_types.includes(visitType))
      );

      const ruleContext = applicableRules.map(rule => `
RULE: ${rule.rule_name}
CoP Reference: ${rule.cop_reference}
Required Elements: ${rule.required_elements?.join(', ')}
Validation: ${rule.validation_criteria?.join('; ')}
Examples (Compliant): ${rule.examples_compliant?.[0] || 'N/A'}
Examples (Non-compliant): ${rule.examples_non_compliant?.[0] || 'N/A'}
`).join('\n');

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a Medicare home health compliance expert with access to the latest 2025 CMS regulations. Analyze this clinical note against current 42 CFR 484 Conditions of Participation.

CLINICAL NOTE:
${noteContent}

CONTEXT:
- Visit Type: ${visitType}
- Diagnosis: ${diagnosis || 'Not specified'}
- Nurse Type: ${nurseType}
- Patient: ${patientData?.first_name} ${patientData?.last_name}

INTERNAL COMPLIANCE RULES DATABASE:
${ruleContext}

For EACH rule, determine:
1. Is it met? (fully_met, partially_met, not_met)
2. What evidence exists in the note?
3. What is missing?
4. Specific remediation with compliant phrasing example
5. CoP reference violated
6. Severity (critical, high, medium)

CRITICAL REQUIREMENTS:
- Homebound Status: Must have specific mobility limitation + why leaving home is taxing
- Skilled Need: Must explain WHY skilled nursing required (not just what was done)
- Patient Response: Must document response to treatment/teaching
- Safety Assessment: Fall risk, medication safety documented
- Functional Status: ADL/IADL abilities documented

${nurseType === 'LPN' ? 'LPN-SPECIFIC: Must state "under RN supervision" and document care per established plan. Cannot perform comprehensive assessments or change care plans.' : ''}

IMPORTANT: Also search current CMS.gov and Medicare sources for any 2025 updates or changes that may affect compliance beyond the internal rules.

Return JSON with overall_compliance_score (0-100), rule_violations array with rule_name, cop_reference, status, missing_elements, evidence_found, remediation_text, compliant_example, severity.`,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            overall_compliance_score: { type: "number" },
            rule_violations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  rule_name: { type: "string" },
                  cop_reference: { type: "string" },
                  status: { type: "string" },
                  missing_elements: { type: "array", items: { type: "string" } },
                  evidence_found: { type: "string" },
                  remediation_text: { type: "string" },
                  compliant_example: { type: "string" },
                  severity: { type: "string" }
                }
              }
            },
            critical_gaps: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } }
          }
        }
      });

      setComplianceResults(result);
    } catch (error) {
      console.error('Compliance check error:', error);
    }
    setIsAnalyzing(false);
  };

  const handleApplyFix = (violation) => {
    onApplyFix?.(violation.compliant_example, violation.rule_name, false);
    setAppliedFixes(prev => new Set([...prev, violation.rule_name]));
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 border-red-400 text-red-900';
      case 'high': return 'bg-orange-100 border-orange-400 text-orange-900';
      case 'medium': return 'bg-yellow-100 border-yellow-400 text-yellow-900';
      default: return 'bg-gray-100 border-gray-400 text-gray-900';
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
      <Card className="border-2 border-blue-200">
        <CardContent className="p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-sm text-gray-600">Analyzing against 42 CFR 484 Medicare requirements...</p>
        </CardContent>
      </Card>
    );
  }

  if (!complianceResults) {
    return (
      <Card className="border-2 border-blue-200">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Medicare Compliance Checker
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={analyzeCompliance} disabled={!noteContent || noteContent.length < 100}>
            <Sparkles className="w-4 h-4 mr-2" />
            Check Medicare Compliance
          </Button>
        </CardContent>
      </Card>
    );
  }

  const criticalViolations = complianceResults.rule_violations?.filter(v => 
    v.severity === 'critical' && v.status !== 'fully_met'
  ) || [];

  const highViolations = complianceResults.rule_violations?.filter(v => 
    v.severity === 'high' && v.status !== 'fully_met'
  ) || [];

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      <Card className={`border-2 ${
        complianceResults.overall_compliance_score >= 90 ? 'border-green-400 bg-green-50' :
        complianceResults.overall_compliance_score >= 75 ? 'border-yellow-400 bg-yellow-50' :
        'border-red-400 bg-red-50'
      }`}>
        <CardHeader className="py-4">
          <CardTitle className="text-lg flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Shield className="w-5 h-5" />
              Medicare CoP Compliance Score
            </span>
            <Badge className={`text-lg ${
              complianceResults.overall_compliance_score >= 90 ? 'bg-green-600' :
              complianceResults.overall_compliance_score >= 75 ? 'bg-yellow-600' :
              'bg-red-600'
            }`}>
              {complianceResults.overall_compliance_score}%
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Progress value={complianceResults.overall_compliance_score} className="h-3" />
          
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white p-3 rounded border">
              <p className="text-2xl font-bold text-red-600">{criticalViolations.length}</p>
              <p className="text-xs text-gray-600">Critical Issues</p>
            </div>
            <div className="bg-white p-3 rounded border">
              <p className="text-2xl font-bold text-orange-600">{highViolations.length}</p>
              <p className="text-xs text-gray-600">High Priority</p>
            </div>
          </div>

          {criticalViolations.length > 0 && (
            <Alert className="border-red-400 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-sm text-red-900">
                <strong>Critical compliance gaps detected.</strong> These must be addressed before submission.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Rule Violations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">42 CFR 484 Rule Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="space-y-2">
            {complianceResults.rule_violations?.map((violation, idx) => {
              const isApplied = appliedFixes.has(violation.rule_name);
              
              return (
                <AccordionItem 
                  key={idx} 
                  value={`violation-${idx}`}
                  className={`border-2 rounded-lg ${getSeverityColor(violation.severity)} ${isApplied ? 'opacity-60' : ''}`}
                >
                  <AccordionTrigger className="px-4 py-3 hover:no-underline">
                    <div className="flex items-center justify-between w-full pr-4">
                      <div className="flex items-center gap-3 text-left">
                        {getStatusIcon(violation.status)}
                        <div>
                          <p className="font-semibold text-sm">{violation.rule_name}</p>
                          <p className="text-xs text-gray-600">{violation.cop_reference}</p>
                        </div>
                      </div>
                      <Badge className={violation.status === 'fully_met' ? 'bg-green-600' : 'bg-red-600'}>
                        {violation.status === 'fully_met' ? 'Compliant' : 
                         violation.status === 'partially_met' ? 'Partial' : 'Non-Compliant'}
                      </Badge>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-4 pb-4 space-y-3">
                    {/* Evidence Found */}
                    {violation.evidence_found && (
                      <div className="bg-white p-3 rounded border">
                        <p className="text-xs font-semibold text-gray-700 mb-1">✓ Evidence Found:</p>
                        <p className="text-xs text-gray-600 italic">"{violation.evidence_found}"</p>
                      </div>
                    )}

                    {/* Missing Elements */}
                    {violation.missing_elements?.length > 0 && (
                      <div className="bg-red-50 p-3 rounded border border-red-200">
                        <p className="text-xs font-semibold text-red-900 mb-2">⚠ Missing Elements:</p>
                        <ul className="space-y-1">
                          {violation.missing_elements.map((element, i) => (
                            <li key={i} className="text-xs text-red-800">• {element}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Remediation */}
                    {violation.remediation_text && (
                      <div className="bg-blue-50 p-3 rounded border border-blue-200">
                        <p className="text-xs font-semibold text-blue-900 mb-1">💡 How to Fix:</p>
                        <p className="text-xs text-blue-800">{violation.remediation_text}</p>
                      </div>
                    )}

                    {/* Compliant Example */}
                    {violation.compliant_example && (
                      <div className="bg-green-50 p-3 rounded border border-green-200">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-green-900">✓ Compliant Example:</p>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              navigator.clipboard.writeText(violation.compliant_example);
                            }}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="text-xs text-green-800 italic">"{violation.compliant_example}"</p>
                      </div>
                    )}

                    {/* Action Buttons */}
                    {violation.status !== 'fully_met' && !isApplied && (
                      <div className="flex gap-2 pt-2">
                        <Button
                          size="sm"
                          className="flex-1 bg-blue-600 hover:bg-blue-700"
                          onClick={() => handleApplyFix(violation)}
                        >
                          <ArrowRight className="w-4 h-4 mr-1" />
                          Add to Note
                        </Button>
                      </div>
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
        </CardContent>
      </Card>

      {/* Recommendations */}
      {complianceResults.recommendations?.length > 0 && (
        <Card className="border-blue-200">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="w-4 h-4 text-blue-600" />
              Additional Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {complianceResults.recommendations.map((rec, idx) => (
                <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}