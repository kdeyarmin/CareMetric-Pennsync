import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  Users, 
  Pill, 
  FileText,
  CheckCircle2,
  XCircle,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

export default function ClinicalDecisionSupportTool({ patientId, patientName }) {
  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateAnalysis = async () => {
    setIsLoading(true);
    try {
      const { data } = await base44.functions.invoke('getClinicalDecisionSupport', {
        patientId
      });

      if (data?.analysis) {
        setAnalysis(data.analysis);
        toast.success('Clinical analysis complete');
      } else {
        toast.error('No analysis data returned');
      }
    } catch (error) {
      console.error('Failed to generate analysis:', error);
      toast.error('Failed to generate clinical decision support');
    } finally {
      setIsLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity?.toLowerCase()) {
      case 'severe': return 'bg-red-100 text-red-800 border-red-300';
      case 'moderate': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'mild': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getUrgencyColor = (urgency) => {
    switch (urgency?.toLowerCase()) {
      case 'immediate':
      case 'urgent': return 'bg-red-100 text-red-800 border-red-300';
      case 'routine': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'optional':
      case 'monitor': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getLikelihoodIcon = (likelihood) => {
    switch (likelihood?.toLowerCase()) {
      case 'high': return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'moderate': return <AlertCircle className="w-4 h-4 text-yellow-600" />;
      case 'low': return <CheckCircle2 className="w-4 h-4 text-blue-600" />;
      default: return null;
    }
  };

  if (!analysis) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Clinical Decision Support
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">
              Generate comprehensive clinical recommendations for {patientName}
            </p>
            <Button 
              onClick={generateAnalysis} 
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Brain className="w-4 h-4 mr-2" />
                  Generate Analysis
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Clinical Summary */}
      {analysis.clinical_summary && (
        <Alert className="border-blue-200 bg-blue-50">
          <Brain className="h-5 w-5 text-blue-600" />
          <AlertDescription className="text-blue-900">
            <strong>Clinical Summary:</strong> {analysis.clinical_summary}
          </AlertDescription>
        </Alert>
      )}

      {/* Red Flags */}
      {analysis.red_flags && analysis.red_flags.length > 0 && (
        <Card className="border-red-300">
          <CardHeader className="bg-red-50">
            <CardTitle className="text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Red Flags & Urgent Concerns
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {analysis.red_flags.map((flag, idx) => (
                <div key={idx} className="p-3 border-l-4 border-red-500 bg-red-50 rounded">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-red-900">{flag.concern}</h4>
                    <Badge className={getUrgencyColor(flag.urgency)}>
                      {flag.urgency}
                    </Badge>
                  </div>
                  <p className="text-sm text-red-800"><strong>Action:</strong> {flag.action_required}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Differential Diagnoses */}
      {analysis.differential_diagnoses && analysis.differential_diagnoses.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Differential Diagnoses
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analysis.differential_diagnoses.map((diagnosis, idx) => (
                <div key={idx} className="p-4 border rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold flex items-center gap-2">
                      {getLikelihoodIcon(diagnosis.likelihood)}
                      {diagnosis.diagnosis}
                    </h4>
                    <Badge variant="outline">{diagnosis.likelihood} likelihood</Badge>
                  </div>
                  {diagnosis.supporting_evidence && diagnosis.supporting_evidence.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-700 mb-1">Supporting Evidence:</p>
                      <ul className="text-sm text-gray-600 list-disc list-inside">
                        {diagnosis.supporting_evidence.map((evidence, i) => (
                          <li key={i}>{evidence}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {diagnosis.recommended_tests && diagnosis.recommended_tests.length > 0 && (
                    <div className="mt-2">
                      <p className="text-sm font-medium text-gray-700 mb-1">Recommended Tests:</p>
                      <div className="flex flex-wrap gap-2">
                        {diagnosis.recommended_tests.map((test, i) => (
                          <Badge key={i} variant="secondary">{test}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Treatment Protocols */}
      {analysis.treatment_protocols && analysis.treatment_protocols.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Pill className="w-5 h-5" />
              Evidence-Based Treatment Protocols
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {analysis.treatment_protocols.map((protocol, idx) => (
                <div key={idx} className="p-4 border rounded-lg">
                  <h4 className="font-semibold mb-2">{protocol.condition}</h4>
                  <p className="text-sm text-gray-700 mb-2">{protocol.protocol}</p>
                  <div className="flex gap-2 flex-wrap">
                    {protocol.evidence_level && (
                      <Badge variant="outline">Evidence: {protocol.evidence_level}</Badge>
                    )}
                    {protocol.guidelines_reference && (
                      <Badge variant="secondary" className="text-xs">
                        {protocol.guidelines_reference}
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Specialist Referrals */}
      {analysis.specialist_referrals && analysis.specialist_referrals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Recommended Specialist Referrals
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.specialist_referrals.map((referral, idx) => (
                <div key={idx} className="p-3 border rounded-lg">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold">{referral.specialty}</h4>
                    <Badge className={getUrgencyColor(referral.urgency)}>
                      {referral.urgency}
                    </Badge>
                  </div>
                  <p className="text-sm text-gray-600">{referral.rationale}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Drug Interactions */}
      {analysis.drug_interactions && analysis.drug_interactions.length > 0 && (
        <Card className="border-yellow-300">
          <CardHeader className="bg-yellow-50">
            <CardTitle className="text-yellow-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Drug Interactions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {analysis.drug_interactions.map((interaction, idx) => (
                <div key={idx} className="p-3 border-l-4 border-yellow-500 bg-yellow-50 rounded">
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-yellow-900">
                      {interaction.medications?.join(' + ')}
                    </h4>
                    <Badge className={getSeverityColor(interaction.severity)}>
                      {interaction.severity}
                    </Badge>
                  </div>
                  <p className="text-sm text-yellow-800 mb-1">
                    <strong>Type:</strong> {interaction.interaction_type}
                  </p>
                  <p className="text-sm text-yellow-800">
                    <strong>Recommendation:</strong> {interaction.recommendation}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contraindications */}
      {analysis.contraindications && analysis.contraindications.length > 0 && (
        <Card className="border-red-300">
          <CardHeader className="bg-red-50">
            <CardTitle className="text-red-900 flex items-center gap-2">
              <XCircle className="w-5 h-5" />
              Contraindications
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="space-y-3">
              {analysis.contraindications.map((contra, idx) => (
                <div key={idx} className="p-3 border-l-4 border-red-500 bg-red-50 rounded">
                  <h4 className="font-semibold text-red-900 mb-1">{contra.medication}</h4>
                  <p className="text-sm text-red-800 mb-1">
                    <strong>Reason:</strong> {contra.reason}
                  </p>
                  {contra.alternative && (
                    <p className="text-sm text-red-800">
                      <strong>Alternative:</strong> {contra.alternative}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preventive Care */}
      {analysis.preventive_care && analysis.preventive_care.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5" />
              Preventive Care Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {analysis.preventive_care.map((item, idx) => (
                <div key={idx} className="p-3 border rounded-lg">
                  <h4 className="font-semibold mb-1">{item.recommendation}</h4>
                  <p className="text-sm text-gray-600 mb-1">{item.rationale}</p>
                  {item.timeline && (
                    <Badge variant="outline" className="text-xs">{item.timeline}</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex justify-center">
        <Button 
          onClick={generateAnalysis} 
          variant="outline"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Regenerating...
            </>
          ) : (
            'Regenerate Analysis'
          )}
        </Button>
      </div>
    </div>
  );
}