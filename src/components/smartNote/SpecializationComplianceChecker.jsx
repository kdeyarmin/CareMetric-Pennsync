import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, AlertTriangle, Lightbulb } from 'lucide-react';
import { base44 } from '@/api/base44Client';

export default function SpecializationComplianceChecker({
  specialtyCode,
  noteContent,
  diagnosis,
  visitType,
  providerEmail
}) {
  const [complianceIssues, setComplianceIssues] = useState([]);
  const [checking, setChecking] = useState(false);
  const debounceTimer = useRef(null);

  useEffect(() => {
    if (noteContent && noteContent.length > 100) {
      // Debounce to avoid excessive API calls
      clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        performComplianceCheck();
      }, 1500);
    }

    return () => clearTimeout(debounceTimer.current);
  }, [noteContent, diagnosis, specialtyCode]);

  const performComplianceCheck = async () => {
    if (!specialtyCode || !noteContent) return;

    setChecking(true);
    try {
      // Fetch provider's specialization for detailed compliance context
      const specs = await base44.entities.ProviderSpecialization.filter({
        provider_email: providerEmail,
        specialty_code: specialtyCode
      });

      const relevantSpec = specs[0];

      const prompt = `You are a compliance expert specializing in ${specialtyCode} healthcare documentation.

Analyze this clinical note for compliance issues specific to ${specialtyCode} practice:

Note Content:
${noteContent}

Diagnosis: ${diagnosis}
Visit Type: ${visitType}
Expertise Level: ${relevantSpec?.expertise_level || 'intermediate'}

Check for:
1. Missing required documentation elements for this specialty
2. Compliance gaps with specialty-specific regulations
3. Incomplete or vague clinical descriptions
4. Missing assessment tools or measurements common in ${specialtyCode}
5. Documentation quality issues

Return as JSON with array of issues. Each issue should have:
- "element" (what's missing/wrong)
- "severity" (critical/high/medium/low)
- "message" (user-friendly explanation)
- "suggestion" (how to fix it)
- "importance" (why it matters for compliance)`;

      const result = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  element: { type: 'string' },
                  severity: { type: 'string' },
                  message: { type: 'string' },
                  suggestion: { type: 'string' },
                  importance: { type: 'string' }
                }
              }
            },
            summary: { type: 'string' },
            compliance_score: { type: 'number' }
          }
        }
      });

      setComplianceIssues(result.issues || []);
    } catch (error) {
      console.error('Error checking compliance:', error);
    }
    setChecking(false);
  };

  if (!noteContent || noteContent.length < 100) {
    return null;
  }

  const criticalCount = complianceIssues.filter(i => i.severity === 'critical').length;
  const highCount = complianceIssues.filter(i => i.severity === 'high').length;

  return (
    <Card className={criticalCount > 0 ? 'border-red-200' : highCount > 0 ? 'border-amber-200' : 'border-green-200'}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            {criticalCount > 0 ? (
              <AlertTriangle className="w-5 h-5 text-red-600" />
            ) : highCount > 0 ? (
              <AlertCircle className="w-5 h-5 text-amber-600" />
            ) : (
              <CheckCircle2 className="w-5 h-5 text-green-600" />
            )}
            Specialization Compliance Check
          </CardTitle>
          {checking && (
            <span className="text-xs text-gray-500 animate-pulse">Checking...</span>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {complianceIssues.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 p-3 rounded">
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            <span>No compliance issues detected for {specialtyCode}</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Summary Stats */}
            <div className="flex gap-2">
              {criticalCount > 0 && (
                <Badge className="bg-red-100 text-red-800">
                  {criticalCount} Critical
                </Badge>
              )}
              {highCount > 0 && (
                <Badge className="bg-amber-100 text-amber-800">
                  {highCount} High
                </Badge>
              )}
              {complianceIssues.length > criticalCount + highCount && (
                <Badge variant="outline">
                  {complianceIssues.length - criticalCount - highCount} Low
                </Badge>
              )}
            </div>

            {/* Issues List */}
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {complianceIssues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`border rounded-lg p-3 space-y-2 ${
                    issue.severity === 'critical'
                      ? 'bg-red-50 border-red-200'
                      : issue.severity === 'high'
                      ? 'bg-amber-50 border-amber-200'
                      : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1">
                      <Lightbulb className="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {issue.element}
                        </p>
                        <p className="text-xs text-gray-700 mt-1">
                          {issue.message}
                        </p>
                      </div>
                    </div>
                    <Badge
                      className={
                        issue.severity === 'critical'
                          ? 'bg-red-600'
                          : issue.severity === 'high'
                          ? 'bg-amber-600'
                          : 'bg-gray-600'
                      }
                    >
                      {issue.severity}
                    </Badge>
                  </div>

                  <div className="bg-white/50 rounded p-2 border-l-2 border-gray-400">
                    <p className="text-xs text-gray-600 mb-1">
                      <strong>Suggestion:</strong> {issue.suggestion}
                    </p>
                    <p className="text-xs text-gray-500 italic">
                      {issue.importance}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}