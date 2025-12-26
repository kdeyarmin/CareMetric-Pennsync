import React, { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Lightbulb,
  ExternalLink,
  Loader2,
  X,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { debounce } from "lodash";

export default function RealTimeNoteFeedback({
  noteContent,
  diagnosis,
  visitType,
  vitalSigns,
  patientData,
  onApplySuggestion,
  autoAnalyze = true
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [dismissedIssues, setDismissedIssues] = useState(new Set());
  const [isExpanded, setIsExpanded] = useState(true);

  // Debounced analysis function
  const analyzeFeedback = useCallback(
    debounce(async (content) => {
      if (!content || content.length < 50) {
        setFeedback(null);
        return;
      }

      setIsAnalyzing(true);
      try {
        const result = await base44.integrations.Core.InvokeLLM({
          prompt: `You are a clinical documentation quality analyst. Analyze this home health visit note in real-time for quality, accuracy, and completeness.

VISIT NOTE:
${content}

CLINICAL CONTEXT:
- Diagnosis: ${diagnosis || 'Not specified'}
- Visit Type: ${visitType || 'Not specified'}
- Vital Signs: ${vitalSigns ? JSON.stringify(vitalSigns) : 'Not recorded'}
- Patient Age: ${patientData?.date_of_birth ? calculateAge(patientData.date_of_birth) : 'Unknown'}
- Cognitive Status: ${patientData?.functional_status?.cognitive_status || 'Unknown'}

Analyze for:

1. **INACCURACIES**: Medical terminology errors, incorrect drug names, wrong dosages format, conflicting statements
2. **INCONSISTENCIES**: Contradictions between sections, vital signs not matching narrative, diagnosis-treatment mismatches
3. **MISSING DETAILS**: Required Medicare elements, homebound status justification, skilled need documentation, safety assessment
4. **CLINICAL GAPS**: Unaddressed symptoms, missing medication reconciliation, no response to treatment documented
5. **GUIDELINE VIOLATIONS**: Medicare CoP requirements, visit type requirements, proper assessment documentation

For each issue found:
- Identify the specific text/section with the problem
- Explain why it's an issue
- Provide a specific improvement suggestion
- Rate severity (critical/high/medium/low)
- Suggest relevant guideline reference if applicable

Return ONLY issues that are clearly present. Don't suggest issues for things not yet documented - focus on what IS written.`,
          response_json_schema: {
            type: "object",
            properties: {
              overall_quality_score: { 
                type: "number",
                description: "0-100 score"
              },
              issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    category: { 
                      type: "string",
                      enum: ["inaccuracy", "inconsistency", "missing_detail", "clinical_gap", "guideline_violation"]
                    },
                    severity: { 
                      type: "string",
                      enum: ["critical", "high", "medium", "low"]
                    },
                    issue_text: { type: "string" },
                    location: { type: "string" },
                    explanation: { type: "string" },
                    suggestion: { type: "string" },
                    guideline_reference: { type: "string" },
                    guideline_link: { type: "string" }
                  }
                }
              },
              strengths: {
                type: "array",
                items: { type: "string" },
                description: "What's done well"
              },
              quick_fixes: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    original_text: { type: "string" },
                    corrected_text: { type: "string" },
                    reason: { type: "string" }
                  }
                }
              }
            }
          }
        });

        setFeedback(result);
      } catch (error) {
        console.error('Real-time feedback error:', error);
      }
      setIsAnalyzing(false);
    }, 2000),
    [diagnosis, visitType, vitalSigns, patientData]
  );

  useEffect(() => {
    if (autoAnalyze && noteContent) {
      analyzeFeedback(noteContent);
    }
    return () => analyzeFeedback.cancel();
  }, [noteContent, autoAnalyze, analyzeFeedback]);

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="w-4 h-4 text-red-600" />;
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-orange-600" />;
      case 'medium':
        return <Info className="w-4 h-4 text-yellow-600" />;
      default:
        return <Info className="w-4 h-4 text-blue-600" />;
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'border-red-300 bg-red-50';
      case 'high':
        return 'border-orange-300 bg-orange-50';
      case 'medium':
        return 'border-yellow-300 bg-yellow-50';
      default:
        return 'border-blue-300 bg-blue-50';
    }
  };

  const getCategoryLabel = (category) => {
    const labels = {
      inaccuracy: 'Inaccuracy',
      inconsistency: 'Inconsistency',
      missing_detail: 'Missing Detail',
      clinical_gap: 'Clinical Gap',
      guideline_violation: 'Guideline Violation'
    };
    return labels[category] || category;
  };

  const handleDismissIssue = (issueIndex) => {
    setDismissedIssues(prev => new Set([...prev, issueIndex]));
  };

  const activeIssues = feedback?.issues?.filter((_, idx) => !dismissedIssues.has(idx)) || [];
  const criticalCount = activeIssues.filter(i => i.severity === 'critical').length;
  const highCount = activeIssues.filter(i => i.severity === 'high').length;

  if (!noteContent || noteContent.length < 50) {
    return null;
  }

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-purple-600" />
            AI Real-Time Feedback
            {isAnalyzing && <Loader2 className="w-4 h-4 animate-spin text-purple-600" />}
          </div>
          <div className="flex items-center gap-2">
            {feedback && (
              <>
                {criticalCount > 0 && (
                  <Badge className="bg-red-600 text-white text-xs">
                    {criticalCount} Critical
                  </Badge>
                )}
                {highCount > 0 && (
                  <Badge className="bg-orange-600 text-white text-xs">
                    {highCount} High
                  </Badge>
                )}
                {feedback.overall_quality_score !== undefined && (
                  <Badge className={`text-xs ${
                    feedback.overall_quality_score >= 90 ? 'bg-green-600' :
                    feedback.overall_quality_score >= 75 ? 'bg-blue-600' :
                    feedback.overall_quality_score >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                  } text-white`}>
                    Score: {feedback.overall_quality_score}
                  </Badge>
                )}
              </>
            )}
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </CardTitle>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3">
          {isAnalyzing && !feedback && (
            <Alert className="bg-purple-100 border-purple-300">
              <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
              <AlertDescription className="text-purple-900 text-sm">
                Analyzing your note for quality and completeness...
              </AlertDescription>
            </Alert>
          )}

          {/* Strengths */}
          {feedback?.strengths && feedback.strengths.length > 0 && (
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 text-sm">
                <strong>Well documented:</strong>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {feedback.strengths.map((strength, idx) => (
                    <li key={idx}>✓ {strength}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Issues */}
          {activeIssues.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-purple-900">Issues Detected:</p>
              {activeIssues.map((issue, idx) => (
                <Card key={idx} className={`border-2 ${getSeverityColor(issue.severity)}`}>
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        {getSeverityIcon(issue.severity)}
                        <Badge variant="outline" className="text-xs">
                          {getCategoryLabel(issue.category)}
                        </Badge>
                        <Badge variant="outline" className="text-xs capitalize">
                          {issue.severity}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0"
                        onClick={() => handleDismissIssue(idx)}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>

                    {issue.location && (
                      <p className="text-xs text-gray-600 mb-1">
                        <strong>Location:</strong> {issue.location}
                      </p>
                    )}

                    {issue.issue_text && (
                      <div className="bg-white p-2 rounded border mb-2">
                        <p className="text-xs text-gray-900 italic">"{issue.issue_text}"</p>
                      </div>
                    )}

                    <p className="text-xs text-gray-700 mb-2">{issue.explanation}</p>

                    {issue.suggestion && (
                      <Alert className="bg-white border-purple-200 mb-2">
                        <Lightbulb className="w-3 h-3 text-purple-600" />
                        <AlertDescription className="text-xs text-purple-900">
                          <strong>Suggestion:</strong> {issue.suggestion}
                        </AlertDescription>
                      </Alert>
                    )}

                    {issue.guideline_reference && (
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs bg-blue-100 text-blue-900">
                          {issue.guideline_reference}
                        </Badge>
                        {issue.guideline_link && (
                          <a
                            href={issue.guideline_link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                          >
                            View Guideline <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Quick Fixes */}
          {feedback?.quick_fixes && feedback.quick_fixes.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-purple-900">Quick Fixes Available:</p>
              {feedback.quick_fixes.map((fix, idx) => (
                <Card key={idx} className="border bg-white">
                  <CardContent className="p-3">
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-gray-600 flex-1">
                          <strong className="text-red-700">Replace:</strong> "{fix.original_text}"
                        </p>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs text-gray-600 flex-1">
                          <strong className="text-green-700">With:</strong> "{fix.corrected_text}"
                        </p>
                        <Button
                          size="sm"
                          onClick={() => onApplySuggestion?.(fix.original_text, fix.corrected_text)}
                          className="bg-purple-600 hover:bg-purple-700 h-7 text-xs"
                        >
                          Apply
                        </Button>
                      </div>
                      <p className="text-xs text-gray-500 italic">{fix.reason}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No Issues */}
          {feedback && activeIssues.length === 0 && !isAnalyzing && (
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900 text-sm">
                <strong>Great work!</strong> No critical issues detected in your note.
              </AlertDescription>
            </Alert>
          )}

          {dismissedIssues.size > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDismissedIssues(new Set())}
              className="w-full text-xs"
            >
              Show {dismissedIssues.size} Dismissed Issue{dismissedIssues.size !== 1 ? 's' : ''}
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const birthDate = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}