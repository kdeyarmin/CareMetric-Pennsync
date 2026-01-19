import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, FileText, DollarSign, AlertCircle, CheckCircle, Copy } from 'lucide-react';
import { toast } from 'sonner';

export default function AIBillingCodeAnalyzer({ patientId, visitType, initialNote }) {
  const [clinicalNote, setClinicalNote] = useState(initialNote || '');
  const [analyzing, setAnalyzing] = useState(false);
  const [results, setResults] = useState(null);

  const analyzeBillingCodes = async () => {
    if (!clinicalNote.trim()) {
      toast.error('Please enter a clinical note');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('suggestBillingCodesFromNote', {
        clinical_note: clinicalNote,
        patient_id: patientId,
        visit_type: visitType
      });

      if (response.data?.success) {
        setResults(response.data.billing_suggestions);
        toast.success('Billing code analysis complete');
      } else {
        toast.error('Failed to analyze billing codes');
      }
    } catch (error) {
      console.error('Error analyzing billing codes:', error);
      toast.error('Error analyzing billing codes');
    } finally {
      setAnalyzing(false);
    }
  };

  const copyCode = (code) => {
    navigator.clipboard.writeText(code);
    toast.success('Code copied to clipboard');
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            AI Billing Code Analyzer
          </CardTitle>
          <CardDescription>
            Get intelligent billing code suggestions based on clinical documentation
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Clinical Note</label>
            <Textarea
              value={clinicalNote}
              onChange={(e) => setClinicalNote(e.target.value)}
              placeholder="Paste or enter the clinical note to analyze for billing codes..."
              className="min-h-32"
            />
          </div>

          <Button 
            onClick={analyzeBillingCodes} 
            disabled={analyzing || !clinicalNote.trim()}
            className="w-full"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Documentation...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Analyze Billing Codes
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <div className="space-y-4">
          {/* ICD-10 Codes */}
          {results.icd10_codes?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">ICD-10 Diagnosis Codes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.icd10_codes.map((code, idx) => (
                  <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant={code.type === 'primary' ? 'default' : 'secondary'}>
                            {code.type}
                          </Badge>
                          <code className="text-sm font-mono font-bold">{code.code}</code>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => copyCode(code.code)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="font-medium text-sm">{code.description}</p>
                      </div>
                    </div>
                    <div className="text-sm space-y-1">
                      <p><span className="font-semibold">Supporting Documentation:</span> {code.supporting_documentation}</p>
                      <p><span className="font-semibold">Medical Necessity:</span> {code.medical_necessity}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* CPT Codes */}
          {results.cpt_codes?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">CPT Procedure Codes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.cpt_codes.map((code, idx) => (
                  <div key={idx} className="border-l-4 border-green-500 pl-4 py-2 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-mono font-bold">{code.code}</code>
                          {code.units && <Badge variant="outline">{code.units} unit(s)</Badge>}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => copyCode(code.code)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="font-medium text-sm">{code.description}</p>
                      </div>
                    </div>
                    <div className="text-sm">
                      <p><span className="font-semibold">Supporting Documentation:</span> {code.supporting_documentation}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* HCPCS Codes */}
          {results.hcpcs_codes?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">HCPCS Codes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {results.hcpcs_codes.map((code, idx) => (
                  <div key={idx} className="border-l-4 border-purple-500 pl-4 py-2 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm font-mono font-bold">{code.code}</code>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => copyCode(code.code)}
                          >
                            <Copy className="w-3 h-3" />
                          </Button>
                        </div>
                        <p className="font-medium text-sm">{code.description}</p>
                      </div>
                    </div>
                    <div className="text-sm">
                      <p><span className="font-semibold">Supporting Documentation:</span> {code.supporting_documentation}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Recommendations & Compliance */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recommendations & Compliance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {results.documentation_recommendations?.length > 0 && (
                <div>
                  <h4 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Documentation Recommendations
                  </h4>
                  <ul className="space-y-1">
                    {results.documentation_recommendations.map((rec, idx) => (
                      <li key={idx} className="text-sm flex items-start gap-2">
                        <CheckCircle className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                        <span>{rec}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {results.compliance_notes && (
                <Alert>
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-semibold">Compliance Notes:</span> {results.compliance_notes}
                  </AlertDescription>
                </Alert>
              )}

              {results.estimated_reimbursement_impact && (
                <div className="bg-blue-50 dark:bg-blue-950 p-3 rounded-lg">
                  <p className="text-sm">
                    <span className="font-semibold">Reimbursement Impact:</span> {results.estimated_reimbursement_impact}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}