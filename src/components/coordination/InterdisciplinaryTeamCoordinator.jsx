import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  Users, 
  Brain, 
  Loader2,
  CheckCircle2,
  Calendar,
  AlertTriangle,
  UserPlus
} from "lucide-react";
import { toast } from 'sonner';

export default function InterdisciplinaryTeamCoordinator({ 
  patientId,
  patientData,
  carePlans,
  recentVisits,
  incidents,
  alerts,
  autoAnalyze = false 
}) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [recommendation, setRecommendation] = useState(null);
  const [isCreatingAlert, setIsCreatingAlert] = useState(false);

  const analyzeTeamMeetingNeed = useCallback(async () => {
    if (!patientData) return;

    try {
      const complexityIndicators = {
        diagnoses_count: [patientData.primary_diagnosis, ...(patientData.secondary_diagnoses || [])].filter(Boolean).length,
        medications_count: patientData.current_medications?.length || 0,
        active_care_plans: carePlans?.filter(cp => cp.status === 'active').length || 0,
        recent_incidents: incidents?.filter(i => {
          const incidentDate = new Date(i.incident_date);
          const daysSince = (new Date() - incidentDate) / (1000 * 60 * 60 * 24);
          return daysSince <= 30;
        }).length || 0,
        active_alerts: alerts?.length || 0,
        recent_hospitalizations: incidents?.filter(i => {
          if (i.incident_type !== 'hospitalized') return false;
          const incidentDate = new Date(i.incident_date);
          const daysSince = (new Date() - incidentDate) / (1000 * 60 * 60 * 24);
          return daysSince <= 30;
        }).length || 0
      };

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a care coordination expert. Analyze this patient's profile to determine if an interdisciplinary team (IDT) meeting is recommended.

PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patientData.care_type || 'home_health'}

COMPLEXITY INDICATORS:
- Total Diagnoses: ${complexityIndicators.diagnoses_count}
- Active Medications: ${complexityIndicators.medications_count}
- Active Care Plans: ${complexityIndicators.active_care_plans}
- Recent Incidents (30d): ${complexityIndicators.recent_incidents}
- Active Clinical Alerts: ${complexityIndicators.active_alerts}
- Recent Hospitalizations (30d): ${complexityIndicators.recent_hospitalizations}

RECENT VISIT TRENDS:
${recentVisits?.slice(0, 3).map(v => `- ${v.visit_date} (${v.visit_type}): ${v.nurse_notes?.substring(0, 200)}...`).join('\n') || 'No recent visits'}

ACTIVE ALERTS:
${alerts?.map(a => `- [${a.severity}] ${a.title}: ${a.message}`).join('\n') || 'No active alerts'}

Determine if IDT meeting is recommended based on:
- Clinical complexity and multiple comorbidities
- Care plan conflicts or gaps requiring multidisciplinary input
- Recent deterioration or frequent incidents
- Conflicting treatment goals needing coordination
- High-risk medication regimen
- Social/functional barriers needing team problem-solving

Return recommendation with:
- meeting_recommended: boolean
- urgency: "routine", "priority", "urgent"
- complexity_score: 0-100
- key_reasons: specific triggers for meeting
- suggested_attendees: roles needed (e.g., RN, MD, PT, SW, Pharmacist)
- suggested_agenda: discussion points
- optimal_timing: when to schedule
- patient_benefit: expected outcomes from coordination`,
        response_json_schema: {
          type: "object",
          properties: {
            meeting_recommended: { type: "boolean" },
            urgency: { type: "string" },
            complexity_score: { type: "number" },
            key_reasons: { type: "array", items: { type: "string" } },
            suggested_attendees: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  role: { type: "string" },
                  rationale: { type: "string" }
                }
              }
            },
            suggested_agenda: { type: "array", items: { type: "string" } },
            optimal_timing: { type: "string" },
            patient_benefit: { type: "string" },
            summary: { type: "string" }
          }
        }
      });

      setRecommendation(result);
    } catch (error) {
      console.error('IDT analysis error:', error);
      setRecommendation({ error: error.message });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patientData, carePlans, incidents, alerts, recentVisits]);

  useEffect(() => {
    if (autoAnalyze && patientData) {
      analyzeTeamMeetingNeed();
    }
  }, [autoAnalyze, patientId, patientData, analyzeTeamMeetingNeed]);

  const handleCreateCoordinationAlert = async () => {
    if (!recommendation?.meeting_recommended) return;

    setIsCreatingAlert(true);
    try {
      await base44.entities.CareCoordinationAlert.create({
        patient_id: patientId,
        alert_type: 'care_gap',
        severity: recommendation.urgency === 'urgent' ? 'urgent' : 
                  recommendation.urgency === 'priority' ? 'high' : 'medium',
        title: `IDT Meeting Recommended - ${patientData.first_name} ${patientData.last_name}`,
        description: recommendation.summary || 'Interdisciplinary team coordination needed',
        identified_gap: recommendation.key_reasons?.join('; '),
        recommended_actions: recommendation.suggested_agenda || [],
        team_meeting_suggested: true,
        meeting_attendees: recommendation.suggested_attendees?.map(a => a.role) || [],
        due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      });

      queryClient.invalidateQueries({ queryKey: ['careCoordinationAlerts'] });
      toast.success('✅ Care coordination alert created');
    } catch (error) {
      console.error('Error creating alert:', error);
      toast.error('Failed to create coordination alert');
    }
    setIsCreatingAlert(false);
  };

  return (
    <Card className="border-2 border-indigo-300">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50 pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-600" />
          AI Team Meeting Coordinator
          {recommendation?.meeting_recommended && (
            <Badge className={`ml-auto ${
              recommendation.urgency === 'urgent' ? 'bg-red-600' :
              recommendation.urgency === 'priority' ? 'bg-orange-600' :
              'bg-blue-600'
            }`}>
              {recommendation.urgency?.toUpperCase()}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!recommendation && !ai.loading && (
          <Button
            onClick={analyzeTeamMeetingNeed}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
          >
            <Brain className="w-4 h-4 mr-2" />
            Analyze Need for Team Meeting
          </Button>
        )}

        {ai.loading && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mx-auto mb-2" />
            <p className="text-sm text-slate-600">Analyzing patient complexity...</p>
          </div>
        )}

        {recommendation && !recommendation.error && (
          <>
            {/* Meeting Recommendation */}
            <Alert className={`${
              recommendation.meeting_recommended 
                ? 'bg-orange-50 border-orange-300' 
                : 'bg-green-50 border-green-300'
            }`}>
              {recommendation.meeting_recommended ? (
                <AlertTriangle className="w-4 h-4 text-orange-600" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              )}
              <AlertDescription className="text-sm">
                <p className="font-semibold mb-1">
                  {recommendation.meeting_recommended 
                    ? '⚠️ Interdisciplinary Team Meeting Recommended' 
                    : '✅ No Team Meeting Needed Currently'}
                </p>
                <p>{recommendation.summary}</p>
              </AlertDescription>
            </Alert>

            {recommendation.meeting_recommended && (
              <>
                {/* Complexity Score */}
                <div className="p-3 bg-slate-50 rounded-lg border">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold">Complexity Score</span>
                    <span className="text-xl font-bold text-indigo-600">
                      {recommendation.complexity_score}/100
                    </span>
                  </div>
                  <div className="w-full bg-slate-200 rounded-full h-2">
                    <div 
                      className="bg-indigo-600 h-2 rounded-full transition-all"
                      style={{ width: `${recommendation.complexity_score}%` }}
                    />
                  </div>
                </div>

                {/* Key Reasons */}
                {recommendation.key_reasons?.length > 0 && (
                  <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-sm font-semibold text-orange-900 mb-2">Triggers for Meeting</p>
                    <ul className="text-xs space-y-1 text-orange-800">
                      {recommendation.key_reasons.map((reason, idx) => (
                        <li key={idx}>• {reason}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Attendees */}
                {recommendation.suggested_attendees?.length > 0 && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                    <p className="text-sm font-semibold text-indigo-900 mb-2">
                      Recommended Team Members ({recommendation.suggested_attendees.length})
                    </p>
                    <div className="space-y-2">
                      {recommendation.suggested_attendees.map((attendee, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-xs">
                          <UserPlus className="w-3 h-3 text-indigo-600 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-medium text-indigo-900">{attendee.role}</p>
                            <p className="text-indigo-700">{attendee.rationale}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Suggested Agenda */}
                {recommendation.suggested_agenda?.length > 0 && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-sm font-semibold text-blue-900 mb-2">Proposed Agenda</p>
                    <ul className="text-xs space-y-1 text-blue-800">
                      {recommendation.suggested_agenda.map((item, idx) => (
                        <li key={idx}>{idx + 1}. {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Patient Benefit */}
                {recommendation.patient_benefit && (
                  <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <p className="text-sm font-semibold text-green-900 mb-1">Expected Benefits</p>
                    <p className="text-xs text-green-800">{recommendation.patient_benefit}</p>
                  </div>
                )}

                {/* Optimal Timing */}
                {recommendation.optimal_timing && (
                  <div className="flex items-center gap-2 p-2 bg-navy-50 border border-navy-200 rounded text-xs">
                    <Calendar className="w-4 h-4 text-navy-600" />
                    <span className="text-navy-800">
                      <strong>Optimal Timing:</strong> {recommendation.optimal_timing}
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleCreateCoordinationAlert}
                    disabled={isCreatingAlert}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  >
                    {isCreatingAlert ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <Calendar className="w-4 h-4 mr-2" />
                    )}
                    Create Coordination Alert
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setRecommendation(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              </>
            )}
          </>
        )}

        {recommendation?.error && (
          <Alert className="bg-red-50 border-red-300">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <AlertDescription className="text-sm text-red-800">
              Analysis failed: {recommendation.error}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}