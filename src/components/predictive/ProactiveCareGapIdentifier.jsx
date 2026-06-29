import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  Clock,
  Target,
  Sparkles
} from "lucide-react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { logActivity, ActivityActions } from "@/components/utils/activityLogger";

export default function ProactiveCareGapIdentifier({ 
  patients, 
  visits = [], 
  carePlans = [], 
  alerts = [],
  autoAnalyze = false,
  maxGaps = 10,
  compact = false 
}) {
  const queryClient = useQueryClient();
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const ai = useAICall();
  const [identifiedGaps, setIdentifiedGaps] = useState(null);
  const [_selectedPatients, _setSelectedPatients] = useState([]);

  const analyzeForGaps = useCallback(async () => {
    if (!patients || patients.length === 0) return;

    try {
      // Analyze high-risk patients (active, with visits/care plans)
      const patientsToAnalyze = patients
        .filter(p => p.status === 'active')
        .slice(0, 50); // Limit to 50 patients for performance

      // Build comprehensive patient profiles
      const patientProfiles = patientsToAnalyze.map(patient => {
        const patientVisits = visits.filter(v => v.patient_id === patient.id);
        const patientCarePlans = carePlans.filter(cp => cp.patient_id === patient.id);
        const patientAlerts = alerts.filter(a => a.patient_id === patient.id && a.status === 'active');

        const recentVisit = patientVisits.sort((a, b) => 
          new Date(b.visit_date) - new Date(a.visit_date)
        )[0];

        const daysSinceLastVisit = recentVisit 
          ? Math.floor((new Date() - new Date(recentVisit.visit_date)) / (1000 * 60 * 60 * 24))
          : 999;

        return {
          id: patient.id,
          name: `${patient.first_name} ${patient.last_name}`,
          diagnosis: patient.primary_diagnosis,
          secondary_diagnoses: patient.secondary_diagnoses || [],
          medications: patient.current_medications?.map(m => m.name) || [],
          care_type: patient.care_type,
          days_since_last_visit: daysSinceLastVisit,
          total_visits: patientVisits.length,
          active_care_plans: patientCarePlans.filter(cp => cp.status === 'active').length,
          met_care_plans: patientCarePlans.filter(cp => cp.status === 'met').length,
          active_alerts: patientAlerts.length,
          high_severity_alerts: patientAlerts.filter(a => a.severity === 'high' || a.severity === 'critical').length,
          recent_vital_signs: recentVisit?.vital_signs,
          functional_status: patient.functional_status,
          age: patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null
        };
      });

      // Use AI to identify care gaps
      const gapAnalysis = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert home health clinical analyst. Analyze these patient profiles to proactively identify potential care gaps, missed opportunities, and risks before they become problems.

PATIENT PROFILES:
${JSON.stringify(patientProfiles.slice(0, 20), null, 2)}

Identify up to ${maxGaps} HIGH-PRIORITY care gaps across these patients. Focus on:

1. **Visit Frequency Gaps**: Patients who haven't been seen recently based on their diagnosis/care needs
2. **Care Plan Gaps**: Patients with conditions but no active care plans addressing them
3. **Medication Management Risks**: Complex medication regimens without recent assessment
4. **Deterioration Risks**: Patients with vital signs trends or alert patterns suggesting decline
5. **Transition of Care Gaps**: Post-hospitalization patients needing close monitoring
6. **Functional Decline Risks**: Patients at risk of losing independence
7. **Preventative Care Gaps**: Missing assessments, screenings, or education
8. **Compliance Risks**: Documentation or regulatory compliance issues

For each gap identified, provide:
- Patient ID and name
- Gap category (from list above)
- Specific gap description
- Risk level (critical/high/medium)
- Clinical rationale (why this is a concern)
- Recommended interventions (specific, actionable)
- Suggested timeline (urgent/this_week/next_week/this_month)
- Estimated impact if addressed (prevent_hospitalization/improve_outcomes/maintain_independence/ensure_compliance)

Return structured JSON with prioritized gaps.`,
        response_json_schema: {
          type: "object",
          properties: {
            total_patients_analyzed: { type: "number" },
            high_risk_patients: { type: "number" },
            identified_gaps: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  patient_id: { type: "string" },
                  patient_name: { type: "string" },
                  gap_category: { type: "string" },
                  gap_description: { type: "string" },
                  risk_level: { type: "string" },
                  clinical_rationale: { type: "string" },
                  recommended_interventions: {
                    type: "array",
                    items: { type: "string" }
                  },
                  suggested_timeline: { type: "string" },
                  estimated_impact: { type: "string" },
                  priority_score: { type: "number" }
                }
              }
            },
            summary: { type: "string" }
          }
        }
      });

      setIdentifiedGaps(gapAnalysis);

      logActivity(ActivityActions.AI_FEATURE_USED, {
        feature: 'proactive_care_gap_identifier',
        patients_analyzed: gapAnalysis.total_patients_analyzed,
        gaps_found: gapAnalysis.identified_gaps?.length || 0,
        page: 'ProactiveCareGapIdentifier'
      });

    } catch (error) {
      console.error('Error analyzing care gaps:', error);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patients, visits, carePlans, alerts, maxGaps]);

  useEffect(() => {
    if (autoAnalyze && patients?.length > 0) {
      analyzeForGaps();
    }
  }, [autoAnalyze, patients?.length, analyzeForGaps]);

  const createTaskMutation = useMutation({
    mutationFn: (taskData) => base44.entities.Task.create(taskData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['nurseTasks'] });
    }
  });

  const handleCreateTask = async (gap) => {
    try {
      await createTaskMutation.mutateAsync({
        patient_id: gap.patient_id,
        title: `Care Gap: ${gap.gap_category}`,
        description: `${gap.gap_description}\n\nClinical Rationale:\n${gap.clinical_rationale}\n\nRecommended Actions:\n${gap.recommended_interventions.join('\n- ')}`,
        type: 'followup',
        priority: gap.risk_level === 'critical' ? 'high' : gap.risk_level === 'high' ? 'high' : 'medium',
        assigned_to: currentUser?.email,
        due_timeframe: gap.suggested_timeline === 'urgent' ? 'today' :
                       gap.suggested_timeline === 'this_week' ? 'this_week' : 
                       gap.suggested_timeline === 'next_week' ? 'next_visit' : 'this_week',
        source: 'ai_generated',
        ai_reason: `Proactive care gap identified: ${gap.estimated_impact}`
      });
    } catch (error) {
      console.error('Error creating task:', error);
    }
  };

  const getRiskColor = (level) => {
    const colors = {
      critical: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300'
    };
    return colors[level] || colors.medium;
  };

  const getTimelineIcon = (timeline) => {
    if (timeline === 'urgent') return <AlertTriangle className="w-4 h-4 text-red-600" />;
    if (timeline === 'this_week') return <Clock className="w-4 h-4 text-orange-600" />;
    return <Clock className="w-4 h-4 text-slate-600" />;
  };

  if (!patients || patients.length === 0) {
    return null;
  }

  if (compact && !identifiedGaps) {
    return (
      <Card className="border-blue-200">
        <CardContent className="p-4">
          <Button 
            onClick={analyzeForGaps} 
            disabled={ai.loading}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            {ai.loading ? (
              <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Analyzing...</>
            ) : (
              <><Brain className="w-4 h-4 mr-2" /> Scan for Care Gaps</>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50">
      <CardHeader className="bg-gradient-to-r from-blue-100 to-indigo-100 pb-3">
        <CardTitle className="text-lg flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-blue-600 rounded-lg">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <span>AI Care Gap Identifier</span>
              {identifiedGaps && (
                <p className="text-xs font-normal text-slate-600 mt-0.5">
                  Analyzed {identifiedGaps.total_patients_analyzed} patients
                </p>
              )}
            </div>
          </div>
          {!ai.loading && (
            <Button 
              onClick={analyzeForGaps} 
              size="sm"
              variant="outline"
              className="gap-2"
            >
              <Sparkles className="w-4 h-4" />
              Re-Analyze
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        {ai.loading ? (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
            <p className="text-sm text-slate-600">Analyzing patient data for potential care gaps...</p>
          </div>
        ) : identifiedGaps ? (
          <div className="space-y-4">
            {identifiedGaps.summary && (
              <Alert className="bg-blue-50 border-blue-300">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-sm text-blue-900">
                  <strong>Analysis Summary:</strong> {identifiedGaps.summary}
                </AlertDescription>
              </Alert>
            )}

            {identifiedGaps.identified_gaps?.length > 0 ? (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {identifiedGaps.identified_gaps.map((gap, idx) => (
                  <Card key={idx} className={`border-l-4 ${getRiskColor(gap.risk_level)}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Link 
                              to={createPageUrl(`PatientDetails?id=${gap.patient_id}`)}
                              className="font-semibold text-blue-700 hover:text-blue-900 hover:underline"
                            >
                              {gap.patient_name}
                            </Link>
                            <Badge className={getRiskColor(gap.risk_level)}>
                              {gap.risk_level}
                            </Badge>
                            {getTimelineIcon(gap.suggested_timeline)}
                          </div>
                          <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-2">
                            {(gap.gap_category || '').replace(/_/g, ' ')}
                          </p>
                        </div>
                      </div>

                      <p className="text-sm text-slate-900 mb-2">{gap.gap_description}</p>

                      <div className="bg-blue-50 p-3 rounded mb-3">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Clinical Rationale:</p>
                        <p className="text-xs text-blue-800">{gap.clinical_rationale}</p>
                      </div>

                      {gap.recommended_interventions?.length > 0 && (
                        <div className="bg-green-50 p-3 rounded mb-3">
                          <p className="text-xs font-semibold text-green-900 mb-1">Recommended Interventions:</p>
                          <ul className="text-xs text-green-800 space-y-1">
                            {gap.recommended_interventions.map((intervention, i) => (
                              <li key={i}>✓ {intervention}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                        <span className="flex items-center gap-1">
                          <Target className="w-3 h-3" />
                          Impact: {(gap.estimated_impact || '').replace(/_/g, ' ')}
                        </span>
                        <span>Timeline: {(gap.suggested_timeline || '').replace(/_/g, ' ')}</span>
                      </div>

                      <Button
                        size="sm"
                        className="w-full bg-green-600 hover:bg-green-700"
                        onClick={() => handleCreateTask(gap)}
                      >
                        <CheckCircle2 className="w-4 h-4 mr-2" />
                        Create Task for Care Team
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <p className="text-sm text-green-700 font-medium">No significant care gaps identified</p>
                <p className="text-xs text-slate-600 mt-1">Current care patterns are appropriate</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-8">
            <Button 
              onClick={analyzeForGaps} 
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
            >
              <Brain className="w-5 h-5 mr-2" />
              Analyze for Care Gaps
            </Button>
            <p className="text-xs text-slate-500 mt-3">
              AI will analyze {patients.length} patients to identify potential care gaps
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}