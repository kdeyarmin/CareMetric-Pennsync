import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, Brain, AlertTriangle, TrendingUp, Activity } from "lucide-react";

export default function AdverseEventPredictor({ 
  patientId, 
  autoRun = false,
  onPredictionComplete,
  compact = false 
}) {
  const [isPredicting, setIsPredicting] = useState(false);
  const [prediction, setPrediction] = useState(null);
  const [hasRun, setHasRun] = useState(false);

  useEffect(() => {
    if (autoRun && patientId && !hasRun && !isPredicting) {
      runPrediction();
    }
  }, [autoRun, patientId, hasRun]);

  const runPrediction = async () => {
    if (!patientId || isPredicting) return;

    setIsPredicting(true);
    try {
      const result = await base44.functions.invoke('predictAdverseEvents', {
        patient_id: patientId,
        trigger_source: 'manual_trigger'
      });

      setPrediction(result);
      setHasRun(true);
      onPredictionComplete?.(result);
    } catch (error) {
      console.error('Prediction error:', error);
      setPrediction({ error: error.message });
    }
    setIsPredicting(false);
  };

  if (compact && !prediction) return null;

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-pink-50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Brain className="w-5 h-5 text-purple-600" />
          AI Adverse Event Prediction
          {prediction?.new_alerts_created > 0 && (
            <Badge className="bg-red-600 text-white ml-auto">
              {prediction.new_alerts_created} New Alerts
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isPredicting ? (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 mx-auto mb-3 text-purple-600 animate-spin" />
            <p className="text-sm text-gray-600">Analyzing patient data for adverse event risks...</p>
            <p className="text-xs text-gray-500 mt-1">
              Checking vitals, history, medications, and visit patterns
            </p>
          </div>
        ) : prediction?.error ? (
          <Alert className="bg-red-50 border-red-200">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">
              {prediction.error}
            </AlertDescription>
          </Alert>
        ) : prediction?.success ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-blue-100 p-3 rounded-lg text-center">
                <p className="text-xs text-blue-600 mb-1">Risks Analyzed</p>
                <p className="text-2xl font-bold text-blue-900">
                  {prediction.predictions_analyzed}
                </p>
              </div>
              <div className="bg-green-100 p-3 rounded-lg text-center">
                <p className="text-xs text-green-600 mb-1">New Alerts</p>
                <p className="text-2xl font-bold text-green-900">
                  {prediction.new_alerts_created}
                </p>
              </div>
            </div>

            {prediction.new_alerts_created > 0 && (
              <Alert className="bg-green-50 border-green-200">
                <Activity className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-sm text-green-800">
                  <strong>Proactive alerts created!</strong>
                  <br />
                  Check the Patient Alerts section for detailed recommendations and interventions.
                </AlertDescription>
              </Alert>
            )}

            {prediction.new_alerts_created === 0 && prediction.predictions_analyzed > 0 && (
              <Alert className="bg-blue-50 border-blue-200">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-800">
                  No new risks detected. Patient risk profile stable.
                </AlertDescription>
              </Alert>
            )}
          </div>
        ) : (
          <div className="text-center py-4">
            <Brain className="w-12 h-12 mx-auto mb-3 text-purple-400" />
            <p className="text-sm text-gray-600 mb-3">
              Run AI analysis to predict potential adverse events
            </p>
            <Button
              onClick={runPrediction}
              className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
            >
              <Brain className="w-4 h-4 mr-2" />
              Predict Adverse Events
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}