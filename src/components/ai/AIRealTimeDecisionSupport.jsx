import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Lightbulb, AlertCircle, Zap, Activity, Pill, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function AIRealTimeDecisionSupport({
  patient,
  currentNotes,
  visitType,
  diagnosis,
  medications = []
}) {
  const [suggestions, setSuggestions] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [lastAnalyzedNotes, setLastAnalyzedNotes] = useState("");

  const analyzeMutation = useMutation({
    mutationFn: async (analysisData) => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical decision support AI for a healthcare visit. Analyze this patient case and provide real-time clinical suggestions.

Patient: ${patient.first_name} ${patient.last_name}
Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
Primary Diagnosis: ${diagnosis || 'Not specified'}
Current Medications: ${medications.length > 0 ? medications.map(m => m.name).join(', ') : 'None listed'}
Visit Type: ${visitType}

Clinical Notes So Far:
${analysisData.notes}

Provide JSON with these sections:
{
  "clinical_insights": [
    {"category": "Assessment", "suggestion": "...", "priority": "high/medium/low", "evidence": "..."}
  ],
  "drug_interactions": [
    {"medications": ["med1", "med2"], "interaction": "...", "severity": "high/medium/low"}
  ],
  "missing_assessments": [
    {"assessment": "...", "reason": "...", "priority": "high/medium/low"}
  ],
  "care_plan_suggestions": [
    {"suggestion": "...", "rationale": "...", "evidence": "..."}
  ],
  "red_flags": [
    {"flag": "...", "action": "..."}
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            clinical_insights: { type: "array" },
            drug_interactions: { type: "array" },
            missing_assessments: { type: "array" },
            care_plan_suggestions: { type: "array" },
            red_flags: { type: "array" }
          }
        }
      });
      return response;
    },
    onSuccess: (data) => {
      setSuggestions(data);
      setLastAnalyzedNotes(currentNotes);
    },
    onError: () => {
      toast.error("Failed to analyze clinical data");
    }
  });

  // Auto-analyze when notes change significantly
  useEffect(() => {
    if (currentNotes && currentNotes.length > 50 && currentNotes !== lastAnalyzedNotes) {
      const timer = setTimeout(() => {
        analyzeMutation.mutate({ notes: currentNotes });
      }, 2000); // Debounce by 2 seconds
      return () => clearTimeout(timer);
    }
  }, [currentNotes]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  if (!suggestions) {
    return (
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-blue-600" />
            AI Clinical Support
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-600">
            Start typing notes to receive real-time clinical suggestions...
          </p>
        </CardContent>
      </Card>
    );
  }

  const redFlags = suggestions.red_flags || [];
  const hasRedFlags = redFlags.length > 0;

  return (
    <Card className={`border-2 ${hasRedFlags ? 'border-red-300' : 'border-blue-200'}`}>
      <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            Real-Time Clinical Insights
          </span>
          {analyzeMutation.isPending && (
            <Badge className="bg-yellow-500">Analyzing...</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {/* Red Flags Alert */}
        {hasRedFlags && (
          <Alert className="border-red-300 bg-red-50">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              <strong>⚠️ Red Flags Detected:</strong> {redFlags.length} clinical concern{redFlags.length !== 1 ? 's' : ''} require immediate attention.
            </AlertDescription>
          </Alert>
        )}

        {/* Red Flags */}
        {redFlags.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('redFlags')}
              className="flex items-center justify-between w-full p-3 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-red-900">
                <AlertTriangle className="w-4 h-4" />
                Critical Alerts ({redFlags.length})
              </span>
              {expandedSections.redFlags ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.redFlags && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-red-300 pl-3">
                {redFlags.map((flag, idx) => (
                  <div key={idx} className="text-sm">
                    <p className="font-medium text-red-900">🚩 {flag.flag}</p>
                    <p className="text-xs text-red-800 mt-1">→ {flag.action}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Drug Interactions */}
        {suggestions.drug_interactions?.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('interactions')}
              className="flex items-center justify-between w-full p-3 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-yellow-900">
                <Pill className="w-4 h-4" />
                Drug Interactions ({suggestions.drug_interactions.length})
              </span>
              {expandedSections.interactions ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.interactions && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-yellow-300 pl-3">
                {suggestions.drug_interactions.map((interaction, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-yellow-200">
                    <p className="font-medium text-yellow-900">{interaction.medications?.join(' + ')}</p>
                    <p className="text-xs text-yellow-800 mt-1">{interaction.interaction}</p>
                    <Badge className={`mt-2 text-xs ${
                      interaction.severity === 'high' ? 'bg-red-500' :
                      interaction.severity === 'medium' ? 'bg-yellow-500' : 'bg-blue-500'
                    }`}>
                      {interaction.severity?.toUpperCase()}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Missing Assessments */}
        {suggestions.missing_assessments?.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('assessments')}
              className="flex items-center justify-between w-full p-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-orange-900">
                <Activity className="w-4 h-4" />
                Missing Assessments ({suggestions.missing_assessments.length})
              </span>
              {expandedSections.assessments ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.assessments && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-orange-300 pl-3">
                {suggestions.missing_assessments.map((item, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-orange-200">
                    <p className="font-medium text-orange-900">✓ {item.assessment}</p>
                    <p className="text-xs text-orange-800 mt-1">{item.reason}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Clinical Insights */}
        {suggestions.clinical_insights?.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('insights')}
              className="flex items-center justify-between w-full p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-blue-900">
                <Lightbulb className="w-4 h-4" />
                Clinical Insights ({suggestions.clinical_insights.length})
              </span>
              {expandedSections.insights ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.insights && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-blue-300 pl-3">
                {suggestions.clinical_insights.map((insight, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-blue-200">
                    <p className="font-medium text-blue-900">{insight.category}: {insight.suggestion}</p>
                    <p className="text-xs text-gray-600 mt-1">💡 {insight.evidence}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Care Plan Suggestions */}
        {suggestions.care_plan_suggestions?.length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('carePlan')}
              className="flex items-center justify-between w-full p-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-green-900">
                📋 Care Plan Recommendations ({suggestions.care_plan_suggestions.length})
              </span>
              {expandedSections.carePlan ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.carePlan && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-green-300 pl-3">
                {suggestions.care_plan_suggestions.map((suggestion, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-green-200">
                    <p className="font-medium text-green-900">{suggestion.suggestion}</p>
                    <p className="text-xs text-gray-600 mt-1">{suggestion.rationale}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}