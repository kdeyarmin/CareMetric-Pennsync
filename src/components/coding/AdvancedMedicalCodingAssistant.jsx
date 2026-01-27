import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Code, AlertTriangle, CheckCircle, Copy, FileText } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function AdvancedMedicalCodingAssistant({ 
  enhancedNote, 
  extractedData, 
  diagnosis,
  visitType,
  onCodesGenerated 
}) {
  const [loading, setLoading] = useState(false);
  const [codingSuggestions, setCodingSuggestions] = useState(null);

  const analyzeCoding = async () => {
    if (!enhancedNote && !extractedData) {
      toast.error('Please enhance the note first or provide clinical data');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestMedicalCodesAdvanced', {
        clinical_note: enhancedNote,
        extracted_data: extractedData,
        diagnosis: diagnosis,
        visit_type: visitType
      });

      setCodingSuggestions(response.data);
      if (onCodesGenerated) {
        onCodesGenerated(response.data);
      }
      toast.success('Coding analysis complete');
    } catch (error) {
      console.error('Coding analysis error:', error);
      toast.error('Failed to analyze coding. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = (codes) => {
    const codeText = codes.map(c => `${c.code} - ${c.description}`).join('\n');
    navigator.clipboard.writeText(codeText);
    toast.success('Codes copied to clipboard');
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  return (
    <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950/20 dark:to-slate-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-purple-900 dark:text-purple-100">
          <Code className="w-5 h-5" />
          AI Medical Coding Assistant
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!codingSuggestions ? (
          <div className="text-center py-6">
            <FileText className="w-12 h-12 text-purple-300 mx-auto mb-3" />
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
              Analyze your clinical documentation to receive AI-powered ICD-10 and CPT code suggestions with compliance insights
            </p>
            <Button 
              onClick={analyzeCoding} 
              disabled={loading || (!enhancedNote && !extractedData)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing Documentation...
                </>
              ) : (
                <>
                  <Code className="w-4 h-4 mr-2" />
                  Generate Coding Suggestions
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* ICD-10 Codes */}
            {codingSuggestions.icd10_codes?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">ICD-10 Diagnosis Codes</h4>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => copyCodes(codingSuggestions.icd10_codes)}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <div className="space-y-2">
                  {codingSuggestions.icd10_codes.map((code, idx) => (
                    <div key={idx} className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-semibold text-purple-700 dark:text-purple-300">
                              {code.code}
                            </span>
                            {code.is_primary && (
                              <Badge className="bg-purple-100 text-purple-800 text-xs">Primary</Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">{code.description}</p>
                          {code.justification && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              <span className="font-medium">Justification:</span> {code.justification}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CPT Codes */}
            {codingSuggestions.cpt_codes?.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300">CPT Procedure Codes</h4>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={() => copyCodes(codingSuggestions.cpt_codes)}
                  >
                    <Copy className="w-3 h-3 mr-1" />
                    Copy
                  </Button>
                </div>
                <div className="space-y-2">
                  {codingSuggestions.cpt_codes.map((code, idx) => (
                    <div key={idx} className="p-3 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-semibold text-indigo-700 dark:text-indigo-300">
                              {code.code}
                            </span>
                            {code.units && (
                              <Badge variant="outline" className="text-xs">{code.units} units</Badge>
                            )}
                          </div>
                          <p className="text-sm text-slate-700 dark:text-slate-300">{code.description}</p>
                          {code.justification && (
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                              <span className="font-medium">Justification:</span> {code.justification}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance Alerts */}
            {codingSuggestions.compliance_alerts?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm text-slate-700 dark:text-slate-300 mb-2">
                  Compliance & Coding Alerts
                </h4>
                <div className="space-y-2">
                  {codingSuggestions.compliance_alerts.map((alert, idx) => (
                    <Alert key={idx} className={`${getSeverityColor(alert.severity)} border`}>
                      <AlertTriangle className="w-4 h-4" />
                      <AlertDescription>
                        <div className="font-medium text-sm mb-1">{alert.type}</div>
                        <p className="text-xs">{alert.message}</p>
                        {alert.recommendation && (
                          <p className="text-xs mt-1 font-medium">
                            Recommendation: {alert.recommendation}
                          </p>
                        )}
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </div>
            )}

            {/* Documentation Quality Score */}
            {codingSuggestions.documentation_quality && (
              <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">
                    Documentation Quality Score
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-green-700 dark:text-green-300">
                      {codingSuggestions.documentation_quality.score}%
                    </span>
                    <CheckCircle className="w-5 h-5 text-green-600" />
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {codingSuggestions.documentation_quality.summary}
                </p>
                {codingSuggestions.documentation_quality.improvement_areas?.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Areas for Improvement:
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                      {codingSuggestions.documentation_quality.improvement_areas.map((area, idx) => (
                        <li key={idx}>{area}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <Button 
              onClick={analyzeCoding} 
              variant="outline" 
              size="sm" 
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Re-analyzing...
                </>
              ) : (
                'Re-analyze Coding'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}