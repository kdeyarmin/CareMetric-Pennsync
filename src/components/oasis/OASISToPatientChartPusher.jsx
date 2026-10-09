import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowRight, Send, CheckCircle2, Loader2 } from "lucide-react";
import { manageOASISRecords, oasisClientKey } from "@/functions/manageOASISRecords";

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);

/**
 * Turn selected documentation findings into follow-up tasks on the patient's
 * chart. These used to be written as PatientRecommendation rows — an entity no
 * screen reads — so a "pushed" recommendation went nowhere. They now become
 * Tasks assigned to the clinician, created by the OASIS record broker only after
 * it confirms the clinician may open this chart, and keyed per finding so a
 * second click files nothing new.
 */
export default function OASISToPatientChartPusher({
  analysisResults,
  patientId,
  analysisId,
}) {
  const [selectedRecs, setSelectedRecs] = useState([]);
  const [isPushing, setIsPushing] = useState(false);
  const [pushSuccess, setPushSuccess] = useState(false);
  const [pushedCount, setPushedCount] = useState(0);
  const [pushError, setPushError] = useState(null);
  const queryClient = useQueryClient();

  // Generate recommendations from analysis
  const generateRecommendations = () => {
    const recs = [];

    // From compliance concerns
    analysisResults?.compliance_concerns?.forEach((concern, idx) => {
      recs.push({
        id: `compliance-${idx}`,
        type: 'compliance',
        title: `Address ${concern.area}`,
        description: concern.issue,
        priority: concern.severity === 'high' ? 'high' : concern.severity === 'medium' ? 'medium' : 'low',
        rationale: concern.recommendation,
        steps: [concern.recommendation].filter(Boolean),
      });
    });

    // From documentation improvements
    analysisResults?.documentation_improvements?.forEach((imp, idx) => {
      recs.push({
        id: `doc-${idx}`,
        type: 'documentation',
        title: `Improve Documentation: ${imp.item}`,
        description: `Current: ${imp.current_state}`,
        priority: 'medium',
        rationale: imp.rationale,
        steps: imp.exact_text_to_add ? [imp.exact_text_to_add] : ['Review and update documentation'],
      });
    });

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
    try {
      const { results = [] } = await manageOASISRecords('create_tasks', {
        patient_id: patientId,
        tasks: recsToCreate.map((rec) => ({
          key: oasisClientKey('oasis-finding', patientId, analysisId, rec.id, rec.title),
          title: String(rec.title || 'OASIS documentation follow-up').slice(0, 200),
          description: [rec.description, rec.steps?.length ? `Steps:\n${rec.steps.map((step) => `• ${step}`).join('\n')}` : '']
            .filter(Boolean).join('\n\n'),
          type: 'document',
          priority: PRIORITIES.has(rec.priority) ? rec.priority : 'medium',
          ai_reason: rec.rationale || 'Found by the OASIS documentation analysis',
        })),
      });
      const failedTitles = recsToCreate
        .filter((rec, index) => !['created', 'existing'].includes(results[index]?.status))
        .map((rec) => rec.title);
      const succeeded = recsToCreate.length - failedTitles.length;
      setPushedCount(succeeded);
      if (failedTitles.length > 0) {
        setPushError(`${succeeded} of ${recsToCreate.length} added. ${failedTitles.length} failed — please retry the remaining items.`);
        const failedIds = recommendations.filter(r => failedTitles.includes(r.title)).map(r => r.id);
        setSelectedRecs(failedIds);
      } else {
        setSelectedRecs([]);
      }
      if (succeeded > 0) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        setPushSuccess(true);
        setTimeout(() => setPushSuccess(false), 3000);
      }
    } catch (error) {
      setPushError(error?.message || 'The tasks could not be created. Please try again.');
    } finally {
      setIsPushing(false);
    }
  };

  if (!patientId || recommendations.length === 0) return null;

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-gradient-to-r from-blue-50 to-navy-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ArrowRight className="w-5 h-5 text-blue-600" />
            Add Findings as Follow-up Tasks
          </CardTitle>
          <Badge variant="outline">
            {selectedRecs.length} selected
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <p className="text-sm text-slate-600 mb-4">
          Select documentation findings to add to your task list for this patient
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
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Adding...</>
            ) : pushSuccess ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Added!</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Add {selectedRecs.length} as Tasks</>
            )}
          </Button>
        </div>

        {pushSuccess && (
          <Alert className="bg-green-50 border-green-200 mt-3">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-800">
              Added {pushedCount} follow-up task{pushedCount === 1 ? '' : 's'} for this patient
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
