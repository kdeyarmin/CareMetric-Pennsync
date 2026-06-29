import { useState, useEffect } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  AlertTriangle,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  FileText,
  Loader2,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OASISExecutiveSummary({ analysisResults, pdgmData }) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [isExpanded, setIsExpanded] = useState(true);

  useEffect(() => {
    if (analysisResults && pdgmData && !summary && !ai.loading) {
      // Don't auto-generate, let user click button
    }
  }, [analysisResults, pdgmData, summary, ai.loading]);

  const generateExecutiveSummary = async () => {

    try {
      // Extract only essential data
      const topIssues = (analysisResults.compliance_concerns || []).slice(0, 2).map(c => c.concern || c);
      const topRevenue = (analysisResults.revenue_tips || []).slice(0, 2).map(r => r.tip || r);
      const _topAccuracy = (analysisResults.accuracy_issues || []).slice(0, 2).map(a => a.issue || a);

      const result = await ai.run({
        model: "claude_sonnet_4_6",
        prompt: `Create executive summary for OASIS assessment.

Scores: Overall ${analysisResults.overall_score}%, Compliance ${analysisResults.compliance_score}%, Revenue ${analysisResults.revenue_optimization_score}%

Top Issues:
${topIssues.join(', ')}

Revenue Opportunities:
${topRevenue.join(', ')}

Generate: 1 overall assessment sentence, 2-3 critical actions, 2 revenue highlights, 2 compliance risks, 1 bottom line.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_assessment: { type: "string" },
            critical_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  urgency: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            revenue_highlights: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  opportunity: { type: "string" },
                  value: { type: "string" }
                }
              }
            },
            compliance_risks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  risk: { type: "string" },
                  severity: { type: "string" }
                }
              }
            },
            bottom_line: { type: "string" }
          }
        }
      });

      setSummary(result);
    } catch (error) {
      console.error("Summary generation error:", error);
      setSummary(null);
    }

  };

  if (!analysisResults) return null;

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardContent className="p-6 text-center">
          <Loader2 className="w-8 h-8 text-navy-600 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-navy-900">Generating executive summary...</p>
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className="border-2 border-navy-300 bg-gradient-to-r from-navy-50 to-gold-50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-navy-600" />
              <p className="text-sm font-medium text-navy-900">Executive Summary</p>
            </div>
            <Button size="sm" onClick={generateExecutiveSummary} className="bg-navy-600 hover:bg-navy-700">
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Summary
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-400 bg-gradient-to-r from-navy-50 to-gold-50">
      <CardHeader className="pb-3 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            Executive Summary
            <Badge className="bg-navy-600 text-white">AI-Generated</Badge>
          </CardTitle>
          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Overall Assessment */}
          <Alert className="bg-white border-navy-300">
            <FileText className="w-4 h-4 text-navy-600" />
            <AlertDescription className="text-navy-900 font-medium">
              {summary.overall_assessment}
            </AlertDescription>
          </Alert>

          {/* Critical Actions */}
          {summary.critical_actions?.length > 0 && (
            <div className="bg-white rounded-lg border-2 border-red-300 p-4">
              <h3 className="font-semibold text-red-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Critical Actions Required
              </h3>
              <div className="space-y-2">
                {summary.critical_actions.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-red-50 rounded border border-red-200">
                    <span className="bg-red-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">
                      {idx + 1}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-red-900">{item.action}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge className="text-xs bg-orange-100 text-orange-800">
                          {item.urgency}
                        </Badge>
                        {item.impact && (
                          <span className="text-xs text-red-700">{item.impact}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Revenue Highlights */}
          {summary.revenue_highlights?.length > 0 && (
            <div className="bg-white rounded-lg border-2 border-green-300 p-4">
              <h3 className="font-semibold text-green-900 mb-3 flex items-center gap-2">
                <DollarSign className="w-4 h-4" />
                Revenue Optimization
              </h3>
              <div className="space-y-2">
                {summary.revenue_highlights.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-green-50 rounded border border-green-200">
                    <TrendingUp className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm text-green-900">{item.opportunity}</p>
                      {item.value && (
                        <Badge className="text-xs bg-green-600 text-white mt-1">
                          {item.value}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Compliance Risks */}
          {summary.compliance_risks?.length > 0 && (
            <div className="bg-white rounded-lg border-2 border-orange-300 p-4">
              <h3 className="font-semibold text-orange-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4" />
                Compliance Risks
              </h3>
              <div className="space-y-2">
                {summary.compliance_risks.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-2 bg-orange-50 rounded border border-orange-200">
                    <span className="text-orange-600 flex-shrink-0 mt-0.5">⚠️</span>
                    <div className="flex-1">
                      <p className="text-sm text-orange-900">{item.risk}</p>
                      <Badge className={`text-xs mt-1 ${
                        item.severity === 'high' ? 'bg-red-100 text-red-800' :
                        item.severity === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-blue-100 text-blue-800'
                      }`}>
                        {item.severity} severity
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom Line */}
          <Alert className="bg-gradient-to-r from-indigo-50 to-navy-50 border-indigo-300">
            <CheckCircle2 className="w-4 h-4 text-indigo-600" />
            <AlertDescription>
              <p className="text-sm font-semibold text-indigo-900">Bottom Line:</p>
              <p className="text-sm text-indigo-800 mt-1">{summary.bottom_line}</p>
            </AlertDescription>
          </Alert>
        </CardContent>
      )}
    </Card>
  );
}