import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Brain, Tag, Loader2, CheckCircle2 } from "lucide-react";
import { hasSemanticTags, mergeAiTags } from "@/components/smartNote/compliance/reportingFields";

export default function AIAutoTagger() {
  const [isTagging, setIsTagging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const queryClient = useQueryClient();

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisitsForTagging'],
    queryFn: () => base44.entities.Visit.list('-created_date', 100),
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['allIncidentsForTagging'],
    queryFn: () => base44.entities.Incident.list('-created_date', 50),
    initialData: [],
  });

  const updateVisitMutation = useMutation({
    mutationFn: ({ id, tags }) => base44.entities.Visit.update(id, { ai_tags: tags }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allVisitsForTagging'] }),
  });

  const updateIncidentMutation = useMutation({
    mutationFn: ({ id, tags }) => base44.entities.Incident.update(id, { ai_tags: tags }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['allIncidentsForTagging'] }),
  });

  const autoTagAll = async () => {
    setIsTagging(true);
    setProgress(0);
    
    const totalItems = visits.length + incidents.length;
    let processed = 0;
    let tagged = { visits: 0, incidents: 0 };

    try {
      // Process visits in batches
      for (let i = 0; i < visits.length; i += 5) {
        const batch = visits.slice(i, i + 5);
        
        for (const visit of batch) {
          // Skip only when the visit already has *semantic* tags; a visit that
          // carries only SmartNote system tags (trend:/chart_flag:) still needs
          // clinical tagging, and the merge below preserves those system tags.
          if (!visit.nurse_notes || hasSemanticTags(visit.ai_tags)) {
            processed++;
            continue;
          }

          const prompt = `Analyze this clinical visit note and generate relevant tags for searchability and trend analysis.

VISIT NOTE:
${visit.nurse_notes.substring(0, 500)}...

Generate 3-7 specific tags covering:
- Clinical conditions (e.g., "wound_care", "chf_monitoring", "diabetes_management")
- Documentation quality (e.g., "compliant", "incomplete", "excellent")
- Patient status (e.g., "stable", "declining", "improving")
- Risk factors (e.g., "fall_risk", "medication_adherence", "hospitalization_risk")
- Care activities (e.g., "patient_education", "medication_review", "vital_monitoring")

Return as JSON array of lowercase strings with underscores: ["tag1", "tag2", ...]`;

          try {
            const tags = await invokeLLM({
              model: "claude_sonnet_4_6",
              prompt,
              response_json_schema: {
                type: "array",
                items: { type: "string" }
              }
            });

            await updateVisitMutation.mutateAsync({ id: visit.id, tags: mergeAiTags(visit.ai_tags, tags) });
            tagged.visits++;
          } catch (error) {
            console.error(`Error tagging visit ${visit.id}:`, error);
          }

          processed++;
          setProgress((processed / totalItems) * 100);
        }
      }

      // Process incidents
      for (const incident of incidents) {
        if (incident.ai_tags) {
          processed++;
          continue;
        }

        const prompt = `Analyze this incident and generate relevant tags for categorization and trend analysis.

INCIDENT TYPE: ${incident.incident_type}
SEVERITY: ${incident.severity}
DETAILS: ${JSON.stringify(incident.details || {})}
REPORT: ${incident.report?.substring(0, 300) || 'No report'}

Generate 3-5 specific tags covering:
- Incident category
- Root causes
- Contributing factors
- Follow-up needs
- Prevention opportunities

Return as JSON array of lowercase strings with underscores: ["tag1", "tag2", ...]`;

        try {
          const tags = await invokeLLM({
            model: "claude_sonnet_4_6",
            prompt,
            response_json_schema: {
              type: "array",
              items: { type: "string" }
            }
          });

          await updateIncidentMutation.mutateAsync({ id: incident.id, tags });
          tagged.incidents++;
        } catch (error) {
          console.error(`Error tagging incident ${incident.id}:`, error);
        }

        processed++;
        setProgress((processed / totalItems) * 100);
      }

      setResults(tagged);
    } catch (error) {
      console.error("Error in auto-tagging:", error);
    }
    
    setIsTagging(false);
  };

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-navy-600" />
          AI Auto-Tagger
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <Tag className="w-4 h-4" />
          <AlertDescription>
            Automatically categorize and tag {visits.filter(v => !v.ai_tags).length} visits and {incidents.filter(i => !i.ai_tags).length} incidents for better searchability and trend analysis.
          </AlertDescription>
        </Alert>

        {isTagging && (
          <div className="space-y-2">
            <Progress value={progress} className="h-2" />
            <p className="text-sm text-slate-600 text-center">
              Processing... {Math.round(progress)}%
            </p>
          </div>
        )}

        {results && !isTagging && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription>
              Successfully tagged {results.visits} visits and {results.incidents} incidents!
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={autoTagAll}
          disabled={isTagging}
          className="w-full bg-navy-600 hover:bg-navy-700"
        >
          {isTagging ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Tagging in Progress...
            </>
          ) : (
            <>
              <Brain className="w-4 h-4 mr-2" />
              Run AI Auto-Tagging
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}