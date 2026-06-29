import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, RefreshCw, TrendingUp, BookOpen, CheckCircle2, AlertTriangle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function AIPathwayUpdater({ pathway, onPathwayUpdated }) {
  const ai = useAICall();
  const [recommendations, setRecommendations] = useState(null);
  const [error, setError] = useState(null);

  const analyzePathway = async () => {
    setError(null);
    setRecommendations(null);

    try {
      const prompt = `As a clinical pathway expert, analyze the following clinical pathway and provide evidence-based recommendations for updates:

Current Pathway:
Name: ${pathway.pathway_name}
Description: ${pathway.description}
Trigger Conditions: ${JSON.stringify(pathway.trigger_conditions)}
PDGM Group: ${pathway.pdgm_clinical_group}
Documentation Prompts: ${JSON.stringify(pathway.documentation_prompts)}
Rescore Opportunities: ${JSON.stringify(pathway.rescore_opportunities)}
Recommended Tasks: ${JSON.stringify(pathway.recommended_tasks)}
Comorbidity Checklist: ${JSON.stringify(pathway.comorbidity_checklist)}

Based on:
1. Current Medicare guidelines and CMS updates
2. Evidence-based best practices
3. PDGM optimization strategies
4. Quality measure requirements
5. Recent clinical research

Provide specific recommendations for:
- Updates to documentation prompts based on new guidelines
- Additional or modified rescore opportunities
- New tasks that should be recommended
- Comorbidities that should be added or emphasized
- Changes to trigger conditions for better patient identification
- Any outdated elements that should be revised

Also indicate:
- Priority (critical, high, medium, low) for each recommendation
- Rationale based on guidelines or evidence
- Potential impact on patient outcomes and/or revenue

Return ONLY valid JSON.`;

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" },
            overall_assessment: { type: "string" },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  recommendation: { type: "string" },
                  rationale: { type: "string" },
                  priority: { type: "string" },
                  impact: { type: "string" },
                  suggested_change: { type: "object" }
                }
              }
            },
            guideline_updates: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  guideline: { type: "string" },
                  change: { type: "string" },
                  effective_date: { type: "string" }
                }
              }
            },
            performance_insights: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      });

      setRecommendations(response);
    } catch (err) {
      console.error("Pathway analysis error:", err);
      setError(err.message || "Failed to analyze pathway");
    }
  };

  const applyRecommendation = async (recommendation) => {
    try {
      const updatedPathway = { ...pathway };
      
      if (recommendation.suggested_change) {
        Object.keys(recommendation.suggested_change).forEach(key => {
          if (Array.isArray(recommendation.suggested_change[key])) {
            updatedPathway[key] = [
              ...(updatedPathway[key] || []),
              ...recommendation.suggested_change[key]
            ];
          } else {
            updatedPathway[key] = recommendation.suggested_change[key];
          }
        });
      }

      await base44.entities.ClinicalPathway.update(pathway.id, updatedPathway);
      
      if (onPathwayUpdated) {
        onPathwayUpdated(updatedPathway);
      }

      setRecommendations(prev => ({
        ...prev,
        recommendations: prev.recommendations.filter(r => r !== recommendation)
      }));
    } catch (err) {
      console.error("Failed to apply recommendation:", err);
      setError(err.message);
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'critical': return 'bg-red-600 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-white';
      case 'low': return 'bg-blue-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-navy-50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-blue-900">
          <RefreshCw className="w-5 h-5" />
          AI Pathway Update Advisor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-red-900">{error}</AlertDescription>
          </Alert>
        )}

        {!recommendations && (
          <Button
            onClick={analyzePathway}
            disabled={ai.loading}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            {ai.loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Pathway Against Latest Guidelines...
              </>
            ) : (
              <>
                <TrendingUp className="w-4 h-4 mr-2" />
                Analyze & Get Update Recommendations
              </>
            )}
          </Button>
        )}

        {recommendations && (
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <BookOpen className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <p className="font-semibold text-blue-900 mb-1">Analysis Summary</p>
                <p className="text-sm text-blue-800">{recommendations.summary}</p>
              </AlertDescription>
            </Alert>

            {recommendations.overall_assessment && (
              <div className="p-3 bg-white rounded-lg border">
                <p className="text-sm font-medium text-slate-900 mb-1">Overall Assessment</p>
                <p className="text-sm text-slate-700">{recommendations.overall_assessment}</p>
              </div>
            )}

            {/* Guideline Updates */}
            {recommendations.guideline_updates?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-navy-600" />
                  Recent Guideline Updates
                </h4>
                <ScrollArea className="h-32">
                  <div className="space-y-2">
                    {recommendations.guideline_updates.map((update, idx) => (
                      <div key={idx} className="p-2 bg-navy-50 rounded border border-navy-200">
                        <p className="text-sm font-medium text-navy-900">{update.guideline}</p>
                        <p className="text-xs text-navy-700 mt-1">{update.change}</p>
                        {update.effective_date && (
                          <p className="text-xs text-navy-600 mt-1">Effective: {update.effective_date}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Recommendations */}
            {recommendations.recommendations?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Recommendations ({recommendations.recommendations.length})
                </h4>
                <ScrollArea className="max-h-96">
                  <div className="space-y-3">
                    {recommendations.recommendations.map((rec, idx) => (
                      <Card key={idx} className="border-green-200 bg-white">
                        <CardContent className="p-3 space-y-2">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <Badge className={getPriorityColor(rec.priority)} size="sm">
                                {rec.priority}
                              </Badge>
                              <p className="text-xs text-slate-500 mt-1">{rec.category}</p>
                            </div>
                          </div>

                          <p className="text-sm font-medium text-slate-900">{rec.recommendation}</p>

                          <div className="space-y-1 text-xs">
                            <p className="text-slate-700">
                              <span className="font-semibold">Rationale:</span> {rec.rationale}
                            </p>
                            {rec.impact && (
                              <p className="text-slate-700">
                                <span className="font-semibold">Impact:</span> {rec.impact}
                              </p>
                            )}
                          </div>

                          {rec.suggested_change && (
                            <Button
                              onClick={() => applyRecommendation(rec)}
                              size="sm"
                              className="w-full bg-green-600 hover:bg-green-700 mt-2"
                            >
                              Apply This Update
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Performance Insights */}
            {recommendations.performance_insights?.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold text-slate-900 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-navy-600" />
                  Performance Insights
                </h4>
                <div className="p-3 bg-navy-50 rounded border border-navy-200">
                  <ul className="space-y-1">
                    {recommendations.performance_insights.map((insight, idx) => (
                      <li key={idx} className="text-sm text-navy-900">• {insight}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <Button
              onClick={() => setRecommendations(null)}
              variant="outline"
              className="w-full"
            >
              Analyze Again
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}