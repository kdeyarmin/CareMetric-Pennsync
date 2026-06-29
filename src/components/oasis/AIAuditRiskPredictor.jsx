import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Eye,
  Loader2,
  ChevronDown,
  ChevronUp,
  Target,
  FileWarning,
  CheckCircle2
} from "lucide-react";

export default function AIAuditRiskPredictor({ analysisResults, patientId }) {
  const [prediction, setPrediction] = useState(null);
  const ai = useAICall();
  const [expanded, setExpanded] = useState(false);

  // Fetch historical audits for pattern analysis
  const { data: historicalAudits = [] } = useQuery({
    queryKey: ['historicalAudits'],
    queryFn: () => base44.entities.OASISAudit.list('-created_date', 50),
  });

  // Fetch patient's previous OASIS uploads
  const { data: patientOASIS = [] } = useQuery({
    queryKey: ['patientOASISHistory', patientId],
    queryFn: () => patientId ? base44.entities.OASISUpload.filter({ patient_id: patientId }, '-created_date', 10) : [],
    enabled: !!patientId
  });

  const runPrediction = useCallback(async () => {
    if (!analysisResults) return;

    try {
      // Build historical context
      const auditPatterns = historicalAudits.slice(0, 20).map(a => ({
        flag_reason: a.flag_reason,
        accuracy: a.accuracy_score,
        compliance: a.compliance_score,
        status: a.status
      }));

      const patientHistory = patientOASIS.slice(0, 5).map(o => ({
        scores: o.scores,
        assessment_type: o.assessment_type,
        date: o.assessment_date
      }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert in home health audit risk prediction. Based on the current OASIS analysis and historical patterns, predict future audit risks and provide actionable recommendations.

CURRENT ANALYSIS:
- Overall Score: ${analysisResults.overall_score}%
- Accuracy Score: ${analysisResults.accuracy_score}%
- Compliance Score: ${analysisResults.compliance_score}%
- Revenue Optimization: ${analysisResults.revenue_optimization_score}%
- Accuracy Issues: ${analysisResults.accuracy_issues?.length || 0}
- Compliance Concerns: ${analysisResults.compliance_concerns?.length || 0}
- Audit Risk Areas: ${JSON.stringify(analysisResults.audit_risk_areas || [])}

HISTORICAL AUDIT PATTERNS (agency-wide):
${JSON.stringify(auditPatterns, null, 2)}

PATIENT'S OASIS HISTORY:
${JSON.stringify(patientHistory, null, 2)}

Analyze and predict:
1. Overall audit risk probability (0-100%)
2. Specific future risks based on current documentation patterns
3. Trending patterns (improving, stable, declining)
4. High-priority items that will likely trigger audits
5. Preventive actions to reduce risk

Return JSON:
{
  "overall_risk_score": 0-100,
  "risk_level": "low|moderate|high|critical",
  "audit_probability": "Likelihood of being selected for audit",
  "trend": "improving|stable|declining",
  "trend_explanation": "Why the trend is moving this direction",
  "future_risks": [
    {
      "risk": "Specific risk description",
      "probability": "high|medium|low",
      "timeframe": "When this could become an issue",
      "trigger": "What would cause this to be flagged",
      "prevention": "How to prevent this"
    }
  ],
  "pattern_insights": [
    {
      "pattern": "Observed pattern",
      "implication": "What this means for audits",
      "recommendation": "What to do about it"
    }
  ],
  "high_priority_items": ["Items most likely to trigger audit"],
  "preventive_actions": [
    {
      "action": "Specific action to take",
      "impact": "How much this reduces risk",
      "urgency": "immediate|soon|ongoing"
    }
  ],
  "comparison_to_peers": "How this compares to typical documentation",
  "six_month_outlook": "Prediction for next 6 months if current patterns continue"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number" },
            risk_level: { type: "string" },
            audit_probability: { type: "string" },
            trend: { type: "string" },
            trend_explanation: { type: "string" },
            future_risks: { type: "array", items: { type: "object" } },
            pattern_insights: { type: "array", items: { type: "object" } },
            high_priority_items: { type: "array", items: { type: "string" } },
            preventive_actions: { type: "array", items: { type: "object" } },
            comparison_to_peers: { type: "string" },
            six_month_outlook: { type: "string" }
          }
        }
      });

      setPrediction(result);
    } catch (error) {
      console.error("Error predicting audit risk:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [analysisResults, historicalAudits, patientOASIS]);

  useEffect(() => {
    if (analysisResults && !prediction) {
      runPrediction();
    }
  }, [analysisResults, prediction, runPrediction]);

  const getRiskColor = (level) => {
    switch (level) {
      case 'critical': return { bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-300' };
      case 'high': return { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-300' };
      case 'moderate': return { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-300' };
      case 'low': return { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-300' };
      default: return { bg: 'bg-slate-100', text: 'text-slate-800', border: 'border-slate-300' };
    }
  };

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <Target className="w-4 h-4 text-yellow-600" />;
    }
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-amber-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-amber-50 to-orange-50">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye className="w-5 h-5 text-amber-600" />
            AI Audit Risk Predictor
          </div>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        {ai.loading ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-amber-500" />
            <p className="text-sm text-slate-500 mt-2">Analyzing audit risk patterns...</p>
          </div>
        ) : prediction ? (
          <div className="space-y-4">
            {/* Risk Score Summary */}
            <div className={`p-4 rounded-lg border-2 ${getRiskColor(prediction.risk_level).bg} ${getRiskColor(prediction.risk_level).border}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Shield className={`w-6 h-6 ${getRiskColor(prediction.risk_level).text}`} />
                  <div>
                    <p className="text-xs text-slate-600">Predicted Audit Risk</p>
                    <p className={`text-xl font-bold ${getRiskColor(prediction.risk_level).text}`}>
                      {prediction.risk_level?.toUpperCase()} RISK
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-3xl font-bold ${getRiskColor(prediction.risk_level).text}`}>
                    {prediction.overall_risk_score}%
                  </p>
                  <div className="flex items-center gap-1 justify-end">
                    {getTrendIcon(prediction.trend)}
                    <span className="text-xs text-slate-600 capitalize">{prediction.trend}</span>
                  </div>
                </div>
              </div>
              <Progress value={prediction.overall_risk_score} className="h-2" />
              <p className="text-xs text-slate-600 mt-2">{prediction.audit_probability}</p>
            </div>

            {/* Trend Explanation */}
            <div className="flex items-start gap-2 p-2 bg-slate-50 rounded border">
              {getTrendIcon(prediction.trend)}
              <p className="text-sm text-slate-700">{prediction.trend_explanation}</p>
            </div>

            {expanded && (
              <>
                {/* High Priority Items */}
                {prediction.high_priority_items?.length > 0 && (
                  <div className="bg-red-50 p-3 rounded-lg border border-red-200">
                    <p className="text-sm font-semibold text-red-800 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4" />
                      High-Priority Audit Triggers
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {prediction.high_priority_items.map((item, idx) => (
                        <Badge key={idx} className="bg-red-100 text-red-800">{item}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Future Risks */}
                {prediction.future_risks?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-1">
                      <FileWarning className="w-4 h-4" />
                      Predicted Future Risks
                    </p>
                    <div className="space-y-2">
                      {prediction.future_risks.slice(0, 4).map((risk, idx) => (
                        <div key={idx} className="p-2 bg-white rounded border text-sm">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium">{risk.risk}</span>
                            <Badge className={
                              risk.probability === 'high' ? 'bg-red-500' :
                              risk.probability === 'medium' ? 'bg-yellow-500' : 'bg-green-500'
                            }>{risk.probability}</Badge>
                          </div>
                          <p className="text-xs text-slate-600">Timeframe: {risk.timeframe}</p>
                          <p className="text-xs text-green-700 mt-1">Prevention: {risk.prevention}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Preventive Actions */}
                {prediction.preventive_actions?.length > 0 && (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <p className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4" />
                      Preventive Actions
                    </p>
                    <div className="space-y-2">
                      {prediction.preventive_actions.map((action, idx) => (
                        <div key={idx} className="flex items-start gap-2 bg-white p-2 rounded border">
                          <Badge className={
                            action.urgency === 'immediate' ? 'bg-red-600 text-white' :
                            action.urgency === 'soon' ? 'bg-yellow-600 text-white' : 'bg-blue-600 text-white'
                          } variant="outline">{action.urgency}</Badge>
                          <div className="flex-1">
                            <p className="text-sm text-slate-800">{action.action}</p>
                            <p className="text-xs text-green-700">Impact: {action.impact}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Pattern Insights */}
                {prediction.pattern_insights?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Pattern Insights</p>
                    {prediction.pattern_insights.map((insight, idx) => (
                      <div key={idx} className="p-2 bg-indigo-50 rounded border border-indigo-200 mb-2">
                        <p className="text-sm font-medium text-indigo-800">{insight.pattern}</p>
                        <p className="text-xs text-indigo-700 mt-1">{insight.implication}</p>
                        <p className="text-xs text-green-700 mt-1">→ {insight.recommendation}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* 6-Month Outlook */}
                {prediction.six_month_outlook && (
                  <Alert className="bg-blue-50 border-blue-200">
                    <Eye className="w-4 h-4 text-blue-600" />
                    <AlertDescription className="text-blue-800">
                      <strong>6-Month Outlook:</strong> {prediction.six_month_outlook}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Peer Comparison */}
                {prediction.comparison_to_peers && (
                  <p className="text-xs text-slate-500 text-center italic">
                    {prediction.comparison_to_peers}
                  </p>
                )}
              </>
            )}

            <Button variant="outline" size="sm" onClick={runPrediction} className="w-full">
              <Eye className="w-3 h-3 mr-1" /> Refresh Prediction
            </Button>
          </div>
        ) : (
          <div className="text-center py-4">
            <Button onClick={runPrediction}>
              <Eye className="w-4 h-4 mr-2" /> Analyze Audit Risk
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}