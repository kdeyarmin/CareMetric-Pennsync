import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { isSafeExternalUrl } from "@/components/utils/security";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Brain,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  DollarSign,
  Lightbulb,
  ArrowRight,
  Loader2,
  Shield
} from "lucide-react";
import { motion } from "framer-motion";

export default function AIDataValidationEngine({
  oasisData,
  patientData,
  clinicalNotes,
  patientHistory,
  autoValidate = false,
  onCorrection
}) {
  const ai = useAICall();
  const [validationResults, setValidationResults] = useState(null);
  const [appliedCorrections, setAppliedCorrections] = useState(new Set());

  const performValidation = useCallback(async () => {
    if (!oasisData || !patientData) return;

    try {
      const prompt = `You are an expert OASIS validator and Medicare compliance specialist. Analyze OASIS data for accuracy, consistency, and reimbursement optimization.

OASIS DATA:
${JSON.stringify(oasisData.extracted_data || {}, null, 2)}

PATIENT CLINICAL DATA:
- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patientData.current_medications?.slice(0, 10).map(m => m.name).join(', ') || 'Not documented'}
- Functional Status: ${JSON.stringify(patientData.functional_status || {})}
- Admission Source: ${oasisData.pdgm_data?.admission_source || 'Unknown'}

${clinicalNotes ? `CLINICAL NOTES:
${clinicalNotes.substring(0, 1500)}` : ''}

${patientHistory ? `HISTORICAL DATA:
- Previous OASIS Scores: ${JSON.stringify(patientHistory.previousScores || {})}
- Recent Hospitalizations: ${patientHistory.hospitalizations?.length || 0}
- Functional Decline: ${patientHistory.functionalDecline ? 'Yes' : 'No'}` : ''}

ANALYZE FOR:
1. **Data Inconsistencies**: Compare OASIS fields with clinical notes and patient data
2. **Reimbursement Impact**: Identify fields that could increase/decrease payment
3. **Quality Score Impact**: Flag items affecting OASIS quality measures
4. **Clinical Logic Errors**: Detect contradictory or illogical data
5. **Missing Critical Data**: Identify high-value missing fields
6. **Compliance Risks**: Highlight audit red flags

For each issue found, provide:
- The specific OASIS M-item code
- Current value vs. suggested value
- Clinical justification from notes/data
- Reimbursement impact ($$ estimate if applicable)
- Quality measure impact
- Compliance risk level
- Detailed explanation of why this matters
- CMS regulation/guideline reference with link
- Plain-language explanation of the rule
- Specific do's and don'ts examples`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_accuracy_score: { type: "number" },
            overall_risk_level: { 
              type: "string",
              enum: ["low", "medium", "high", "critical"]
            },
            data_inconsistencies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item_code: { type: "string" },
                  m_item_name: { type: "string" },
                  current_value: { type: "string" },
                  suggested_value: { type: "string" },
                  confidence: { type: "number" },
                  clinical_evidence: { type: "string" },
                  inconsistency_type: {
                    type: "string",
                    enum: ["contradicts_notes", "contradicts_diagnosis", "contradicts_medications", "illogical", "missing"]
                  },
                  severity: {
                    type: "string",
                    enum: ["critical", "high", "medium", "low"]
                  },
                  cms_regulation: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } },
                  compliant_example: { type: "string" },
                  non_compliant_example: { type: "string" }
                }
              }
            },
            reimbursement_optimizations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item_code: { type: "string" },
                  m_item_name: { type: "string" },
                  current_value: { type: "string" },
                  suggested_value: { type: "string" },
                  financial_impact: { type: "string" },
                  estimated_dollar_impact: { type: "number" },
                  justification: { type: "string" },
                  supporting_documentation: { type: "string" },
                  risk_of_audit_flag: { type: "string" }
                }
              }
            },
            quality_measure_impacts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  quality_measure: { type: "string" },
                  affected_m_items: { type: "array", items: { type: "string" } },
                  current_score_impact: { type: "string" },
                  improvement_opportunity: { type: "string" },
                  clinical_rationale: { type: "string" }
                }
              }
            },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk_category: { type: "string" },
                  description: { type: "string" },
                  affected_items: { type: "array", items: { type: "string" } },
                  mitigation_steps: { type: "array", items: { type: "string" } },
                  audit_likelihood: {
                    type: "string",
                    enum: ["low", "medium", "high"]
                  },
                  cms_regulation: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } }
                }
              }
            },
            critical_explanations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  m_item_code: { type: "string" },
                  why_it_matters: { type: "string" },
                  cms_requirement: { type: "string" },
                  cms_reference_link: { type: "string" },
                  plain_language_explanation: { type: "string" },
                  common_mistakes: { type: "array", items: { type: "string" } },
                  best_practice: { type: "string" },
                  documentation_dos: { type: "array", items: { type: "string" } },
                  documentation_donts: { type: "array", items: { type: "string" } },
                  compliant_example: { type: "string" },
                  non_compliant_example: { type: "string" }
                }
              }
            }
          }
        }
      });

      setValidationResults(result);
    } catch (error) {
      console.error('Validation error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [oasisData, patientData, clinicalNotes, patientHistory]);

  useEffect(() => {
    if (autoValidate && oasisData && patientData) {
      performValidation();
    }
  }, [autoValidate, oasisData?.id, oasisData, patientData, performValidation]);

  const applyCorrection = (correction, key) => {
    if (onCorrection) {
      onCorrection({
        m_item_code: correction.m_item_code,
        current_value: correction.current_value,
        suggested_value: correction.suggested_value,
        justification: correction.clinical_evidence || correction.justification
      });
    }
    // Key on a stable per-row id so issues that share a missing/duplicate
    // m_item_code don't ALL flip to "Applied" when one of them is applied.
    setAppliedCorrections(prev => new Set([...prev, key ?? correction.m_item_code]));
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'high': return 'border-orange-500 bg-orange-50';
      case 'medium': return 'border-yellow-500 bg-yellow-50';
      case 'low': return 'border-blue-500 bg-blue-50';
      default: return 'border-slate-300 bg-slate-50';
    }
  };

  const getRiskBadge = (risk) => {
    const colors = {
      critical: 'bg-red-600 text-white',
      high: 'bg-orange-600 text-white',
      medium: 'bg-yellow-600 text-white',
      low: 'bg-blue-600 text-white'
    };
    return colors[risk] || 'bg-slate-600 text-white';
  };

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-indigo-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            AI Data Validation Engine
            {ai.loading && <Loader2 className="w-4 h-4 animate-spin text-navy-500" />}
          </CardTitle>
          {!validationResults && !ai.loading && (
            <Button onClick={performValidation} className="bg-navy-600 hover:bg-navy-700">
              <Brain className="w-4 h-4 mr-2" />
              Validate Data
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading && (
          <div className="text-center py-8">
            <Loader2 className="w-12 h-12 animate-spin text-navy-600 mx-auto mb-4" />
            <p className="text-sm text-navy-700">Analyzing OASIS data for accuracy and optimization...</p>
          </div>
        )}

        {!ai.loading && !validationResults && (
          <div className="text-center py-8">
            <Shield className="w-12 h-12 text-navy-400 mx-auto mb-4" />
            <p className="text-sm text-slate-600">Click "Validate Data" to check for inconsistencies and optimization opportunities</p>
          </div>
        )}

        {validationResults && (
          <div className="space-y-6">
            {/* Overall Summary */}
            <Alert className={getSeverityColor(validationResults.overall_risk_level)}>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                <div className="flex items-center justify-between">
                  <div>
                    <strong>Accuracy Score:</strong> {validationResults.overall_accuracy_score}%
                  </div>
                  <Badge className={getRiskBadge(validationResults.overall_risk_level)}>
                    {validationResults.overall_risk_level} risk
                  </Badge>
                </div>
              </AlertDescription>
            </Alert>

            {/* Data Inconsistencies */}
            {validationResults.data_inconsistencies?.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                  Data Inconsistencies ({validationResults.data_inconsistencies.length})
                </h3>
                <ScrollArea className="max-h-[400px]">
                  <div className="space-y-3">
                    {validationResults.data_inconsistencies.map((issue, idx) => (
                      <motion.div
                        key={idx}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className={`border-2 rounded-lg p-4 ${getSeverityColor(issue.severity)}`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="font-mono text-xs">
                                {issue.m_item_code}
                              </Badge>
                              <h4 className="font-semibold">{issue.m_item_name}</h4>
                              <Badge className={getRiskBadge(issue.severity)}>
                                {issue.severity}
                              </Badge>
                            </div>
                            <Badge variant="outline" className="text-xs">
                              {issue.inconsistency_type?.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                        </div>

                        <div className="space-y-2 mb-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-slate-600">Current:</span>
                            <span className="font-medium line-through text-red-600">{issue.current_value}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-slate-600">Suggested:</span>
                            <span className="font-medium text-green-600">{issue.suggested_value}</span>
                            <Badge variant="outline" className="text-xs">
                              {issue.confidence}% confidence
                            </Badge>
                          </div>
                        </div>

                        <div className="bg-white/80 rounded p-2 mb-3 text-sm">
                          <p className="font-medium text-xs text-slate-600 mb-1">Clinical Evidence:</p>
                          <p className="text-slate-700">{issue.clinical_evidence}</p>
                        </div>

                        {issue.cms_regulation && (
                          <div className="bg-indigo-50 p-3 rounded mb-3 border border-indigo-200">
                            <p className="font-semibold text-xs text-indigo-900 mb-1 flex items-center gap-2">
                              <Shield className="w-3 h-3" />
                              CMS Regulation
                            </p>
                            <p className="text-xs text-indigo-800 mb-2">{issue.cms_regulation}</p>
                            {issue.cms_reference_link && (
                              <a 
                                href={isSafeExternalUrl(issue.cms_reference_link) ? issue.cms_reference_link : undefined}
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-xs text-indigo-600 underline hover:text-indigo-800"
                              >
                                View Official Guideline →
                              </a>
                            )}
                          </div>
                        )}

                        {issue.plain_language_explanation && (
                          <div className="bg-blue-50 p-3 rounded mb-3 border border-blue-200">
                            <p className="font-semibold text-xs text-blue-900 mb-1">
                              📘 What This Means
                            </p>
                            <p className="text-xs text-blue-800">{issue.plain_language_explanation}</p>
                          </div>
                        )}

                        {(issue.documentation_dos?.length > 0 || issue.documentation_donts?.length > 0) && (
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
                        )}

                        {issue.compliant_example && (
                          <div className="bg-green-50 p-2 rounded mb-2 text-xs border border-green-200">
                            <p className="font-semibold text-green-900 mb-1">✓ Compliant Example:</p>
                            <p className="text-green-800 italic">"{issue.compliant_example}"</p>
                          </div>
                        )}

                        {issue.non_compliant_example && (
                          <div className="bg-red-50 p-2 rounded mb-3 text-xs border border-red-200">
                            <p className="font-semibold text-red-900 mb-1">✗ Non-Compliant Example:</p>
                            <p className="text-red-800 italic">"{issue.non_compliant_example}"</p>
                          </div>
                        )}

                        {!appliedCorrections.has(`inc-${issue.m_item_code || idx}`) && (
                          <Button
                            size="sm"
                            onClick={() => applyCorrection(issue, `inc-${issue.m_item_code || idx}`)}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Apply Correction
                          </Button>
                        )}
                        {appliedCorrections.has(`inc-${issue.m_item_code || idx}`) && (
                          <Badge className="bg-green-600 text-white">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Applied
                          </Badge>
                        )}
                      </motion.div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Reimbursement Optimizations */}
            {validationResults.reimbursement_optimizations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <DollarSign className="w-5 h-5 text-green-600" />
                  Reimbursement Optimizations ({validationResults.reimbursement_optimizations.length})
                </h3>
                <div className="space-y-3">
                  {validationResults.reimbursement_optimizations.map((opt, idx) => (
                    <div key={idx} className="border-2 border-green-300 rounded-lg p-4 bg-green-50">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="outline" className="font-mono text-xs">
                              {opt.m_item_code}
                            </Badge>
                            <h4 className="font-semibold">{opt.m_item_name}</h4>
                          </div>
                          <Badge className="bg-green-600 text-white">
                            <DollarSign className="w-3 h-3 mr-1" />
                            {opt.financial_impact}
                            {opt.estimated_dollar_impact && ` (~$${opt.estimated_dollar_impact})`}
                          </Badge>
                        </div>
                      </div>

                      <div className="space-y-2 mb-3">
                        <div className="text-sm">
                          <span className="text-slate-600">Current: </span>
                          <span className="font-medium">{opt.current_value}</span>
                          <ArrowRight className="w-4 h-4 inline mx-2 text-slate-400" />
                          <span className="font-medium text-green-600">{opt.suggested_value}</span>
                        </div>
                      </div>

                      <div className="bg-white rounded p-2 mb-2 text-sm">
                        <p className="font-medium text-xs text-slate-600 mb-1">Justification:</p>
                        <p className="text-slate-700">{opt.justification}</p>
                      </div>

                      <div className="bg-blue-50 rounded p-2 mb-2 text-sm">
                        <p className="font-medium text-xs text-blue-800 mb-1">Supporting Documentation:</p>
                        <p className="text-blue-900 text-xs">{opt.supporting_documentation}</p>
                      </div>

                      {opt.risk_of_audit_flag !== 'low' && (
                        <Alert className="mt-2">
                          <AlertTriangle className="w-4 h-4" />
                          <AlertDescription className="text-xs">
                            <strong>Audit Risk:</strong> {opt.risk_of_audit_flag} - Ensure documentation clearly supports this value
                          </AlertDescription>
                        </Alert>
                      )}

                      {!appliedCorrections.has(`opt-${opt.m_item_code || idx}`) && (
                        <Button
                          size="sm"
                          onClick={() => applyCorrection(opt, `opt-${opt.m_item_code || idx}`)}
                          className="bg-green-600 hover:bg-green-700 text-white mt-2"
                        >
                          Apply Optimization
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quality Measure Impacts */}
            {validationResults.quality_measure_impacts?.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-blue-600" />
                  Quality Measure Impacts
                </h3>
                <div className="space-y-2">
                  {validationResults.quality_measure_impacts.map((qm, idx) => (
                    <div key={idx} className="border-2 border-blue-300 rounded-lg p-3 bg-blue-50">
                      <h4 className="font-semibold mb-2">{qm.quality_measure}</h4>
                      <div className="text-sm space-y-1 mb-2">
                        <p><strong>Affected Items:</strong> {qm.affected_m_items.join(', ')}</p>
                        <p><strong>Current Impact:</strong> {qm.current_score_impact}</p>
                        <p className="text-green-700"><strong>Improvement:</strong> {qm.improvement_opportunity}</p>
                      </div>
                      <div className="bg-white rounded p-2 text-xs">
                        {qm.clinical_rationale}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance Risks */}
            {validationResults.compliance_risks?.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-orange-600" />
                  Compliance Risks
                </h3>
                <div className="space-y-2">
                  {validationResults.compliance_risks.map((risk, idx) => (
                    <div key={idx} className="border-2 border-orange-300 rounded-lg p-3 bg-orange-50">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">{risk.risk_category}</h4>
                        <Badge className={risk.audit_likelihood === 'high' ? 'bg-red-600' : risk.audit_likelihood === 'medium' ? 'bg-orange-600' : 'bg-yellow-600'}>
                          {risk.audit_likelihood} audit risk
                        </Badge>
                      </div>
                      <p className="text-sm mb-2">{risk.description}</p>

                      {risk.cms_regulation && (
                        <div className="bg-indigo-50 p-2 rounded mb-2 border border-indigo-200">
                          <p className="font-semibold text-xs text-indigo-900 mb-1 flex items-center gap-2">
                            <Shield className="w-3 h-3" />
                            CMS Regulation
                          </p>
                          <p className="text-xs text-indigo-800 mb-1">{risk.cms_regulation}</p>
                          {risk.cms_reference_link && (
                            <a 
                              href={isSafeExternalUrl(risk.cms_reference_link) ? risk.cms_reference_link : undefined}
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="text-xs text-indigo-600 underline hover:text-indigo-800"
                            >
                              View Official CMS Guideline →
                            </a>
                          )}
                        </div>
                      )}

                      {risk.plain_language_explanation && (
                        <div className="bg-blue-50 p-2 rounded mb-2 border border-blue-200">
                          <p className="font-semibold text-xs text-blue-900 mb-1">📘 Plain English</p>
                          <p className="text-xs text-blue-800">{risk.plain_language_explanation}</p>
                        </div>
                      )}

                      {(risk.documentation_dos?.length > 0 || risk.documentation_donts?.length > 0) && (
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {risk.documentation_dos?.length > 0 && (
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="font-semibold text-xs text-green-900 mb-1">✓ DO:</p>
                              <ul className="text-xs text-green-800 space-y-1">
                                {risk.documentation_dos.map((item, didx) => (
                                  <li key={didx}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {risk.documentation_donts?.length > 0 && (
                            <div className="bg-red-50 p-2 rounded border border-red-200">
                              <p className="font-semibold text-xs text-red-900 mb-1">✗ DON'T:</p>
                              <ul className="text-xs text-red-800 space-y-1">
                                {risk.documentation_donts.map((item, didx) => (
                                  <li key={didx}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      <div className="bg-white rounded p-2">
                        <p className="font-medium text-xs mb-1">Mitigation Steps:</p>
                        <ul className="list-disc list-inside text-xs space-y-1">
                          {risk.mitigation_steps.map((step, sidx) => (
                            <li key={sidx}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Critical Explanations */}
            {validationResults.critical_explanations?.length > 0 && (
              <div>
                <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-yellow-600" />
                  Why These Fields Matter
                </h3>
                <div className="space-y-2">
                  {validationResults.critical_explanations.map((exp, idx) => (
                    <div key={idx} className="border-2 border-yellow-300 rounded-lg p-3 bg-yellow-50">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline" className="font-mono">{exp.m_item_code}</Badge>
                        <h4 className="font-semibold">Why It Matters</h4>
                      </div>
                      <p className="text-sm mb-2">{exp.why_it_matters}</p>

                      <div className="bg-indigo-50 rounded p-2 mb-2 border border-indigo-200">
                        <p className="font-medium text-xs text-indigo-900 mb-1 flex items-center gap-2">
                          <Shield className="w-3 h-3" />
                          CMS Requirement
                        </p>
                        <p className="text-xs text-indigo-800 mb-1">{exp.cms_requirement}</p>
                        {exp.cms_reference_link && (
                          <a 
                            href={isSafeExternalUrl(exp.cms_reference_link) ? exp.cms_reference_link : undefined} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-xs text-indigo-600 underline hover:text-indigo-800"
                          >
                            View Official CMS Guideline →
                          </a>
                        )}
                      </div>

                      {exp.plain_language_explanation && (
                        <div className="bg-blue-50 rounded p-2 mb-2 border border-blue-200">
                          <p className="font-medium text-xs text-blue-900 mb-1">📘 Plain English Explanation</p>
                          <p className="text-xs text-blue-800">{exp.plain_language_explanation}</p>
                        </div>
                      )}

                      {(exp.documentation_dos?.length > 0 || exp.documentation_donts?.length > 0) && (
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          {exp.documentation_dos?.length > 0 && (
                            <div className="bg-green-50 p-2 rounded border border-green-200">
                              <p className="font-semibold text-xs text-green-900 mb-1">✓ DO:</p>
                              <ul className="text-xs text-green-800 space-y-1">
                                {exp.documentation_dos.map((item, didx) => (
                                  <li key={didx}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {exp.documentation_donts?.length > 0 && (
                            <div className="bg-red-50 p-2 rounded border border-red-200">
                              <p className="font-semibold text-xs text-red-900 mb-1">✗ DON'T:</p>
                              <ul className="text-xs text-red-800 space-y-1">
                                {exp.documentation_donts.map((item, didx) => (
                                  <li key={didx}>• {item}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {exp.compliant_example && (
                        <div className="bg-green-50 p-2 rounded mb-2 text-xs border border-green-200">
                          <p className="font-semibold text-green-900 mb-1">✓ Compliant Example:</p>
                          <p className="text-green-800 italic">"{exp.compliant_example}"</p>
                        </div>
                      )}

                      {exp.non_compliant_example && (
                        <div className="bg-red-50 p-2 rounded mb-2 text-xs border border-red-200">
                          <p className="font-semibold text-red-900 mb-1">✗ Non-Compliant Example:</p>
                          <p className="text-red-800 italic">"{exp.non_compliant_example}"</p>
                        </div>
                      )}

                      {exp.common_mistakes?.length > 0 && (
                        <div className="bg-red-50 border border-red-200 rounded p-2 mb-2 text-xs">
                          <p className="font-medium text-red-800 mb-1">Common Mistakes:</p>
                          <ul className="list-disc list-inside space-y-1 text-red-700">
                            {exp.common_mistakes.map((mistake, midx) => (
                              <li key={midx}>{mistake}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="bg-green-50 border border-green-200 rounded p-2 text-xs">
                        <p className="font-medium text-green-800 mb-1">Best Practice:</p>
                        <p className="text-green-700">{exp.best_practice}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button onClick={performValidation} variant="outline" className="w-full">
              Re-run Validation
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}