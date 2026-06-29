import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, Send, CheckCircle2, Loader2 } from "lucide-react";

export default function OASISToPatientChartPusher({ 
  analysisResults, 
  _pdgmData, 
  patientId,
  oasisUploadId,
  predictions 
}) {
  const [selectedRecs, setSelectedRecs] = useState([]);
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushedCount, setPushedCount] = useState(0);
  const [pushError, setPushError] = useState(null);
  const queryClient = useQueryClient();

  const createRecommendationMutation = useMutation({
    mutationFn: (data) => base44.entities.PatientRecommendation.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientRecommendations', patientId] });
    },
  });

  // Generate recommendations from analysis
  const generateRecommendations = () => {
    const recs = [];

    // From compliance concerns
    analysisResults.compliance_concerns?.forEach((concern, idx) => {
      recs.push({
        id: `compliance-${idx}`,
        type: 'compliance',
        title: `Address ${concern.area}`,
        description: concern.issue,
        priority: concern.severity === 'high' ? 'high' : concern.severity === 'medium' ? 'medium' : 'low',
        rationale: concern.recommendation,
        impact: 'Improves compliance score and reduces audit risk',
        steps: [concern.recommendation]
      });
    });

    // From revenue tips
    analysisResults.revenue_tips?.forEach((tip, idx) => {
      recs.push({
        id: `revenue-${idx}`,
        type: 'revenue_optimization',
        title: `Revenue Opportunity: ${tip.category}`,
        description: tip.opportunity,
        priority: tip.potential_impact === 'high' ? 'high' : 'medium',
        rationale: tip.specific_action,
        impact: tip.potential_impact,
        steps: [tip.specific_action]
      });
    });

    // From documentation improvements
    analysisResults.documentation_improvements?.forEach((imp, idx) => {
      recs.push({
        id: `doc-${idx}`,
        type: 'documentation',
        title: `Improve Documentation: ${imp.item}`,
        description: `Current: ${imp.current_state}`,
        priority: 'medium',
        rationale: imp.rationale,
        impact: imp.improved_state,
        steps: imp.exact_text_to_add ? [imp.exact_text_to_add] : ['Review and update documentation']
      });
    });

    // From predictions
    if (predictions?.proactive_recommendations) {
      predictions.proactive_recommendations.forEach((pred, idx) => {
        recs.push({
          id: `pred-${idx}`,
          type: pred.category === 'clinical' ? 'clinical_action' : 
                pred.category === 'care_plan' ? 'care_plan' :
                pred.category === 'risk' ? 'risk_mitigation' : 'functional_goal',
          title: pred.recommendation,
          description: pred.rationale,
          priority: pred.priority,
          rationale: pred.expected_impact,
          impact: pred.expected_impact,
          steps: pred.success_indicators || []
        });
      });
    }

    // From early warning signals
    if (predictions?.early_warning_signals) {
      predictions.early_warning_signals.forEach((signal, idx) => {
        recs.push({
          id: `warning-${idx}`,
          type: 'risk_mitigation',
          title: `Early Warning: ${signal.signal}`,
          description: signal.action_needed,
          priority: signal.severity === 'critical' ? 'critical' : 'high',
          rationale: `Early intervention needed within ${signal.timeframe}`,
          impact: 'Prevents adverse outcomes',
          steps: [signal.action_needed]
        });
      });
    }

    return recs;
  };

  const recommendations = generateRecommendations();

  const toggleRecommendation = (recId) => {
    setSelectedRecs(prev => 
      prev.includes(recId) ? prev.filter(id => id !== recId) : [...prev, recId]
    );
  };

  const pushToPatientChart = async () => {
    if (!patientId || selectedRecs.length === 0) return;

    setIsPushing(true);
    setPushError(null);

    const recsToCreate = recommendations.filter(rec => selectedRecs.includes(rec.id));
    const failedTitles = [];

    // Create each recommendation independently so one failure doesn't abort the
    // rest, and so a partial push is reported instead of silently swallowed.
    for (const rec of recsToCreate) {
      try {
        await createRecommendationMutation.mutateAsync({
          patient_id: patientId,
          source_type: 'oasis_analysis',
          source_id: oasisUploadId,
          recommendation_type: rec.type,
          title: rec.title,
          description: rec.description,
          priority: rec.priority,
          ai_rationale: rec.rationale,
          expected_impact: rec.impact,
          implementation_steps: rec.steps,
          suggested_by_user: 'AI Assistant',
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
        });
      } catch (error) {
        console.error("Error pushing recommendation:", error);
        failedTitles.push(rec.title);
      }
    }

    const succeeded = recsToCreate.length - failedTitles.length;
    setPushedCount(succeeded);

    if (failedTitles.length > 0) {
      setPushError(`${succeeded} of ${recsToCreate.length} added. ${failedTitles.length} failed — please retry the remaining items.`);
      // Keep only the failed items selected so the user can retry just those.
      const failedIds = recommendations.filter(r => failedTitles.includes(r.title)).map(r => r.id);
      setSelectedRecs(failedIds);
    } else {
      setSelectedRecs([]);
    }

    if (succeeded > 0) {
      setPushSuccess(true);
      setTimeout(() => setPushSuccess(false), 3000);
    }
    setIsPushing(false);
  };

  if (!patientId || recommendations.length === 0) return null;

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-blue-600" />
            Push to Patient Chart
          </CardTitle>
          <Badge variant="outline">
            {selectedRecs.length} selected
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <p className="text-sm text-slate-600 mb-4">
          Select AI-generated recommendations to add to the patient's chart as suggested actions
        </p>

        <div className="space-y-2 mb-4 max-h-96 overflow-y-auto">
          {recommendations.map((rec) => (
            <div
              key={rec.id}
              className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                selectedRecs.includes(rec.id)
                  ? 'bg-blue-50 border-blue-300'
                  : 'bg-white border-slate-200 hover:border-blue-200'
              }`}
              onClick={() => toggleRecommendation(rec.id)}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={selectedRecs.includes(rec.id)}
                  onCheckedChange={() => toggleRecommendation(rec.id)}
                  className="mt-1"
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-semibold text-slate-900 text-sm">{rec.title}</p>
                    <Badge className={
                      rec.priority === 'critical' ? 'bg-red-600' :
                      rec.priority === 'high' ? 'bg-orange-500' :
                      rec.priority === 'medium' ? 'bg-yellow-500' :
                      'bg-blue-500'
                    }>
                      {rec.priority}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600 mb-1">{rec.description}</p>
                  <Badge variant="outline" className="text-xs">{(rec.type || '').replace(/_/g, ' ')}</Badge>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedRecs(recommendations.map(r => r.id))}
          >
            Select All ({recommendations.length})
          </Button>
          <Button
            onClick={pushToPatientChart}
            disabled={selectedRecs.length === 0 || isPushing}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isPushing ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Pushing...</>
            ) : pushSuccess ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Pushed!</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Push {selectedRecs.length} to Chart</>
            )}
          </Button>
        </div>

        {pushSuccess && (
          <Alert className="bg-green-50 border-green-200 mt-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Successfully pushed {pushedCount} recommendation{pushedCount === 1 ? '' : 's'} to patient chart
            </AlertDescription>
          </Alert>
        )}

        {pushError && (
          <Alert variant="destructive" className="mt-3">
            <AlertDescription>{pushError}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}