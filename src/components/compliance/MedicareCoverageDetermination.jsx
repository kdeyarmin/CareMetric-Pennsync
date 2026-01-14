import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, XCircle, AlertTriangle, Brain, Loader2, Copy, FileText } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function MedicareCoverageDetermination({ 
  patientId, 
  diagnosis, 
  functionalStatus,
  visitType,
  noteContent,
  onJustificationGenerated 
}) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [determination, setDetermination] = useState(null);

  const analyzeCoverage = async () => {
    setIsAnalyzing(true);
    try {
      // Fetch patient data for comprehensive analysis
      const patient = await base44.entities.Patient.filter({ id: patientId }).then(p => p[0]);

      const result = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a Medicare compliance expert analyzing whether home health services meet Medicare coverage criteria.

Patient Information:
- Diagnosis: ${diagnosis || patient?.primary_diagnosis || 'Not specified'}
- Age: ${patient?.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31557600000) : 'Unknown'}
- Functional Status: ${JSON.stringify(functionalStatus || patient?.functional_status || {})}
- Visit Type: ${visitType || 'routine_visit'}
- Current Medications: ${patient?.current_medications?.map(m => m.name).join(', ') || 'None'}
- Past Hospitalizations: ${patient?.past_hospitalizations?.length || 0}

Clinical Documentation:
${noteContent || 'No documentation provided yet'}

Analyze against Medicare home health coverage criteria:
1. Is patient homebound or does documentation support homebound status?
2. Does patient require skilled nursing care (not just custodial care)?
3. Is care intermittent (not continuous)?
4. Is physician order documented/implied?
5. Is care medically reasonable and necessary?

Provide:
- Coverage determination (COVERED / QUESTIONABLE / NOT COVERED)
- Specific criteria met/not met
- Risk level for denial
- Auto-generated skilled need justification language
- Specific documentation gaps to address
- Recommendations to strengthen coverage

Format as JSON.`,
        response_json_schema: {
          type: "object",
          properties: {
            determination: {
              type: "string",
              enum: ["COVERED", "QUESTIONABLE", "NOT_COVERED"]
            },
            confidenceScore: { type: "number" },
            denialRisk: {
              type: "string",
              enum: ["LOW", "MODERATE", "HIGH", "CRITICAL"]
            },
            criteriaMet: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  criterion: { type: "string" },
                  status: { type: "string" },
                  evidence: { type: "string" }
                }
              }
            },
            skilledNeedJustification: { type: "string" },
            homeboundJustification: { type: "string" },
            documentationGaps: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
            requiredLanguage: {
              type: "object",
              properties: {
                skilled: { type: "string" },
                homebound: { type: "string" },
                medicalNecessity: { type: "string" }
              }
            },
            complianceNotes: { type: "string" }
          }
        }
      });

      setDetermination(result);
      toast.success('Medicare coverage analysis complete');
    } catch (error) {
      console.error('Error analyzing coverage:', error);
      toast.error('Failed to analyze coverage');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const copyJustification = () => {
    if (!determination?.skilledNeedJustification) return;
    navigator.clipboard.writeText(determination.skilledNeedJustification);
    toast.success('Justification copied to clipboard');
  };

  const insertJustification = () => {
    if (!determination || !onJustificationGenerated) return;
    
    const fullText = `
MEDICARE COVERAGE DETERMINATION

${determination.skilledNeedJustification}

${determination.homeboundJustification}

${determination.requiredLanguage?.medicalNecessity || ''}
`.trim();

    onJustificationGenerated(fullText);
    toast.success('Justification inserted into note');
  };

  const getDeterminationColor = (det) => {
    if (det === 'COVERED') return 'bg-green-100 text-green-800 border-green-200';
    if (det === 'QUESTIONABLE') return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return 'bg-red-100 text-red-800 border-red-200';
  };

  const getRiskColor = (risk) => {
    if (risk === 'LOW') return 'text-green-600';
    if (risk === 'MODERATE') return 'text-yellow-600';
    if (risk === 'HIGH') return 'text-orange-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-purple-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-purple-50 to-pink-50">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-purple-600" />
            Medicare Coverage Determination
          </span>
          {determination && (
            <Badge className={getDeterminationColor(determination.determination)}>
              {determination.determination}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <Button
          onClick={analyzeCoverage}
          disabled={isAnalyzing}
          className="w-full bg-purple-600 hover:bg-purple-700"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Coverage...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Analyze Medicare Coverage
            </>
          )}
        </Button>

        {determination && (
          <div className="space-y-3">
            {/* Determination Summary */}
            <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-gray-700">Coverage Status:</span>
                <Badge className={getDeterminationColor(determination.determination)}>
                  {determination.determination}
                </Badge>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-sm font-semibold text-gray-700">Denial Risk:</span>
                <span className={`text-sm font-bold ${getRiskColor(determination.denialRisk)}`}>
                  {determination.denialRisk}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-semibold text-gray-700">Confidence:</span>
                <span className="text-sm font-semibold text-gray-900">
                  {Math.round(determination.confidenceScore || 0)}%
                </span>
              </div>
            </div>

            {/* Risk Alert */}
            {(determination.denialRisk === 'HIGH' || determination.denialRisk === 'CRITICAL') && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-900 text-xs">
                  <strong>High Denial Risk:</strong> Documentation requires immediate attention to meet Medicare criteria.
                </AlertDescription>
              </Alert>
            )}

            {/* Criteria Status */}
            {determination.criteriaMet && determination.criteriaMet.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-gray-700">Coverage Criteria:</h4>
                <div className="space-y-1.5">
                  {determination.criteriaMet.map((criterion, idx) => (
                    <div 
                      key={idx} 
                      className={`rounded p-2 border text-xs ${
                        criterion.status === 'MET' 
                          ? 'bg-green-50 border-green-200' 
                          : criterion.status === 'PARTIAL'
                          ? 'bg-yellow-50 border-yellow-200'
                          : 'bg-red-50 border-red-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {criterion.status === 'MET' ? (
                          <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        ) : criterion.status === 'PARTIAL' ? (
                          <AlertTriangle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <p className="font-medium">{criterion.criterion}</p>
                          <p className="text-gray-600 mt-0.5">{criterion.evidence}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Skilled Need Justification */}
            <div className="bg-purple-50 rounded-lg p-3 border border-purple-200">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-purple-900">Skilled Need Justification</h4>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={copyJustification}
                    className="h-6 px-2 text-xs"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={insertJustification}
                    className="h-6 px-2 text-xs border-purple-300 hover:bg-purple-100"
                  >
                    Insert
                  </Button>
                </div>
              </div>
              <p className="text-sm text-purple-800 whitespace-pre-wrap">
                {determination.skilledNeedJustification}
              </p>
            </div>

            {/* Homebound Justification */}
            {determination.homeboundJustification && (
              <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">Homebound Status Justification</h4>
                <p className="text-sm text-blue-800 whitespace-pre-wrap">
                  {determination.homeboundJustification}
                </p>
              </div>
            )}

            {/* Documentation Gaps */}
            {determination.documentationGaps && determination.documentationGaps.length > 0 && (
              <div className="bg-orange-50 rounded-lg p-3 border border-orange-200">
                <h4 className="text-sm font-semibold text-orange-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Documentation Gaps to Address:
                </h4>
                <ul className="text-sm text-orange-800 space-y-1">
                  {determination.documentationGaps.map((gap, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span>•</span>
                      <span>{gap}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recommendations */}
            {determination.recommendations && determination.recommendations.length > 0 && (
              <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                <h4 className="text-sm font-semibold text-green-900 mb-2">Recommendations:</h4>
                <ul className="text-sm text-green-800 space-y-1">
                  {determination.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span>•</span>
                      <span>{rec}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Compliance Notes */}
            {determination.complianceNotes && (
              <Alert>
                <AlertDescription className="text-xs text-gray-700">
                  <strong>Compliance Note:</strong> {determination.complianceNotes}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <p className="text-xs text-gray-500">
          AI-powered analysis of Medicare coverage criteria. Review and validate all recommendations before use.
        </p>
      </CardContent>
    </Card>
  );
}