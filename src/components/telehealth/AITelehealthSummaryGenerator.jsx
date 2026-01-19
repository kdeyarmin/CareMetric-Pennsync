import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, 
  Video, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Clock,
  Clipboard,
  Mail
} from 'lucide-react';
import { toast } from 'sonner';

export default function AITelehealthSummaryGenerator({ 
  patientId, 
  visitId,
  initialTranscript = '',
  durationMinutes,
  onAnalysisComplete 
}) {
  const [transcript, setTranscript] = useState(initialTranscript);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);

  const analyzeTranscript = async () => {
    if (!transcript.trim()) {
      toast.error('Please enter a transcript');
      return;
    }

    setAnalyzing(true);
    try {
      const response = await base44.functions.invoke('analyzeTelehealthTranscript', {
        transcript,
        patient_id: patientId,
        visit_id: visitId,
        duration_minutes: durationMinutes
      });

      if (response.data?.success) {
        setAnalysis(response.data.analysis);
        onAnalysisComplete?.(response.data.analysis);
        toast.success('Transcript analysis complete');
      } else {
        toast.error('Failed to analyze transcript');
      }
    } catch (error) {
      console.error('Error analyzing transcript:', error);
      toast.error('Error analyzing transcript');
    } finally {
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200';
      default: return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200';
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Video className="w-5 h-5" />
            AI Telehealth Transcript Analyzer
          </CardTitle>
          <CardDescription>
            Automatically generate summaries, extract key points, and ensure compliance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">Session Transcript</label>
            <Textarea
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              placeholder="Paste or enter the telehealth session transcript..."
              className="min-h-40"
            />
            <p className="text-xs text-gray-500 mt-1">
              {transcript.length} characters
            </p>
          </div>

          <Button 
            onClick={analyzeTranscript} 
            disabled={analyzing || !transcript.trim()}
            className="w-full"
          >
            {analyzing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Transcript...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4 mr-2" />
                Analyze Telehealth Session
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {analysis && (
        <div className="space-y-4">
          {/* Documentation Quality Score */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Documentation Quality</span>
                <Badge variant={analysis.documentation_quality_score >= 80 ? 'default' : 'destructive'}>
                  {analysis.documentation_quality_score}/100
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Progress value={analysis.documentation_quality_score} className="mb-2" />
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {analysis.quality_explanation}
              </p>
            </CardContent>
          </Card>

          {/* Clinical Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center justify-between">
                Clinical Summary
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => copyToClipboard(analysis.clinical_summary)}
                >
                  <Clipboard className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{analysis.clinical_summary}</p>
              
              {analysis.chief_complaint && (
                <div className="mt-4 pt-4 border-t">
                  <p className="text-sm font-semibold mb-1">Chief Complaint:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.chief_complaint}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Key Discussion Points */}
          {analysis.key_discussion_points?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Key Discussion Points</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.key_discussion_points.map((point, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 flex-shrink-0" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Red Flags */}
          {analysis.red_flags?.length > 0 && (
            <Card className="border-orange-200">
              <CardHeader className="bg-orange-50 dark:bg-orange-950">
                <CardTitle className="text-lg flex items-center gap-2 text-orange-900 dark:text-orange-100">
                  <AlertTriangle className="w-5 h-5" />
                  Red Flags & Alerts
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {analysis.red_flags.map((flag, idx) => (
                  <div key={idx} className="border-l-4 border-orange-500 pl-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={getSeverityColor(flag.severity)}>
                        {flag.severity}
                      </Badge>
                      <span className="text-sm font-semibold">{flag.flag}</span>
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      <span className="font-semibold">Action Required:</span> {flag.action_required}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Compliance Check */}
          {analysis.compliance_check && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Telehealth Compliance Check</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex items-center gap-2">
                    {analysis.compliance_check.consent_documented ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-sm">Consent Documented</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysis.compliance_check.location_verified ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-sm">Location Verified</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysis.compliance_check.technology_platform_noted ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-sm">Platform Documented</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {analysis.compliance_check.medical_necessity_justified ? (
                      <CheckCircle2 className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    )}
                    <span className="text-sm">Medical Necessity</span>
                  </div>
                </div>

                {analysis.compliance_check.issues?.length > 0 && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-semibold mb-1">Compliance Issues:</p>
                      <ul className="space-y-1">
                        {analysis.compliance_check.issues.map((issue, idx) => (
                          <li key={idx} className="text-sm">• {issue}</li>
                        ))}
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
          )}

          {/* Assessment & Plan */}
          {analysis.assessment_and_plan && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Assessment & Plan</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{analysis.assessment_and_plan}</p>
                
                {analysis.patient_understanding && (
                  <div className="mt-4 pt-4 border-t">
                    <p className="text-sm font-semibold mb-1">Patient Understanding:</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300">{analysis.patient_understanding}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Follow-up Actions */}
          {analysis.follow_up_actions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Clock className="w-5 h-5" />
                  Follow-up Actions
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.follow_up_actions.map((action, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs font-bold text-blue-700 dark:text-blue-300">{idx + 1}</span>
                      </div>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Recommended Additions */}
          {analysis.recommended_additions?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recommended Documentation Additions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {analysis.recommended_additions.map((addition, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                      <span>{addition}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Billing Codes */}
          {analysis.billing_codes_suggested?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Suggested Billing Codes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {analysis.billing_codes_suggested.map((code, idx) => (
                  <div key={idx} className="border-l-4 border-green-500 pl-3 py-2">
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-sm font-mono font-bold">{code.code}</code>
                    </div>
                    <p className="text-sm font-medium">{code.description}</p>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      {code.justification}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}