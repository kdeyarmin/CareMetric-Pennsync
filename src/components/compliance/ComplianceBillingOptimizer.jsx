import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, DollarSign, FileText, Zap, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

export default function ComplianceBillingOptimizer({
  currentNotes,
  visitType,
  diagnosis,
  patient
}) {
  const [analysis, setAnalysis] = useState(null);
  const [expandedSections, setExpandedSections] = useState({});
  const [lastAnalyzedNotes, setLastAnalyzedNotes] = useState("");

  const analyzeMutation = useMutation({
    mutationFn: async (analysisData) => {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical compliance and billing optimization expert. Analyze this visit documentation and provide compliance gaps and billing opportunities.

Patient Age: ${patient?.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
Primary Diagnosis: ${diagnosis}
Visit Type: ${visitType}

Documentation:
${analysisData.notes}

Provide JSON with:
{
  "compliance_gaps": [
    {"gap": "...", "requirement": "...", "severity": "critical/high/medium", "fix": "..."}
  ],
  "oasis_items": [
    {"item": "...", "code": "...", "current_documentation": "...", "suggestion": "..."}
  ],
  "billing_opportunities": [
    {"code": "...", "description": "...", "estimated_value": "...", "requirement": "..."}
  ],
  "documentation_quality_score": 0-100,
  "quality_feedback": [
    {"area": "...", "current": "...", "improvement": "..."}
  ],
  "risk_flags": [
    {"issue": "...", "consequence": "..."}
  ]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            compliance_gaps: { type: "array" },
            oasis_items: { type: "array" },
            billing_opportunities: { type: "array" },
            documentation_quality_score: { type: "number" },
            quality_feedback: { type: "array" },
            risk_flags: { type: "array" }
          }
        }
      });
      return response;
    },
    onSuccess: (data) => {
      setAnalysis(data);
      setLastAnalyzedNotes(analysisData.notes);
    },
    onError: () => {
      toast.error("Failed to analyze compliance and billing");
    }
  });

  // Auto-analyze when notes change
  useEffect(() => {
    if (currentNotes && currentNotes.length > 50 && currentNotes !== lastAnalyzedNotes) {
      const timer = setTimeout(() => {
        analyzeMutation.mutate({ notes: currentNotes });
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [currentNotes]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  if (!analysis) {
    return (
      <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Compliance & Billing Optimizer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-gray-600">
            Analyzing your documentation for compliance gaps and billing opportunities...
          </p>
        </CardContent>
      </Card>
    );
  }

  const qualityScore = analysis.documentation_quality_score || 0;
  const hasGaps = (analysis.compliance_gaps || []).length > 0;
  const hasBillingOpportunities = (analysis.billing_opportunities || []).length > 0;
  const totalValue = (analysis.billing_opportunities || []).reduce((sum, opp) => {
    const val = parseInt(opp.estimated_value?.replace(/\D/g, '') || 0);
    return sum + val;
  }, 0);

  return (
    <Card className={`border-2 ${hasGaps ? 'border-red-300' : 'border-green-200'}`}>
      <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            Compliance & Billing Analysis
          </span>
          {analyzeMutation.isPending && (
            <Badge className="bg-blue-500">Analyzing...</Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        {/* Quality Score */}
        <div className="bg-white rounded-lg border border-gray-200 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-900">Documentation Quality</span>
            <Badge className={`text-lg font-bold ${
              qualityScore >= 90 ? 'bg-green-500' :
              qualityScore >= 75 ? 'bg-blue-500' :
              qualityScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
            }`}>
              {qualityScore}%
            </Badge>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className={`h-2 rounded-full ${
                qualityScore >= 90 ? 'bg-green-500' :
                qualityScore >= 75 ? 'bg-blue-500' :
                qualityScore >= 60 ? 'bg-yellow-500' : 'bg-red-500'
              }`}
              style={{ width: `${qualityScore}%` }}
            />
          </div>
        </div>

        {/* Risk Flags */}
        {(analysis.risk_flags || []).length > 0 && (
          <Alert className="border-red-300 bg-red-50">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-800 text-sm">
              <strong>⚠️ Risk Flags:</strong> {analysis.risk_flags.length} potential audit risks detected.
            </AlertDescription>
          </Alert>
        )}

        {/* Compliance Gaps */}
        {(analysis.compliance_gaps || []).length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('gaps')}
              className="flex items-center justify-between w-full p-3 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-red-900">
                <AlertCircle className="w-4 h-4" />
                Compliance Gaps ({analysis.compliance_gaps.length})
              </span>
              {expandedSections.gaps ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.gaps && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-red-300 pl-3">
                {analysis.compliance_gaps.map((gap, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-red-200">
                    <div className="flex items-start justify-between">
                      <p className="font-medium text-red-900 flex-1">{gap.gap}</p>
                      <Badge className={
                        gap.severity === 'critical' ? 'bg-red-600' :
                        gap.severity === 'high' ? 'bg-red-500' : 'bg-orange-500'
                      }>
                        {gap.severity?.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600 mt-1"><strong>Required:</strong> {gap.requirement}</p>
                    <p className="text-xs text-blue-700 mt-1 bg-blue-50 p-1 rounded">💡 {gap.fix}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* OASIS Items */}
        {(analysis.oasis_items || []).length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('oasis')}
              className="flex items-center justify-between w-full p-3 bg-yellow-50 border border-yellow-200 rounded-lg hover:bg-yellow-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-yellow-900">
                <FileText className="w-4 h-4" />
                OASIS Optimization ({analysis.oasis_items.length})
              </span>
              {expandedSections.oasis ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.oasis && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-yellow-300 pl-3">
                {analysis.oasis_items.map((item, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-yellow-200">
                    <p className="font-medium text-yellow-900">{item.item} ({item.code})</p>
                    <p className="text-xs text-gray-600 mt-1"><strong>Current:</strong> {item.current_documentation}</p>
                    <p className="text-xs text-green-700 mt-1 bg-green-50 p-1 rounded"><strong>Suggestion:</strong> {item.suggestion}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Billing Opportunities */}
        {(analysis.billing_opportunities || []).length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('billing')}
              className="flex items-center justify-between w-full p-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-green-900">
                <DollarSign className="w-4 h-4" />
                Billing Opportunities ({analysis.billing_opportunities.length})
              </span>
              {expandedSections.billing ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.billing && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-green-300 pl-3">
                <div className="text-sm font-bold text-green-900 bg-green-100 p-2 rounded">
                  💰 Potential Revenue: ${totalValue.toLocaleString()}
                </div>
                {analysis.billing_opportunities.map((opp, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-green-200">
                    <div className="flex items-start justify-between">
                      <p className="font-medium text-green-900">{opp.code} - {opp.description}</p>
                      <Badge className="bg-green-600">{opp.estimated_value}</Badge>
                    </div>
                    <p className="text-xs text-gray-600 mt-1"><strong>Requirement:</strong> {opp.requirement}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Quality Feedback */}
        {(analysis.quality_feedback || []).length > 0 && (
          <div>
            <button
              onClick={() => toggleSection('feedback')}
              className="flex items-center justify-between w-full p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100"
            >
              <span className="flex items-center gap-2 font-semibold text-sm text-blue-900">
                <Zap className="w-4 h-4" />
                Quality Improvements ({analysis.quality_feedback.length})
              </span>
              {expandedSections.feedback ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {expandedSections.feedback && (
              <div className="mt-2 space-y-2 ml-3 border-l-2 border-blue-300 pl-3">
                {analysis.quality_feedback.map((feedback, idx) => (
                  <div key={idx} className="text-sm bg-white p-2 rounded border border-blue-200">
                    <p className="font-medium text-blue-900">{feedback.area}</p>
                    <p className="text-xs text-gray-600 mt-1"><strong>Current:</strong> {feedback.current}</p>
                    <p className="text-xs text-blue-700 mt-1"><strong>Improvement:</strong> {feedback.improvement}</p>
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