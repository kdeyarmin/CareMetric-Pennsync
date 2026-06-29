import { useState, useEffect, useCallback, useRef } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  TrendingUp,
  DollarSign,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Lightbulb
} from "lucide-react";

export default function ProactiveRescoringEngine({
  oasisData,
  patientData,
  clinicalContext,
  autoAnalyze = false,
  onOpportunitiesFound
}) {
  const ai = useAICall();
  const [opportunities, setOpportunities] = useState(null);
  // Keep the parent callback out of analyze's identity so an inline
  // onOpportunitiesFound prop doesn't change the callback every render and
  // re-fire the (expensive) rescoring LLM call. The ref always holds the latest.
  const onFoundRef = useRef(onOpportunitiesFound);
  onFoundRef.current = onOpportunitiesFound;
  // Tracks the oasisData we've already auto-analyzed, so the auto-run fires once
  // per OASIS document rather than on every re-render.
  const autoRanForRef = useRef(null);

  const analyzeRescoringOpportunities = useCallback(async () => {
    if (!oasisData) return;

    try {
      const prompt = `Analyze OASIS data for rescoring opportunities with revenue impact.

CURRENT OASIS DATA:
${JSON.stringify(oasisData, null, 2)}

PATIENT CONTEXT:
${JSON.stringify(patientData || {}, null, 2)}

CLINICAL NOTES:
${clinicalContext || 'No additional context'}

IDENTIFY:
1. Functional items that could be scored higher (with clinical justification)
2. Missing comorbidities that should be captured
3. Clinical items that impact case-mix
4. Episode timing optimization
5. Therapy need documentation

For each opportunity, calculate:
- Current PDGM payment estimate
- Revised PDGM payment estimate
- Dollar difference
- Confidence level in recommendation
- Required documentation to support change
- Audit risk assessment`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            total_revenue_opportunity: { type: "number" },
            confidence_level: { type: "string", enum: ["high", "medium", "low"] },
            current_estimated_payment: { type: "number" },
            optimized_estimated_payment: { type: "number" },
            opportunities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: {
                    type: "string",
                    enum: ["functional", "comorbidity", "clinical", "episode_timing", "therapy"]
                  },
                  m_item_code: { type: "string" },
                  m_item_name: { type: "string" },
                  current_value: { type: "string" },
                  recommended_value: { type: "string" },
                  clinical_justification: { type: "string" },
                  supporting_evidence: { type: "string" },
                  revenue_impact: { type: "number" },
                  confidence: { type: "number" },
                  documentation_required: { type: "string" },
                  narrative_addition: { type: "string" },
                  audit_risk: { type: "string", enum: ["low", "medium", "high"] },
                  implementation_priority: { type: "string", enum: ["immediate", "high", "medium", "low"] }
                }
              }
            },
            implementation_roadmap: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  step: { type: "string" },
                  action: { type: "string" },
                  expected_impact: { type: "string" },
                  time_required: { type: "string" }
                }
              }
            },
            risk_mitigation: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  mitigation_strategy: { type: "string" }
                }
              }
            }
          }
        }
      });

      setOpportunities(result);
      if (onFoundRef.current) {
        onFoundRef.current(result);
      }
    } catch (error) {
      console.error('Rescoring analysis error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object and onOpportunitiesFound (via onFoundRef) are intentionally omitted; including them would re-fire the call every render
  }, [oasisData, patientData, clinicalContext]);

  useEffect(() => {
    // Guard on oasisData identity so a parent re-render doesn't re-trigger the
    // expensive rescoring LLM call for an already-analyzed OASIS document.
    if (autoAnalyze && oasisData && autoRanForRef.current !== oasisData) {
      autoRanForRef.current = oasisData;
      analyzeRescoringOpportunities();
    }
  }, [autoAnalyze, oasisData, analyzeRescoringOpportunities]);

  const getCategoryIcon = (category) => {
    const icons = {
      functional: '🚶',
      comorbidity: '🏥',
      clinical: '📋',
      episode_timing: '⏰',
      therapy: '💪'
    };
    return icons[category] || '📊';
  };

  const getCategoryColor = (category) => {
    const colors = {
      functional: 'bg-blue-100 text-blue-800 border-blue-300',
      comorbidity: 'bg-green-100 text-green-800 border-green-300',
      clinical: 'bg-navy-100 text-navy-800 border-navy-300',
      episode_timing: 'bg-orange-100 text-orange-800 border-orange-300',
      therapy: 'bg-gold-100 text-gold-800 border-gold-300'
    };
    return colors[category] || 'bg-slate-100 text-slate-800 border-slate-300';
  };

  return (
    <Card className="border-2 border-green-300 bg-gradient-to-br from-green-50 to-emerald-50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            Proactive Rescoring Engine
          </CardTitle>
          {!opportunities && !ai.loading && (
            <Button
              onClick={analyzeRescoringOpportunities}
              className="bg-green-600 hover:bg-green-700"
            >
              <TrendingUp className="w-4 h-4 mr-2" />
              Analyze Opportunities
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {ai.loading && (
          <div className="text-center py-12">
            <Loader2 className="w-12 h-12 animate-spin text-green-600 mx-auto mb-4" />
            <p className="text-green-700">Analyzing rescoring opportunities and revenue impact...</p>
          </div>
        )}

        {opportunities && (
          <div className="space-y-6">
            {/* Revenue Summary */}
            <Alert className="bg-gradient-to-r from-green-100 to-emerald-100 border-2 border-green-400">
              <DollarSign className="w-5 h-5 text-green-700" />
              <AlertDescription>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-green-700">Current Payment</p>
                    <p className="text-2xl font-bold text-green-900">
                      ${opportunities.current_estimated_payment?.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-green-700">Optimized Payment</p>
                    <p className="text-2xl font-bold text-green-900">
                      ${opportunities.optimized_estimated_payment?.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-green-700">Opportunity</p>
                    <p className="text-2xl font-bold text-emerald-600">
                      +${opportunities.total_revenue_opportunity?.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-3 text-center">
                  <Badge className={
                    opportunities.confidence_level === 'high' ? 'bg-green-600 text-white' :
                    opportunities.confidence_level === 'medium' ? 'bg-yellow-600 text-white' :
                    'bg-orange-600 text-white'
                  }>
                    {opportunities.confidence_level} confidence
                  </Badge>
                </div>
              </AlertDescription>
            </Alert>

            {/* Opportunities List */}
            <div>
              <h3 className="font-semibold text-lg mb-3 flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-green-600" />
                Rescoring Opportunities ({opportunities.opportunities?.length || 0})
              </h3>
              <ScrollArea className="max-h-[600px]">
                <div className="space-y-3">
                  {opportunities.opportunities?.map((opp, idx) => (
                    <div key={idx} className="bg-white rounded-lg border-2 border-green-200 p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl">{getCategoryIcon(opp.category)}</span>
                          <div>
                            <Badge className={getCategoryColor(opp.category)}>
                              {(opp.category || '').replace(/_/g, ' ')}
                            </Badge>
                            <Badge variant="outline" className="ml-2 font-mono text-xs">
                              {opp.m_item_code}
                            </Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <Badge className="bg-green-600 text-white text-lg">
                            +${opp.revenue_impact?.toLocaleString()}
                          </Badge>
                          <p className="text-xs text-slate-500 mt-1">
                            {opp.confidence}% confidence
                          </p>
                        </div>
                      </div>

                      <h4 className="font-semibold mb-2">{opp.m_item_name}</h4>

                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <div className="bg-red-50 p-2 rounded border border-red-200">
                          <p className="text-xs text-red-600 font-medium">Current</p>
                          <p className="text-sm text-red-800 font-semibold">{opp.current_value}</p>
                        </div>
                        <div className="bg-green-50 p-2 rounded border border-green-200">
                          <p className="text-xs text-green-600 font-medium">Recommended</p>
                          <p className="text-sm text-green-800 font-semibold">{opp.recommended_value}</p>
                        </div>
                      </div>

                      <div className="bg-blue-50 p-3 rounded mb-2 text-sm">
                        <p className="font-medium text-blue-900 mb-1">Clinical Justification:</p>
                        <p className="text-blue-800">{opp.clinical_justification}</p>
                      </div>

                      <div className="bg-navy-50 p-3 rounded mb-2 text-sm">
                        <p className="font-medium text-navy-900 mb-1">Supporting Evidence:</p>
                        <p className="text-navy-800 italic">"{opp.supporting_evidence}"</p>
                      </div>

                      <div className="bg-yellow-50 p-3 rounded mb-2 text-sm border border-yellow-200">
                        <p className="font-medium text-yellow-900 mb-1">📝 Add This Narrative:</p>
                        <p className="text-yellow-900">{opp.narrative_addition}</p>
                      </div>

                      <div className="bg-slate-50 p-2 rounded text-xs text-slate-700 mb-2">
                        <strong>Documentation Required:</strong> {opp.documentation_required}
                      </div>

                      <div className="flex items-center justify-between">
                        <Badge className={
                          opp.implementation_priority === 'immediate' ? 'bg-red-600 text-white' :
                          opp.implementation_priority === 'high' ? 'bg-orange-600 text-white' :
                          opp.implementation_priority === 'medium' ? 'bg-yellow-600 text-white' :
                          'bg-blue-600 text-white'
                        }>
                          {opp.implementation_priority} priority
                        </Badge>
                        <Badge className={
                          opp.audit_risk === 'low' ? 'bg-green-100 text-green-800' :
                          opp.audit_risk === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-red-100 text-red-800'
                        }>
                          {opp.audit_risk} audit risk
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Implementation Roadmap */}
            {opportunities.implementation_roadmap?.length > 0 && (
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-300">
                <h3 className="font-semibold text-blue-900 mb-3">
                  <CheckCircle2 className="w-5 h-5 inline mr-2" />
                  Implementation Roadmap
                </h3>
                <ol className="space-y-2">
                  {opportunities.implementation_roadmap.map((step, idx) => (
                    <li key={idx} className="bg-white p-3 rounded border">
                      <div className="flex items-start gap-3">
                        <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm flex-shrink-0">
                          {idx + 1}
                        </span>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-blue-900">{step.step}</p>
                          <p className="text-xs text-slate-700 mt-1">{step.action}</p>
                          <div className="flex items-center gap-4 mt-2 text-xs">
                            <Badge variant="outline">Impact: {step.expected_impact}</Badge>
                            <Badge variant="outline">Time: {step.time_required}</Badge>
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Risk Mitigation */}
            {opportunities.risk_mitigation?.length > 0 && (
              <div className="bg-orange-50 p-4 rounded-lg border border-orange-300">
                <h3 className="font-semibold text-orange-900 mb-3">
                  <AlertTriangle className="w-5 h-5 inline mr-2" />
                  Risk Mitigation Strategies
                </h3>
                <div className="space-y-2">
                  {opportunities.risk_mitigation.map((item, idx) => (
                    <div key={idx} className="bg-white p-3 rounded border text-sm">
                      <p className="font-medium text-orange-900">{item.risk}</p>
                      <p className="text-slate-700 mt-1">
                        <strong className="text-green-700">Strategy:</strong> {item.mitigation_strategy}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button
              onClick={analyzeRescoringOpportunities}
              variant="outline"
              className="w-full"
            >
              Re-analyze Opportunities
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}