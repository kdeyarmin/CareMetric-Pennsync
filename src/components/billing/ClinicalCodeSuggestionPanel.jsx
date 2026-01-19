import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { 
  Loader2, 
  FileText, 
  CheckCircle2, 
  AlertTriangle,
  DollarSign,
  Code,
  Clipboard,
  Send
} from 'lucide-react';
import { toast } from 'sonner';

export default function ClinicalCodeSuggestionPanel({ 
  clinicalData,
  evidenceReport,
  patientId,
  visitId,
  encounterType,
  visitDuration,
  onCodesConfirmed
}) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState(null);
  const [selectedICD10, setSelectedICD10] = useState([]);
  const [selectedCPT, setSelectedCPT] = useState([]);

  const generateSuggestions = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestClinicalCodes', {
        clinical_data: clinicalData,
        evidence_report: evidenceReport,
        patient_id: patientId,
        visit_id: visitId,
        encounter_type: encounterType,
        visit_duration_minutes: visitDuration
      });

      if (response.data?.success) {
        setSuggestions(response.data.suggestions);
        // Auto-select all codes initially
        setSelectedICD10(response.data.suggestions.icd10_codes?.map(c => c.code) || []);
        setSelectedCPT(response.data.suggestions.cpt_codes?.map(c => c.code) || []);
        toast.success('Code suggestions generated');
      } else if (response.data?.error) {
        toast.error(response.data.error);
        if (response.data.reason) {
          toast.error(response.data.reason);
        }
      }
    } catch (error) {
      console.error('Error generating suggestions:', error);
      toast.error('Error generating code suggestions');
    } finally {
      setLoading(false);
    }
  };

  const toggleICD10 = (code) => {
    setSelectedICD10(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const toggleCPT = (code) => {
    setSelectedCPT(prev =>
      prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]
    );
  };

  const confirmCodes = async () => {
    const confirmedICD10 = suggestions.icd10_codes.filter(c => selectedICD10.includes(c.code));
    const confirmedCPT = suggestions.cpt_codes.filter(c => selectedCPT.includes(c.code));

    onCodesConfirmed?.({
      icd10_codes: confirmedICD10,
      cpt_codes: confirmedCPT,
      em_code: suggestions.em_code_recommendation,
      medical_necessity: suggestions.medical_necessity_statement
    });

    toast.success('Codes confirmed and ready for billing');
  };

  const copyAllCodes = () => {
    const text = `
ICD-10 Codes:
${suggestions.icd10_codes?.map(c => `${c.code} - ${c.description}`).join('\n')}

CPT Codes:
${suggestions.cpt_codes?.map(c => `${c.code} - ${c.description}`).join('\n')}

E&M Code: ${suggestions.em_code_recommendation?.code} - ${suggestions.em_code_recommendation?.level}
    `.trim();
    
    navigator.clipboard.writeText(text);
    toast.success('All codes copied to clipboard');
  };

  const getConfidenceColor = (score) => {
    if (score >= 0.9) return 'text-green-600 dark:text-green-400';
    if (score >= 0.7) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-orange-600 dark:text-orange-400';
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      default: return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="w-5 h-5" />
            AI Clinical Code Suggestions
          </CardTitle>
          <CardDescription>
            ICD-10 and CPT code recommendations based on clinical reasoning and documentation
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={generateSuggestions} 
            disabled={loading}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Clinical Data...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Generate Code Suggestions
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {suggestions && (
        <div className="space-y-4">
          {/* Compliance Alerts */}
          {suggestions.compliance_alerts?.length > 0 && (
            <Alert variant={suggestions.compliance_alerts.some(a => a.severity === 'critical') ? 'destructive' : 'default'}>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-2">Compliance Alerts:</p>
                {suggestions.compliance_alerts.map((alert, idx) => (
                  <div key={idx} className="mb-2">
                    <Badge className={getSeverityColor(alert.severity)}>{alert.severity}</Badge>
                    <p className="text-sm mt-1"><strong>{alert.alert_type}:</strong> {alert.message}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{alert.recommendation}</p>
                  </div>
                ))}
              </AlertDescription>
            </Alert>
          )}

          {/* E&M Code Recommendation */}
          {suggestions.em_code_recommendation && (
            <Card className="border-green-200 dark:border-green-800">
              <CardHeader className="bg-green-50 dark:bg-green-950">
                <CardTitle className="text-lg">Evaluation & Management Code</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <code className="text-2xl font-bold">{suggestions.em_code_recommendation.code}</code>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                      {suggestions.em_code_recommendation.level}
                    </p>
                  </div>
                  <Badge variant={suggestions.em_code_recommendation.time_documented ? 'default' : 'destructive'}>
                    {suggestions.em_code_recommendation.time_documented ? 'Time Documented' : 'Missing Time'}
                  </Badge>
                </div>
                {suggestions.em_code_recommendation.complexity_factors?.length > 0 && (
                  <div className="mb-2">
                    <p className="text-sm font-semibold mb-1">Complexity Factors:</p>
                    <ul className="text-sm space-y-0.5">
                      {suggestions.em_code_recommendation.complexity_factors.map((factor, i) => (
                        <li key={i}>• {factor}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-sm">
                  <strong>MDM Level:</strong> {suggestions.em_code_recommendation.mdm_level}
                </p>
              </CardContent>
            </Card>
          )}

          {/* ICD-10 Codes */}
          {suggestions.icd10_codes?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  ICD-10-CM Diagnosis Codes
                  <Badge>{selectedICD10.length} selected</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {suggestions.icd10_codes.map((icd, idx) => (
                  <div key={idx} className="border rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`icd-${icd.code}`}
                        checked={selectedICD10.includes(icd.code)}
                        onCheckedChange={() => toggleICD10(icd.code)}
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <code className="text-lg font-bold">{icd.code}</code>
                            <Badge className="ml-2" variant={icd.type === 'primary' ? 'default' : 'secondary'}>
                              {icd.type}
                            </Badge>
                          </div>
                          <span className={`text-sm font-semibold ${getConfidenceColor(icd.confidence_score)}`}>
                            {Math.round(icd.confidence_score * 100)}% confident
                          </span>
                        </div>
                        <p className="text-sm font-medium mb-2">{icd.description}</p>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                          <strong>Clinical Rationale:</strong> {icd.clinical_rationale}
                        </p>
                        {icd.documentation_requirements?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-1">Documentation Requirements:</p>
                            <ul className="text-xs space-y-0.5">
                              {icd.documentation_requirements.map((req, i) => (
                                <li key={i}>• {req}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* CPT Codes */}
          {suggestions.cpt_codes?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center justify-between">
                  CPT Procedure Codes
                  <Badge>{selectedCPT.length} selected</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {suggestions.cpt_codes.map((cpt, idx) => (
                  <div key={idx} className="border rounded-lg p-3">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={`cpt-${cpt.code}`}
                        checked={selectedCPT.includes(cpt.code)}
                        onCheckedChange={() => toggleCPT(cpt.code)}
                      />
                      <div className="flex-1">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <code className="text-lg font-bold">{cpt.code}</code>
                            {cpt.modifiers?.map((mod, i) => (
                              <Badge key={i} variant="outline" className="ml-1">{mod}</Badge>
                            ))}
                          </div>
                          <div className="text-right">
                            <span className={`text-sm font-semibold ${getConfidenceColor(cpt.confidence_score)}`}>
                              {Math.round(cpt.confidence_score * 100)}%
                            </span>
                            <Badge className="ml-2" variant={
                              cpt.expected_reimbursement_tier === 'high' ? 'default' : 
                              cpt.expected_reimbursement_tier === 'medium' ? 'secondary' : 'outline'
                            }>
                              {cpt.expected_reimbursement_tier} reimbursement
                            </Badge>
                          </div>
                        </div>
                        <p className="text-sm font-medium mb-2">{cpt.description}</p>
                        <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                          {cpt.category} {cpt.units > 1 && `• ${cpt.units} units`}
                        </p>
                        {cpt.medical_necessity_link && (
                          <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">
                            <strong>Medical Necessity:</strong> {cpt.medical_necessity_link}
                          </p>
                        )}
                        {cpt.required_documentation?.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold mb-1">Required Documentation:</p>
                            <ul className="text-xs space-y-0.5">
                              {cpt.required_documentation.map((doc, i) => (
                                <li key={i}>• {doc}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Medical Necessity Statement */}
          {suggestions.medical_necessity_statement && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Medical Necessity Statement</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{suggestions.medical_necessity_statement}</p>
              </CardContent>
            </Card>
          )}

          {/* Documentation Gaps */}
          {suggestions.documentation_gaps?.length > 0 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <p className="font-semibold mb-1">Documentation Gaps to Address:</p>
                <ul className="text-sm space-y-1">
                  {suggestions.documentation_gaps.map((gap, idx) => (
                    <li key={idx}>• {gap}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Coding Tips */}
          {suggestions.coding_tips?.length > 0 && (
            <Card className="bg-blue-50 dark:bg-blue-950">
              <CardHeader>
                <CardTitle className="text-sm">Coding Tips</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="text-sm space-y-1">
                  {suggestions.coding_tips.map((tip, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                      <span>{tip}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button onClick={copyAllCodes} variant="outline" className="flex-1">
              <Clipboard className="w-4 h-4 mr-2" />
              Copy All Codes
            </Button>
            <Button 
              onClick={confirmCodes} 
              disabled={selectedICD10.length === 0 && selectedCPT.length === 0}
              className="flex-1"
            >
              <Send className="w-4 h-4 mr-2" />
              Confirm & Send to Billing
            </Button>
          </div>

          {/* Summary */}
          <Card className="bg-gray-50 dark:bg-gray-900">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4" />
                  <span className="font-semibold">Estimated RVUs:</span>
                  <span>{suggestions.estimated_total_rvus?.toFixed(2) || 'N/A'}</span>
                </div>
                <div>
                  <span className="font-semibold">{selectedICD10.length}</span> ICD-10 + 
                  <span className="font-semibold ml-1">{selectedCPT.length}</span> CPT codes selected
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}