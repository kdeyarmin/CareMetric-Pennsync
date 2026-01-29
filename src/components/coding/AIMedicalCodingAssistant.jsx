import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Code, Copy, CheckCircle2, AlertCircle, Info, Plus, Shield, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import AISuggestionFeedback from "../feedback/AISuggestionFeedback";

export default function AIMedicalCodingAssistant({ 
  clinicalNote, 
  patientData, 
  visitType,
  onCodesSelected 
}) {
  const [analyzing, setAnalyzing] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [selectedCodes, setSelectedCodes] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);

  React.useEffect(() => {
    base44.auth.me().then(setCurrentUser).catch(() => {});
  }, []);

  const analyzeCodes = async () => {
    setAnalyzing(true);
    try {
      const { suggestMedicalCodes } = await import('@/functions/suggestMedicalCodes');
      const response = await suggestMedicalCodes({
        clinical_note: clinicalNote,
        diagnosis: patientData?.primary_diagnosis || 'Not specified',
        visit_type: visitType || 'Not specified',
        patient_context: {
          age: patientData?.date_of_birth ? Math.floor((Date.now() - new Date(patientData.date_of_birth)) / 31557600000) : null,
          primary_diagnosis: patientData?.primary_diagnosis,
          secondary_diagnoses: patientData?.secondary_diagnoses
        }
      });

      setSuggestions(response);
      toast.success("Coding suggestions generated");
    } catch (error) {
      toast.error("Failed to analyze codes");
      console.error(error);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleCodeSelection = (code, type) => {
    const codeId = `${type}-${code.code}`;
    setSelectedCodes(prev => {
      const isSelected = prev.some(c => `${c.type}-${c.code}` === codeId);
      if (isSelected) {
        return prev.filter(c => `${c.type}-${c.code}` !== codeId);
      } else {
        return [...prev, { ...code, type }];
      }
    });
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success("Code copied to clipboard");
  };

  const validateCodes = async () => {
    if (!suggestions) return;
    
    setValidating(true);
    try {
      const { validateMedicalCodes } = await import('@/functions/validateMedicalCodes');
      const result = await validateMedicalCodes({
        icd10_codes: [
          ...(suggestions.icd10_codes || []),
          ...(suggestions.primary_icd10_codes || []),
          ...(suggestions.secondary_icd10_codes || [])
        ],
        cpt_codes: suggestions.cpt_codes || [],
        hcpcs_codes: suggestions.hcpcs_codes || [],
        modifiers: suggestions.recommended_modifiers?.map(m => m.modifier) || [],
        patient_context: patientData,
        clinical_note: clinicalNote
      });
      
      setValidation(result.validation);
      
      if (result.validation.validation_status === 'failed') {
        toast.error('Validation found critical issues');
      } else if (result.validation.validation_status === 'passed_with_warnings') {
        toast.warning('Validation passed with warnings');
      } else {
        toast.success('All codes validated successfully');
      }
    } catch (error) {
      toast.error('Failed to validate codes');
      console.error(error);
    } finally {
      setValidating(false);
    }
  };

  const applySelectedCodes = () => {
    if (onCodesSelected) {
      onCodesSelected(selectedCodes);
      toast.success(`${selectedCodes.length} codes added`);
    }
  };

  const isCodeSelected = (code, type) => {
    const codeId = `${type}-${code.code}`;
    return selectedCodes.some(c => `${c.type}-${c.code}` === codeId);
  };

  const getConfidenceColor = (confidence) => {
    switch (confidence?.toLowerCase()) {
      case 'high': return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      case 'low': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200';
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Code className="w-5 h-5 text-blue-600" />
            AI Medical Coding Assistant
          </CardTitle>
          {!suggestions && (
            <Button
              onClick={analyzeCodes}
              disabled={analyzing || !clinicalNote}
              size="sm"
              className="bg-blue-600 hover:bg-blue-700"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                'Analyze & Suggest Codes'
              )}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!suggestions && !analyzing && (
          <div className="text-center py-6 text-gray-500">
            <Code className="w-12 h-12 mx-auto mb-3 text-gray-300" />
            <p className="text-sm">
              Click "Analyze & Suggest Codes" to get AI-powered ICD-10 and CPT code recommendations
            </p>
          </div>
        )}

        {suggestions && (
          <>
            {/* Summary */}
            {suggestions.coding_summary && (
              <div className="p-3 bg-blue-50 dark:bg-blue-950 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">
                      Coding Summary
                    </p>
                    <p className="text-xs text-blue-800 dark:text-blue-200">
                      {suggestions.coding_summary}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ICD-10 Codes */}
            {suggestions.icd10_codes && suggestions.icd10_codes.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 flex items-center justify-center text-xs font-bold">
                    Dx
                  </span>
                  ICD-10 Diagnosis Codes
                </h4>
                <div className="space-y-2">
                  {suggestions.icd10_codes.map((code, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        isCodeSelected(code, 'icd10')
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950'
                          : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                      }`}
                      onClick={() => toggleCodeSelection(code, 'icd10')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono font-bold text-purple-700 dark:text-purple-300">
                              {code.code}
                            </code>
                            <Badge className={`${getConfidenceColor(code.confidence)} text-xs`}>
                              {code.confidence} confidence
                            </Badge>
                            {isCodeSelected(code, 'icd10') && (
                              <CheckCircle2 className="w-4 h-4 text-blue-600" />
                            )}
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mb-1">
                            {code.description}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                            {code.rationale}
                          </p>
                          {code.documentation_notes && (
                            <div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950 p-2 rounded">
                              <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <span>{code.documentation_notes}</span>
                            </div>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCode(code.code);
                          }}
                          className="flex-shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CPT Codes */}
            {suggestions.cpt_codes && suggestions.cpt_codes.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <span className="w-6 h-6 rounded bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 flex items-center justify-center text-xs font-bold">
                    Px
                  </span>
                  CPT Procedure Codes
                </h4>
                <div className="space-y-2">
                  {suggestions.cpt_codes.map((code, idx) => (
                    <div
                      key={idx}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        isCodeSelected(code, 'cpt')
                          ? 'border-green-500 bg-green-50 dark:bg-green-950'
                          : 'border-gray-200 dark:border-gray-700 hover:border-green-300'
                      }`}
                      onClick={() => toggleCodeSelection(code, 'cpt')}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm font-mono font-bold text-green-700 dark:text-green-300">
                              {code.code}
                            </code>
                            <Badge className={`${getConfidenceColor(code.confidence)} text-xs`}>
                              {code.confidence} confidence
                            </Badge>
                            {isCodeSelected(code, 'cpt') && (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            )}
                          </div>
                          <p className="text-sm text-gray-900 dark:text-gray-100 font-medium mb-1">
                            {code.description}
                          </p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                            {code.rationale}
                          </p>
                          {code.modifiers && (
                            <div className="flex items-start gap-1 text-xs text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950 p-2 rounded">
                              <Info className="w-3 h-3 mt-0.5 flex-shrink-0" />
                              <span><strong>Modifiers:</strong> {code.modifiers}</span>
                            </div>
                          )}
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCode(code.code);
                          }}
                          className="flex-shrink-0"
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Billing Considerations */}
            {suggestions.billing_considerations && (
              <div className="p-3 bg-amber-50 dark:bg-amber-950 rounded-lg border border-amber-200 dark:border-amber-800">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-100 mb-1">
                      Billing Considerations
                    </p>
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      {suggestions.billing_considerations}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Feedback Section */}
            <div className="pt-3 border-t">
              <AISuggestionFeedback
                suggestionType="medical_coding"
                suggestionContent={JSON.stringify(suggestions)}
                userAction={selectedCodes.length > 0 ? 'accepted' : 'ignored'}
                contextData={{
                  patient_id: patientData?.id,
                  visit_type: visitType,
                  codes_selected: selectedCodes.length,
                  total_suggestions: (suggestions.icd10_codes?.length || 0) + (suggestions.cpt_codes?.length || 0)
                }}
                compact={true}
              />
            </div>

            {/* Validation Section */}
            {validation && (
              <div className="space-y-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-blue-600" />
                    Code Validation Results
                  </h4>
                  <Badge className={
                    validation.validation_status === 'passed' ? 'bg-green-100 text-green-800' :
                    validation.validation_status === 'passed_with_warnings' ? 'bg-yellow-100 text-yellow-800' :
                    'bg-red-100 text-red-800'
                  }>
                    {validation.validation_status.replace(/_/g, ' ')}
                  </Badge>
                </div>

                {/* Summary */}
                {validation.summary && (
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div className="p-2 bg-white dark:bg-gray-800 rounded">
                      <div className="text-gray-500">Total Issues</div>
                      <div className="font-bold text-lg">{validation.summary.total_issues}</div>
                    </div>
                    <div className="p-2 bg-white dark:bg-gray-800 rounded">
                      <div className="text-gray-500">Critical</div>
                      <div className="font-bold text-lg text-red-600">{validation.summary.critical_issues || 0}</div>
                    </div>
                    <div className="p-2 bg-white dark:bg-gray-800 rounded">
                      <div className="text-gray-500">Denial Risk</div>
                      <div className="font-bold text-xs">{validation.summary.estimated_denial_risk?.replace(/_/g, ' ')}</div>
                    </div>
                  </div>
                )}

                {/* Priority Issues - Sorted by severity */}
                {(() => {
                  const allIssues = [
                    ...(validation.ncci_violations || []).map(v => ({ ...v, category: 'NCCI', color: 'red' })),
                    ...(validation.modifier_issues || []).map(m => ({ ...m, category: 'Modifier', color: 'orange' })),
                    ...(validation.diagnosis_procedure_mismatches || []).map(d => ({ ...d, category: 'Dx-Px', color: 'purple' })),
                    ...(validation.compliance_warnings || []).map(c => ({ ...c, category: 'Compliance', color: 'yellow' }))
                  ].sort((a, b) => {
                    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
                    return severityOrder[a.severity] - severityOrder[b.severity];
                  });

                  return allIssues.length > 0 && (
                    <div className="space-y-3">
                      <h5 className="text-sm font-semibold flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        Issues by Priority
                      </h5>
                      {allIssues.slice(0, 5).map((issue, idx) => (
                        <div key={idx} className={`p-3 bg-${issue.color}-50 dark:bg-${issue.color}-950 border-l-4 border-${issue.color}-500 rounded`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <Badge className={`${
                                issue.severity === 'critical' ? 'bg-red-600 text-white' :
                                issue.severity === 'high' ? 'bg-orange-600 text-white' :
                                issue.severity === 'medium' ? 'bg-yellow-600 text-white' :
                                'bg-gray-500 text-white'
                              } text-xs`}>
                                {issue.severity.toUpperCase()}
                              </Badge>
                              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{issue.category}</span>
                            </div>
                            {issue.financial_impact && (
                              <span className="text-xs font-bold text-red-700 dark:text-red-300">{issue.financial_impact}</span>
                            )}
                          </div>

                          <div className="space-y-2 text-xs">
                            <div>
                              <strong className="text-gray-900 dark:text-gray-100">
                                {issue.code_pair || issue.code || issue.procedure_code || 'Issue'}
                              </strong>
                            </div>

                            <div className="text-gray-700 dark:text-gray-300">
                              <strong>Problem:</strong> {issue.explanation || issue.warning}
                            </div>

                            {issue.why_this_matters && (
                              <div className="text-gray-700 dark:text-gray-300 bg-yellow-100 dark:bg-yellow-900 p-2 rounded">
                                <strong>Why This Matters:</strong> {issue.why_this_matters}
                              </div>
                            )}

                            <div className="text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 p-2 rounded">
                              <strong>Fix:</strong> {issue.recommendation}
                            </div>

                            {issue.correct_example || issue.correct_usage_example || issue.correct_diagnosis_example ? (
                              <div className="text-green-800 dark:text-green-200 bg-green-50 dark:bg-green-950 p-2 rounded border border-green-200 dark:border-green-800">
                                <strong>✓ Correct Usage:</strong> {issue.correct_example || issue.correct_usage_example || issue.correct_diagnosis_example}
                              </div>
                            ) : null}

                            {issue.documentation_needed || issue.documentation_requirement ? (
                              <div className="text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-950 p-2 rounded">
                                <strong>Documentation Needed:</strong> {issue.documentation_needed || issue.documentation_requirement}
                              </div>
                            ) : null}

                            {issue.documentation_example && (
                              <div className="text-gray-700 dark:text-gray-300 italic pl-2 border-l-2 border-blue-300">
                                Example: "{issue.documentation_example}"
                              </div>
                            )}

                            {(issue.reference_link || issue.lcd_ncd_reference || issue.payer_policy_link) && (
                              <div className="text-xs text-blue-600 dark:text-blue-400">
                                <strong>Reference:</strong>{' '}
                                <a 
                                  href={issue.payer_policy_link || '#'} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="underline hover:text-blue-800"
                                >
                                  {issue.reference_link || issue.lcd_ncd_reference || 'View Guidelines'}
                                </a>
                              </div>
                            )}

                            {issue.compliance_steps && issue.compliance_steps.length > 0 && (
                              <div className="text-gray-700 dark:text-gray-300 pl-3">
                                <strong>Steps:</strong>
                                <ol className="list-decimal list-inside mt-1 space-y-0.5">
                                  {issue.compliance_steps.map((step, i) => (
                                    <li key={i}>{step}</li>
                                  ))}
                                </ol>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                      {allIssues.length > 5 && (
                        <p className="text-xs text-gray-500 text-center">
                          + {allIssues.length - 5} more issues (showing top 5 by severity)
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2 border-t">
              {!validation && suggestions && (
                <Button
                  onClick={validateCodes}
                  disabled={validating}
                  variant="outline"
                  className="border-blue-500 text-blue-600 hover:bg-blue-50"
                >
                  {validating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Validating...
                    </>
                  ) : (
                    <>
                      <Shield className="w-4 h-4 mr-2" />
                      Validate Codes
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={applySelectedCodes}
                disabled={selectedCodes.length === 0}
                className="flex-1 bg-blue-600 hover:bg-blue-700"
              >
                <Plus className="w-4 h-4 mr-2" />
                Apply Selected Codes ({selectedCodes.length})
              </Button>
              <Button
                onClick={analyzeCodes}
                variant="outline"
                size="sm"
              >
                Re-analyze
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}