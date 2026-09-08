import { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { patchIncident } from "@/functions/updateIncident";
import { invokeLLM } from "@/lib/invokeLLM";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, Brain, Tag, Loader2, CheckCircle2 } from "lucide-react";
import { hasSemanticTags, mergeAiTags } from "@/components/smartNote/compliance/reportingFields";
import { setVisitAiTags } from '@/functions/updateAuthorizedVisit';
import { getTrustedTenantContext } from '@/lib/roles';
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

function freshQuerySuccess(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error
    && !query.isFetching;
}

export default function AIAutoTagger() {
  const [isTagging, setIsTagging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);
  const queryClient = useQueryClient();
  const currentUserQuery = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // High limits before agency post-filter so foreign-tenant rows cannot crowd
  // this agency's untagged visits/incidents out of the tagging sample.
  const visitQuery = useAuthorizedVisits({
    purpose: 'ai_tagging',
    sort: '-visit_date',
    limit: 500,
  });
  const incidentQuery = useAgencyScopedQuery({
    queryKey: ['allIncidentsForTagging'],
    fetch: () => base44.entities.Incident.list('-created_date', 500),
    initialData: [],
  });
  const incidentTenantScope = getTrustedTenantContext(currentUserQuery.data);
  const currentUserFresh = freshQuerySuccess(currentUserQuery);
  const incidentFresh = freshQuerySuccess(incidentQuery);
  const visitSnapshot = useMemo(() => (
    visitQuery.isSuccess
      && currentUserFresh
      && sameAuthorizedTenantScope(incidentTenantScope, visitQuery.tenantScope)
      && incidentFresh
      ? {
        visits: visitQuery.data,
        incidents: incidentQuery.data,
        incidentTenantScope,
        visitTenantScope: visitQuery.tenantScope,
      }
      : null
  ), [
    currentUserFresh,
    incidentTenantScope,
    incidentQuery.data,
    incidentFresh,
    visitQuery.data,
    visitQuery.isSuccess,
    visitQuery.tenantScope,
  ]);
  const visitSnapshotRef = useRef(visitSnapshot);
  visitSnapshotRef.current = visitSnapshot;
  const taggingSequenceRef = useRef(0);
  const visits = visitSnapshot?.visits || [];
  const incidents = visitSnapshot?.incidents || [];

  // Results reveal how many Visit records were processed. Hide them and stop
  // an in-flight batch as soon as any source enters revalidation or fails.
  useEffect(() => {
    if (visitSnapshot) return;
    taggingSequenceRef.current += 1;
    setIsTagging(false);
    setProgress(0);
    setResults(null);
  }, [visitSnapshot]);

  const updateVisitMutation = useMutation({
    mutationFn: ({ id, tags }) => setVisitAiTags({ visitId: id, tags }),
  });

  // Incident writes are service-role-only; go through the function.
  const updateIncidentMutation = useMutation({
    mutationFn: ({ id, tags }) => patchIncident({ incidentId: id, patch: { ai_tags: tags } }),
  });

  const autoTagAll = async () => {
    const authorizedSnapshot = visitSnapshotRef.current;
    if (!authorizedSnapshot) return;
    const taggingSequence = ++taggingSequenceRef.current;
    setIsTagging(true);
    setProgress(0);
    
    const totalItems = authorizedSnapshot.visits.length + authorizedSnapshot.incidents.length;
    let processed = 0;
    let tagged = { visits: 0, incidents: 0 };

    try {
      // Process visits in batches
      for (let i = 0; i < authorizedSnapshot.visits.length; i += 5) {
        const batch = authorizedSnapshot.visits.slice(i, i + 5);
        
        for (const visit of batch) {
          if (
            visitSnapshotRef.current !== authorizedSnapshot
            || taggingSequenceRef.current !== taggingSequence
          ) return;
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
              model: "automatic",
              prompt,
              response_json_schema: {
                type: "array",
                items: { type: "string" }
              }
            });

            if (
              visitSnapshotRef.current !== authorizedSnapshot
              || taggingSequenceRef.current !== taggingSequence
            ) return;
            await updateVisitMutation.mutateAsync({ id: visit.id, tags: mergeAiTags(visit.ai_tags, tags) });
            if (
              visitSnapshotRef.current !== authorizedSnapshot
              || taggingSequenceRef.current !== taggingSequence
            ) return;
            tagged.visits++;
          } catch (error) {
            console.error(`Error tagging visit ${visit.id}:`, error);
          }

          processed++;
          if (totalItems > 0) setProgress((processed / totalItems) * 100);
        }
      }

      // Process incidents
      for (const incident of authorizedSnapshot.incidents) {
        if (
          visitSnapshotRef.current !== authorizedSnapshot
          || taggingSequenceRef.current !== taggingSequence
        ) return;
        if (hasSemanticTags(incident.ai_tags)) {
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
            model: "automatic",
            prompt,
            response_json_schema: {
              type: "array",
              items: { type: "string" }
            }
          });

          if (
            visitSnapshotRef.current !== authorizedSnapshot
            || taggingSequenceRef.current !== taggingSequence
          ) return;
          await updateIncidentMutation.mutateAsync({ id: incident.id, tags });
          tagged.incidents++;
        } catch (error) {
          console.error(`Error tagging incident ${incident.id}:`, error);
        }

        processed++;
        if (totalItems > 0) setProgress((processed / totalItems) * 100);
      }

      if (
        visitSnapshotRef.current === authorizedSnapshot
        && taggingSequenceRef.current === taggingSequence
      ) {
        setResults(tagged);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['visits', 'authorized-list', 'ai_tagging'] }),
          queryClient.invalidateQueries({ queryKey: ['allIncidentsForTagging'] }),
        ]);
      }
    } catch (error) {
      console.error("Error in auto-tagging:", error);
    }
    
    if (taggingSequenceRef.current === taggingSequence) setIsTagging(false);
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
        <Alert className={!visitSnapshot ? 'border-amber-300 bg-amber-50' : undefined} role="status">
          {!visitSnapshot ? <AlertTriangle className="w-4 h-4 text-amber-700" /> : <Tag className="w-4 h-4" />}
          <AlertDescription>
            {!visitSnapshot
              ? (visitQuery.isError || currentUserQuery.isError || incidentQuery.isError
                ? 'AI auto-tagging is unavailable because one or more authorized data sources could not be verified.'
                : 'Reverifying tenant access and every tagging source before AI auto-tagging…')
              : `Automatically categorize and tag ${visits.filter(v => !hasSemanticTags(v.ai_tags)).length} visits and ${incidents.filter(i => !hasSemanticTags(i.ai_tags)).length} incidents for better searchability and trend analysis.`}
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

        {visitSnapshot && results && !isTagging && (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription>
              Successfully tagged {results.visits} visits and {results.incidents} incidents!
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={autoTagAll}
          disabled={isTagging || !visitSnapshot}
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
