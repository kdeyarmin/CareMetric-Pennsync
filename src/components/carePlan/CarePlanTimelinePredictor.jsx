import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Clock,
  TrendingUp,
  TrendingDown,
  Target,
  Calendar,
  RefreshCw,
  AlertTriangle,
  Sparkles
} from "lucide-react";
import { isValid } from "date-fns";
import { toast } from 'sonner';

export default function CarePlanTimelinePredictor({ patient, carePlans }) {
  const [predictions, setPredictions] = useState(null);
  const ai = useAICall();

  const { data: visits } = useQuery({
    queryKey: ['visitsForPrediction', patient?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient.id, status: 'completed' }, '-visit_date', 20),
    enabled: !!patient?.id,
    initialData: [],
  });

  const activeCarePlans = (carePlans || []).filter(cp => cp.status === 'active');

  const analyzeTimelines = async () => {
    if (!patient || activeCarePlans.length === 0) {
      toast.error('No active care plans to analyze');
      return;
    }

    try {
      const visitTrends = visits.slice(0, 10).map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs,
        notes_excerpt: v.nurse_notes?.substring(0, 200)
      }));

      const carePlanData = activeCarePlans.map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        target_date: cp.target_date,
        baseline: cp.baseline_measurement,
        created: cp.created_date
      }));

      const prompt = `You are a clinical outcomes analyst predicting care plan goal achievement timelines.

PATIENT:
- Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}
- Secondary conditions: ${patient.secondary_diagnoses?.join(', ') || 'None'}

ACTIVE CARE PLANS:
${JSON.stringify(carePlanData, null, 2)}

RECENT VISIT DATA (for trend analysis):
${JSON.stringify(visitTrends, null, 2)}

For each active care plan, predict:
1. Likelihood of achieving the goal (percentage)
2. Predicted achievement date
3. Key factors affecting timeline
4. Recommendations to accelerate progress

Return JSON:
{
  "predictions": [
    {
      "problem": "The care plan problem",
      "current_progress_percent": 0-100,
      "likelihood_of_achievement": 0-100,
      "predicted_achievement_date": "YYYY-MM-DD",
      "days_ahead_or_behind": positive if ahead of schedule negative if behind,
      "trend": "improving|stable|declining",
      "key_factors": ["Factor 1", "Factor 2"],
      "barriers": ["Barrier 1"],
      "accelerators": ["Recommendation to speed progress"]
    }
  ],
  "overall_prognosis": "Summary of overall care plan trajectory",
  "high_risk_goals": ["Goals at risk of not being met"]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            predictions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  problem: { type: "string" },
                  current_progress_percent: { type: "number" },
                  likelihood_of_achievement: { type: "number" },
                  predicted_achievement_date: { type: "string" },
                  days_ahead_or_behind: { type: "number" },
                  trend: { type: "string" },
                  key_factors: { type: "array", items: { type: "string" } },
                  barriers: { type: "array", items: { type: "string" } },
                  accelerators: { type: "array", items: { type: "string" } }
                }
              }
            },
            overall_prognosis: { type: "string" },
            high_risk_goals: { type: "array", items: { type: "string" } }
          }
        }
      });

      setPredictions(result);
    } catch (error) {
      console.error('Error analyzing timelines:', error);
      toast.error('Failed to analyze timelines. Please try again.');
    }
  };

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-4 h-4 text-green-600" />;
      case 'declining': return <TrendingDown className="w-4 h-4 text-red-600" />;
      default: return <Target className="w-4 h-4 text-blue-600" />;
    }
  };

  const getLikelihoodColor = (likelihood) => {
    if (likelihood >= 80) return 'bg-green-500';
    if (likelihood >= 60) return 'bg-yellow-500';
    if (likelihood >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (!patient) return null;

  return (
    <Card className="border-blue-200">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-600" />
            Goal Achievement Predictor
          </CardTitle>
          <Button
            onClick={analyzeTimelines}
            disabled={ai.loading || activeCarePlans.length === 0}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
          >
            {ai.loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Predict Timelines
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {activeCarePlans.length === 0 && (
          <div className="text-center py-6 text-slate-500">
            <Target className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">No active care plans to analyze</p>
          </div>
        )}

        {activeCarePlans.length > 0 && !predictions && !ai.loading && (
          <div className="text-center py-6 text-slate-500">
            <Calendar className="w-10 h-10 text-slate-300 mx-auto mb-2" />
            <p className="text-sm">Click to predict goal achievement timelines for {activeCarePlans.length} active care plan(s)</p>
          </div>
        )}

        {predictions && (
          <div className="space-y-4">
            {/* Overall Prognosis */}
            <Alert className="bg-blue-50 border-blue-200">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <AlertDescription className="text-blue-900">
                <strong>Overall Prognosis:</strong> {predictions.overall_prognosis}
              </AlertDescription>
            </Alert>

            {/* High Risk Goals */}
            {predictions.high_risk_goals?.length > 0 && (
              <Alert className="bg-red-50 border-red-200">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-900">
                  <strong>Goals at Risk:</strong>
                  <ul className="list-disc ml-5 text-sm mt-1">
                    {predictions.high_risk_goals.map((goal, idx) => (
                      <li key={idx}>{goal}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Individual Predictions */}
            <div className="space-y-3">
              {predictions.predictions?.map((pred, idx) => (
                <Card key={idx} className="border border-slate-200">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        {getTrendIcon(pred.trend)}
                        <h4 className="font-semibold text-slate-900 text-sm">{pred.problem}</h4>
                      </div>
                      <Badge className={getLikelihoodColor(pred.likelihood_of_achievement)}>
                        {pred.likelihood_of_achievement}% likely
                      </Badge>
                    </div>

                    {/* Progress Bar */}
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-slate-600 mb-1">
                        <span>Current Progress</span>
                        <span>{pred.current_progress_percent}%</span>
                      </div>
                      <Progress value={pred.current_progress_percent} className="h-2" />
                    </div>

                    {/* Timeline Info */}
                    <div className="flex flex-wrap gap-3 text-xs mb-3">
                      <div className="flex items-center gap-1">
                       <Calendar className="w-3 h-3 text-slate-500" />
                       <span>Predicted: {pred.predicted_achievement_date && isValid(new Date(pred.predicted_achievement_date)) ? pred.predicted_achievement_date : 'N/A'}</span>
                      </div>
                      <Badge variant="outline" className={
                        pred.days_ahead_or_behind > 0 ? 'border-green-300 text-green-700' :
                        pred.days_ahead_or_behind < 0 ? 'border-red-300 text-red-700' :
                        'border-slate-300 text-slate-700'
                      }>
                        {pred.days_ahead_or_behind > 0 ? `${pred.days_ahead_or_behind} days ahead` :
                         pred.days_ahead_or_behind < 0 ? `${Math.abs(pred.days_ahead_or_behind)} days behind` :
                         'On track'}
                      </Badge>
                    </div>

                    {/* Factors */}
                    {pred.key_factors?.length > 0 && (
                      <div className="mb-2">
                        <p className="text-xs font-medium text-slate-600 mb-1">Key Factors:</p>
                        <div className="flex flex-wrap gap-1">
                          {pred.key_factors.map((factor, i) => (
                            <Badge key={i} variant="outline" className="text-xs">{factor}</Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Accelerators */}
                    {pred.accelerators?.length > 0 && (
                      <div className="p-2 bg-green-50 rounded-lg">
                        <p className="text-xs font-medium text-green-700 mb-1">💡 To Accelerate Progress:</p>
                        <ul className="list-disc ml-4 text-xs text-green-800">
                          {pred.accelerators.map((acc, i) => (
                            <li key={i}>{acc}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}