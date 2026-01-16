import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, Code2, Zap, CheckCircle2, AlertTriangle, FileText, Copy } from 'lucide-react';
import { toast } from 'sonner';
import HCPCSCodeSuggester from '@/components/clinical/HCPCSCodeSuggester';
import DenialRiskAnalyzer from '@/components/billing/DenialRiskAnalyzer';
import BillingFormPopulator from '@/components/billing/BillingFormPopulator';

export default function MedicalCodingAssistant({
  enhancedNote,
  diagnosis,
  visitType,
  providerType,
  patientContext,
  currentUser
}) {
  const [codes, setCodes] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});

  // Only show for physicians and NPs
  if (currentUser?.credential_type !== 'MD' && currentUser?.credential_type !== 'NP') {
    return null;
  }

  const generateCodes = async () => {
    if (!enhancedNote || !diagnosis) {
      toast.error('Enhanced note and diagnosis required');
      return;
    }

    setLoading(true);
    try {
      const response = await base44.functions.invoke('suggestMedicalCodes', {
        enhanced_note: enhancedNote,
        diagnosis,
        visit_type: visitType,
        provider_type: providerType,
        patient_context: patientContext
      });

      setCodes(response?.data || response);
      toast.success('Medical codes generated');
    } catch (error) {
      toast.error('Failed to generate codes: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    const colors = {
      critical: 'bg-red-100 text-red-800',
      high: 'bg-orange-100 text-orange-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-blue-100 text-blue-800'
    };
    return colors[severity] || 'bg-gray-100';
  };

  const getConfidenceIcon = (confidence) => {
    if (confidence === 'high') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
    if (confidence === 'medium') return <AlertTriangle className="w-4 h-4 text-yellow-600" />;
    return <AlertCircle className="w-4 h-4 text-gray-600" />;
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5" />
            <CardTitle>Medical Coding Assistant</CardTitle>
          </div>
          <Button
            onClick={generateCodes}
            disabled={loading || !enhancedNote}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            {loading ? 'Analyzing...' : 'Suggest Codes'}
          </Button>
        </div>
      </CardHeader>

      {codes && (
        <CardContent className="space-y-6">
          {/* Primary ICD-10 Codes */}
          {codes.primary_icd10_codes?.length > 0 && (
            <div className="border rounded-lg p-4 bg-blue-50">
              <h3 className="font-semibold text-blue-900 mb-3 flex items-center gap-2">
                <Code2 className="w-4 h-4" /> Primary ICD-10 Codes
              </h3>
              <div className="space-y-2">
                {codes.primary_icd10_codes.map((code, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-blue-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-mono font-bold text-lg text-blue-700">{code.code}</span>
                        <p className="text-sm text-gray-700">{code.description}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {getConfidenceIcon(code.confidence)}
                        <Badge variant="outline" className="text-xs">
                          {code.confidence}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 italic">{code.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Secondary ICD-10 Codes */}
          {codes.secondary_icd10_codes?.length > 0 && (
            <div className="border rounded-lg p-4 bg-cyan-50">
              <h3 className="font-semibold text-cyan-900 mb-3">Secondary ICD-10 Codes</h3>
              <div className="space-y-2">
                {codes.secondary_icd10_codes.map((code, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-cyan-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <span className="font-mono font-bold text-cyan-700">{code.code}</span>
                        <p className="text-sm text-gray-700">{code.description}</p>
                      </div>
                      {getConfidenceIcon(code.confidence)}
                    </div>
                    <p className="text-sm text-gray-600 italic">{code.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CPT Codes */}
          {codes.cpt_codes?.length > 0 && (
            <div className="border rounded-lg p-4 bg-green-50">
              <h3 className="font-semibold text-green-900 mb-3">CPT Codes</h3>
              <div className="space-y-2">
                {codes.cpt_codes.map((code, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-green-200">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <span className="font-mono font-bold text-lg text-green-700">{code.code}</span>
                        <p className="text-sm text-gray-700">{code.description}</p>
                        {code.visit_level && (
                          <Badge className="mt-2 mr-2">{code.visit_level}</Badge>
                        )}
                        {code.typical_rvu && (
                          <Badge variant="outline" className="text-xs">
                            RVU: {code.typical_rvu}
                          </Badge>
                        )}
                      </div>
                      {getConfidenceIcon(code.confidence)}
                    </div>
                    <p className="text-sm text-gray-600 italic">{code.rationale}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CCI & Bundling Concerns */}
          {codes.cci_bundling_concerns?.length > 0 && (
            <div className="border rounded-lg p-4 bg-red-50">
              <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                <AlertCircle className="w-4 h-4" /> CCI & Bundling Concerns
              </h3>
              <div className="space-y-2">
                {codes.cci_bundling_concerns.map((concern, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-red-200">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-semibold text-red-900">{concern.code_pair}</p>
                        <Badge className={`mt-1 ${getSeverityColor(concern.severity)}`}>
                          {concern.concern_type}
                        </Badge>
                      </div>
                      <Badge className={getSeverityColor(concern.severity)}>
                        {concern.severity}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-700 mb-2">{concern.description}</p>
                    <p className="text-sm font-semibold text-red-700">→ {concern.recommendation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Documentation Gaps */}
          {codes.documentation_gaps?.length > 0 && (
            <div className="border rounded-lg p-4 bg-yellow-50">
              <h3 className="font-semibold text-yellow-900 mb-3">Documentation Gaps</h3>
              <div className="space-y-2">
                {codes.documentation_gaps.map((gap, idx) => (
                  <div key={idx} className="bg-white p-3 rounded border border-yellow-200">
                    <p className="font-semibold text-yellow-900 mb-1">{gap.gap}</p>
                    <p className="text-sm text-gray-700 mb-2">Impact: {gap.impact}</p>
                    <p className="text-sm text-yellow-700 font-semibold">📝 {gap.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compliance Notes */}
          {codes.compliance_notes?.length > 0 && (
            <div className="border rounded-lg p-4 bg-indigo-50">
              <h3 className="font-semibold text-indigo-900 mb-3">Compliance Notes</h3>
              <ul className="space-y-2">
                {codes.compliance_notes.map((note, idx) => (
                  <li key={idx} className="flex gap-2 text-sm text-indigo-900">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5 text-indigo-600" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}