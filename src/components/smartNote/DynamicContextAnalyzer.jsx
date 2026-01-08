import React, { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Sparkles, AlertCircle, CheckCircle2, Lightbulb, 
  TrendingUp, Activity, Target, Shield 
} from "lucide-react";
import { secureAICall } from "../utils/security";

export default function DynamicContextAnalyzer({ 
  roughNote, 
  visitType, 
  diagnosis, 
  patientData,
  vitalSigns,
  carePlans,
  onApplySuggestion,
  userEmail
}) {
  const [analysis, setAnalysis] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzedContent, setLastAnalyzedContent] = useState("");

  // Analyze what's documented vs what's missing
  const contextualNeeds = useMemo(() => {
    if (!roughNote || roughNote.length < 30) return null;

    const content = roughNote.toLowerCase();
    const needs = {
      missing: [],
      suggested: [],
      priority: 'medium'
    };

    // Check for homebound status
    if (!content.includes('homebound') && !content.includes('taxing') && !content.includes('mobility')) {
      needs.missing.push({
        element: 'Homebound Status',
        reason: 'Required for all visits - document why leaving home is taxing',
        priority: 'critical',
        category: 'compliance'
      });
    }

    // Check for skilled need
    if (!content.includes('skilled') && !content.includes('nursing') && roughNote.length > 50) {
      needs.missing.push({
        element: 'Skilled Need Justification',
        reason: 'Must explain why RN/LPN skills are required',
        priority: 'critical',
        category: 'compliance'
      });
    }

    // Check for patient response
    if (!content.includes('patient') && !content.includes('response') && !content.includes('verbalized')) {
      needs.missing.push({
        element: 'Patient Response',
        reason: 'Document patient understanding or reaction to interventions',
        priority: 'high',
        category: 'compliance'
      });
    }

    // CHF-specific
    if (diagnosis?.toUpperCase().includes('CHF') || diagnosis?.toUpperCase().includes('HEART')) {
      if (!content.includes('weight')) {
        needs.suggested.push({
          element: 'Daily Weight',
          reason: 'CHF monitoring requires weight tracking',
          priority: 'high',
          category: 'clinical'
        });
      }
      if (!content.includes('edema')) {
        needs.suggested.push({
          element: 'Edema Assessment',
          reason: 'Document bilateral edema grading (0-4+)',
          priority: 'high',
          category: 'clinical'
        });
      }
    }

    // COPD-specific
    if (diagnosis?.toUpperCase().includes('COPD') || diagnosis?.toUpperCase().includes('LUNG')) {
      if (!content.includes('breath') && !content.includes('lung')) {
        needs.suggested.push({
          element: 'Respiratory Assessment',
          reason: 'Document lung sounds, work of breathing',
          priority: 'high',
          category: 'clinical'
        });
      }
    }

    // Diabetes-specific
    if (diagnosis?.toUpperCase().includes('DIABET')) {
      if (!content.includes('glucose') && !content.includes('sugar')) {
        needs.suggested.push({
          element: 'Blood Glucose',
          reason: 'Document current blood sugar level',
          priority: 'high',
          category: 'clinical'
        });
      }
      if (!content.includes('foot') && !content.includes('feet')) {
        needs.suggested.push({
          element: 'Diabetic Foot Exam',
          reason: 'Check pedal pulses, sensation, skin integrity',
          priority: 'medium',
          category: 'clinical'
        });
      }
    }

    // Recertification-specific
    if (visitType === 'recertification') {
      if (!content.includes('admission') && !content.includes('baseline')) {
        needs.missing.push({
          element: 'Admission Comparison',
          reason: 'Recert requires comparison to admission status',
          priority: 'critical',
          category: 'compliance'
        });
      }
      if (!content.includes('progress') && !content.includes('improvement')) {
        needs.missing.push({
          element: 'Progress Documentation',
          reason: 'Show improvements and remaining skilled needs',
          priority: 'critical',
          category: 'compliance'
        });
      }
    }

    // Check for care plan integration
    if (carePlans?.length > 0 && !content.includes('goal') && roughNote.length > 100) {
      needs.suggested.push({
        element: 'Care Plan Progress',
        reason: 'Reference active care plan goals',
        priority: 'medium',
        category: 'quality'
      });
    }

    return needs.missing.length > 0 || needs.suggested.length > 0 ? needs : null;
  }, [roughNote, visitType, diagnosis, carePlans]);

  // AI-powered gap analysis - only when significant changes
  useEffect(() => {
    const shouldAnalyze = roughNote.length >= 100 && 
                          roughNote !== lastAnalyzedContent &&
                          Math.abs(roughNote.length - lastAnalyzedContent.length) > 50;

    if (shouldAnalyze) {
      const timer = setTimeout(() => {
        runAIAnalysis();
      }, 2000); // Debounce

      return () => clearTimeout(timer);
    }
  }, [roughNote]);

  const runAIAnalysis = async () => {
    setIsAnalyzing(true);
    setLastAnalyzedContent(roughNote);

    try {
      const result = await secureAICall(
        async () => {
          const response = await base44.integrations.Core.InvokeLLM({
            prompt: `Analyze this in-progress clinical note and identify what's missing for Medicare compliance.

ROUGH NOTE:
${roughNote}

VISIT TYPE: ${visitType}
DIAGNOSIS: ${diagnosis}
PATIENT INFO: ${patientData ? `${patientData.first_name} ${patientData.last_name}, Primary: ${patientData.primary_diagnosis}` : 'Anonymous'}

Return ONLY high-priority missing elements that are clearly absent. Be specific and actionable.

Return JSON:
{
  "critical_gaps": [
    {
      "element": "Element name",
      "suggestion": "Specific text to add",
      "reasoning": "Why this is needed"
    }
  ],
  "quality_improvements": [
    {
      "current": "Vague phrase from note",
      "improved": "More specific version",
      "reasoning": "Why improvement needed"
    }
  ]
}`,
            response_json_schema: {
              type: "object",
              properties: {
                critical_gaps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      element: { type: "string" },
                      suggestion: { type: "string" },
                      reasoning: { type: "string" }
                    }
                  }
                },
                quality_improvements: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      current: { type: "string" },
                      improved: { type: "string" },
                      reasoning: { type: "string" }
                    }
                  }
                }
              }
            }
          });
          return response;
        },
        userEmail || 'anonymous'
      );

      setAnalysis(result);
    } catch (error) {
      // Silently fail for better UX
    }
    setIsAnalyzing(false);
  };

  const hasAnyCriticalNeeds = contextualNeeds?.missing?.filter(n => n.priority === 'critical').length > 0;
  const hasAISuggestions = analysis?.critical_gaps?.length > 0 || analysis?.quality_improvements?.length > 0;

  if (!contextualNeeds && !hasAISuggestions) return null;

  return (
    <Card className={`border-2 ${hasAnyCriticalNeeds ? 'border-red-300 bg-red-50' : 'border-blue-300 bg-blue-50'} animate-in slide-in-from-top duration-300`}>
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          {hasAnyCriticalNeeds ? (
            <AlertCircle className="w-4 h-4 text-red-600" />
          ) : (
            <Lightbulb className="w-4 h-4 text-blue-600" />
          )}
          {hasAnyCriticalNeeds ? 'Critical Gaps Detected' : 'AI Suggestions'}
          {isAnalyzing && (
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600 ml-auto" />
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-3 space-y-2">
        {/* Context-based suggestions */}
        {contextualNeeds?.missing?.map((need, idx) => (
          <Alert key={idx} className={`${
            need.priority === 'critical' ? 'bg-red-100 border-red-300' : 'bg-yellow-50 border-yellow-300'
          } p-3`}>
            <AlertDescription className="text-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{need.element}</p>
                  <p className="text-gray-700 mt-0.5">{need.reason}</p>
                </div>
                <Badge className={`${
                  need.priority === 'critical' ? 'bg-red-600' : 'bg-yellow-600'
                } flex-shrink-0`}>
                  {need.priority}
                </Badge>
              </div>
            </AlertDescription>
          </Alert>
        ))}

        {contextualNeeds?.suggested?.map((need, idx) => (
          <Alert key={idx} className="bg-blue-100 border-blue-300 p-3">
            <AlertDescription className="text-xs space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{need.element}</p>
                  <p className="text-gray-700 mt-0.5">{need.reason}</p>
                </div>
                <Badge className="bg-blue-600 flex-shrink-0">
                  {need.category}
                </Badge>
              </div>
            </AlertDescription>
          </Alert>
        ))}

        {/* AI-powered suggestions */}
        {analysis?.critical_gaps?.map((gap, idx) => (
          <div key={`gap-${idx}`} className="bg-white border-l-4 border-l-red-500 p-3 rounded space-y-2">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold text-gray-900">{gap.element}</p>
              <Shield className="w-4 h-4 text-red-600 flex-shrink-0" />
            </div>
            <p className="text-xs text-gray-600">{gap.reasoning}</p>
            <Button
              size="sm"
              onClick={() => onApplySuggestion?.(gap.suggestion)}
              className="w-full bg-red-600 hover:bg-red-700 text-xs"
            >
              Add to Note
            </Button>
          </div>
        ))}

        {analysis?.quality_improvements?.slice(0, 2).map((improvement, idx) => (
          <div key={`quality-${idx}`} className="bg-white border-l-4 border-l-blue-500 p-3 rounded space-y-2">
            <div className="flex items-start justify-between">
              <p className="text-xs font-semibold text-gray-900">Quality Improvement</p>
              <TrendingUp className="w-4 h-4 text-blue-600 flex-shrink-0" />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-gray-600">
                <span className="font-medium">Current:</span> "{improvement.current}"
              </p>
              <p className="text-xs text-gray-600">
                <span className="font-medium">Improved:</span> "{improvement.improved}"
              </p>
              <p className="text-xs text-gray-500 italic">{improvement.reasoning}</p>
            </div>
            <Button
              size="sm"
              onClick={() => {
                const updated = roughNote.replace(improvement.current, improvement.improved);
                onApplySuggestion?.(updated, true);
              }}
              variant="outline"
              className="w-full text-xs"
            >
              Apply Improvement
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}