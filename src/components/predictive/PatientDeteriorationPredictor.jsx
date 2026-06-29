import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { 
  TrendingDown, 
  AlertTriangle, 
  Activity, 
  Loader2,
  ChevronDown,
  ChevronUp,
  Brain
} from "lucide-react";

export default function PatientDeteriorationPredictor({ patientId, recentVisits, autoAnalyze = false }) {
  const ai = useAICall();
  const [analysis, setAnalysis] = useState(null);
  const [showDetails, setShowDetails] = useState(false);

  const analyzeDeteriorationRisk = useCallback(async () => {
    if (!recentVisits || recentVisits.length < 2) return;

    try {
      // Extract vital signs trends
      const vitalTrends = recentVisits
        .filter(v => v.vital_signs)
        .map(v => ({
          date: v.visit_date,
          bp_systolic: v.vital_signs.blood_pressure_systolic,
          bp_diastolic: v.vital_signs.blood_pressure_diastolic,
          hr: v.vital_signs.heart_rate,
          temp: v.vital_signs.temperature,
          o2: v.vital_signs.oxygen_saturation,
          pain: v.vital_signs.pain_level
        }));

      const noteSummaries = recentVisits
        .filter(v => v.nurse_notes)
        .map(v => v.nurse_notes.substring(0, 500))
        .join('\n---\n');

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a clinical deterioration risk analyst. Analyze this patient's vital signs trends and visit notes to predict deterioration risk.

VITAL SIGNS TRENDS (most recent last):
${JSON.stringify(vitalTrends, null, 2)}

RECENT VISIT NOTES:
${noteSummaries}

Analyze for:
1. Vital signs trending in concerning directions (BP rising/falling, O2 declining, HR trending up)
2. Patterns suggesting decompensation (worsening edema, SOB, weakness)
3. Symptoms indicating clinical decline
4. Early warning signs from documentation

Return a deterioration risk assessment with:
- risk_score: 0-100 (higher = more concerning)
- risk_level: "low", "moderate", "high", "critical"
- trending_worse: boolean
- key_concerns: array of specific concerns with evidence
- vital_trends: object describing concerning vital trends
- recommended_actions: immediate actions to take
- monitoring_frequency: how often to reassess
- physician_notification: boolean (should MD be called)`,
        response_json_schema: {
          type: "object",
          properties: {
            risk_score: { type: "number" },
            risk_level: { type: "string" },
            trending_worse: { type: "boolean" },
            key_concerns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  concern: { type: "string" },
                  evidence: { type: "string" },
                  severity: { type: "string" }
                }
              }
            },
            vital_trends: {
              type: "object",
              properties: {
                blood_pressure: { type: "string" },
                heart_rate: { type: "string" },
                oxygen_saturation: { type: "string" },
                temperature: { type: "string" }
              }
            },
            recommended_actions: { type: "array", items: { type: "string" } },
            monitoring_frequency: { type: "string" },
            physician_notification: { type: "boolean" },
            clinical_summary: { type: "string" }
          }
        }
      });

      setAnalysis(result);
    } catch (error) {
      console.error('Deterioration analysis error:', error);
      setAnalysis({ error: error.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [recentVisits]);

  useEffect(() => {
    if (autoAnalyze && recentVisits?.length >= 2) {
      analyzeDeteriorationRisk();
    }
  }, [autoAnalyze, patientId, recentVisits, analyzeDeteriorationRisk]);

  if (!recentVisits || recentVisits.length < 2) {
    return (
      <Alert className="bg-slate-50 border-slate-200">
        <AlertDescription className="text-sm text-slate-600">
          Need at least 2 visits with vital signs to analyze deterioration trends
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="border-2 border-orange-300">
      <CardHeader className="bg-gradient-to-r from-orange-50 to-red-50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-orange-600" />
          AI Deterioration Risk Analysis
          {analysis && !analysis.error && (
            <Badge className={`ml-auto ${
              analysis.risk_level === 'critical' ? 'bg-red-600' :
              analysis.risk_level === 'high' ? 'bg-orange-600' :
              analysis.risk_level === 'moderate' ? 'bg-yellow-600' :
              'bg-green-600'
            }`}>
              {analysis.risk_level?.toUpperCase()}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!analysis && !ai.loading && (
          <Button
            onClick={analyzeDeteriorationRisk}
            className="w-full bg-orange-600 hover:bg-orange-700"
          >
            <Brain className="w-4 h-4 mr-2" />
            Analyze Deterioration Risk
          </Button>
        )}

        {ai.loading && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 text-orange-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-600">Analyzing vital trends and clinical notes...</p>
          </div>
        )}

        {analysis && !analysis.error && (
          <>
            {/* Risk Score */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Risk Score</span>
                <span className="text-2xl font-bold text-orange-600">{analysis.risk_score}/100</span>
              </div>
              <Progress value={analysis.risk_score} className="h-3" />
            </div>

            {/* Clinical Summary */}
            {analysis.clinical_summary && (
              <Alert className={`${
                analysis.risk_level === 'critical' || analysis.risk_level === 'high'
                  ? 'bg-red-50 border-red-300'
                  : 'bg-yellow-50 border-yellow-300'
              }`}>
                <Activity className="w-4 h-4" />
                <AlertDescription className="text-sm">
                  {analysis.clinical_summary}
                </AlertDescription>
              </Alert>
            )}

            {/* Physician Notification Alert */}
            {analysis.physician_notification && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-sm text-red-900">
                  <p className="font-semibold">⚠️ PHYSICIAN NOTIFICATION RECOMMENDED</p>
                  <p className="mt-1">Clinical deterioration indicators warrant MD contact</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Key Concerns */}
            {analysis.key_concerns?.length > 0 && (
              <div>
                <p className="text-sm font-semibold mb-2">Key Concerns ({analysis.key_concerns.length})</p>
                <div className="space-y-2">
                  {analysis.key_concerns.map((concern, idx) => (
                    <div key={idx} className={`p-3 rounded-lg border ${
                      concern.severity === 'high' ? 'bg-red-50 border-red-200' :
                      concern.severity === 'medium' ? 'bg-yellow-50 border-yellow-200' :
                      'bg-blue-50 border-blue-200'
                    }`}>
                      <p className="text-sm font-medium">{concern.concern}</p>
                      <p className="text-xs text-slate-600 mt-1">{concern.evidence}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Expandable Details */}
            <div>
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? <ChevronUp className="w-4 h-4 mr-2" /> : <ChevronDown className="w-4 h-4 mr-2" />}
                {showDetails ? 'Hide' : 'Show'} Detailed Analysis
              </Button>

              {showDetails && (
                <div className="mt-3 space-y-3">
                  {/* Vital Trends */}
                  {analysis.vital_trends && (
                    <div className="p-3 bg-slate-50 rounded-lg border">
                      <p className="text-xs font-semibold text-slate-700 mb-2">Vital Signs Trends</p>
                      {Object.entries(analysis.vital_trends).map(([vital, trend]) => (
                        <div key={vital} className="text-xs">
                          <span className="font-medium capitalize">{vital.replace('_', ' ')}:</span> {trend}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Recommended Actions */}
                  {analysis.recommended_actions?.length > 0 && (
                    <div className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-xs font-semibold text-blue-900 mb-2">Recommended Actions</p>
                      <ul className="text-xs space-y-1">
                        {analysis.recommended_actions.map((action, idx) => (
                          <li key={idx}>• {action}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Monitoring Frequency */}
                  {analysis.monitoring_frequency && (
                    <div className="p-3 bg-navy-50 rounded-lg border border-navy-200">
                      <p className="text-xs font-semibold text-navy-900">Monitoring Frequency</p>
                      <p className="text-xs text-navy-800 mt-1">{analysis.monitoring_frequency}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {analysis?.error && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">
              Analysis failed: {analysis.error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}