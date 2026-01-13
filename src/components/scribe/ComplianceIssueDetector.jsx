import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceIssueDetector({ noteContent, diagnosis, visitType }) {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  useEffect(() => {
    if (noteContent && noteContent.length > 100) {
      analyzeCompliance();
    }
  }, [noteContent]);

  const analyzeCompliance = async () => {
    if (!noteContent || noteContent.length < 50) return;

    setLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a healthcare compliance expert. Analyze this clinical note for potential compliance issues.

Visit Type: ${visitType}
Diagnosis: ${diagnosis}

Note:
${noteContent}

Check for:
1. Missing required documentation elements (assessment, plan, patient response, vital signs)
2. Vague or non-billable language
3. Missing medical necessity justification
4. Incomplete medication documentation (dosage, frequency, indication)
5. Missing or incomplete vital signs for the visit type
6. Lack of clinical decision-making documentation
7. Potential coding/billing gaps

Return as JSON with array of issues. Each issue should have:
{
  "severity": "critical" | "warning" | "info",
  "category": string,
  "issue": string,
  "suggestion": string
}`,
        response_json_schema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  severity: { type: 'string' },
                  category: { type: 'string' },
                  issue: { type: 'string' },
                  suggestion: { type: 'string' }
                }
              }
            }
          }
        }
      });

      setIssues(response.issues || []);
      setAnalyzed(true);
    } catch (error) {
      console.error('Compliance analysis error:', error);
      toast.error('Failed to analyze compliance');
    } finally {
      setLoading(false);
    }
  };

  if (!noteContent || noteContent.length < 50) {
    return null;
  }

  const criticalIssues = issues.filter(i => i.severity === 'critical');
  const warnings = issues.filter(i => i.severity === 'warning');
  const infoItems = issues.filter(i => i.severity === 'info');

  return (
    <Card className="border-amber-200 bg-amber-50/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            Compliance Check
          </CardTitle>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-amber-600" />}
          {analyzed && !loading && (
            <span className="text-xs text-amber-700">
              {criticalIssues.length} critical, {warnings.length} warnings
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {criticalIssues.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-red-700">🔴 Critical Issues</p>
            {criticalIssues.map((issue, idx) => (
              <Alert key={idx} className="border-red-300 bg-red-50 py-2">
                <AlertDescription className="text-xs">
                  <p className="font-medium text-red-800">{issue.issue}</p>
                  <p className="text-red-700 mt-1">💡 {issue.suggestion}</p>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-yellow-700">⚠️ Warnings</p>
            {warnings.map((issue, idx) => (
              <Alert key={idx} className="border-yellow-300 bg-yellow-50 py-2">
                <AlertDescription className="text-xs">
                  <p className="font-medium text-yellow-800">{issue.issue}</p>
                  <p className="text-yellow-700 mt-1">💡 {issue.suggestion}</p>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {infoItems.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-blue-700">ℹ️ Suggestions</p>
            {infoItems.map((issue, idx) => (
              <Alert key={idx} className="border-blue-300 bg-blue-50 py-2">
                <AlertDescription className="text-xs text-blue-800">
                  {issue.suggestion}
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {analyzed && issues.length === 0 && (
          <Alert className="border-green-300 bg-green-50">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-xs text-green-800">
              No compliance issues detected. Note looks good!
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}