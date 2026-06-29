import { useState, useEffect, useCallback, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import {
  Brain,
  Users,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Phone,
  Mail,
  Copy
} from "lucide-react";
import { format, addDays } from "date-fns";
import { toast } from 'sonner';

export default function CareCoordinationAnalyzer({ 
  patientId, 
  autoAnalyze = false,
  _compact = false 
}) {
  const queryClient = useQueryClient();
  const ai = useAICall();
  const [alerts, setAlerts] = useState([]);
  // Records the patient this component last auto-analyzed, so an empty-result run
  // (alerts stays []) can't re-fire each time ai.loading toggles, and a single ref
  // (re-armed only when patientId actually changes) avoids the ordering hazard of a
  // separate reset effect clearing the latch in the same flush.
  const autoAnalyzedForRef = useRef(null);
  const [_expandedAlert, _setExpandedAlert] = useState(null);
  const [customNotes, setCustomNotes] = useState({});

  const { data: patient } = useQuery({
    queryKey: ['patientForCoordination', patientId],
    queryFn: () => base44.entities.Patient.filter({ id: patientId }),
    enabled: !!patientId,
    select: (data) => data[0]
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['patientVisitsCoord', patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId }, '-visit_date', 20),
    enabled: !!patientId,
    initialData: [],
  });

  const { data: carePlans = [] } = useQuery({
    queryKey: ['patientCarePlansCoord', patientId],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patientId }),
    enabled: !!patientId,
    initialData: [],
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['patientIncidentsCoord', patientId],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patientId }, '-incident_date', 10),
    enabled: !!patientId,
    initialData: [],
  });

  const { data: existingAlerts = [] } = useQuery({
    queryKey: ['coordinationAlerts', patientId],
    queryFn: () => base44.entities.CareCoordinationAlert.filter({ patient_id: patientId, status: 'active' }),
    enabled: !!patientId,
    initialData: [],
  });

  const analyzeCoordination = useCallback(async () => {
    if (!patient) return;

    try {
      const hospitalizations = incidents.filter(i => i.incident_type === 'hospitalized');
      const recentHospitalization = hospitalizations.length > 0 ? hospitalizations[0] : null;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an AI care coordination specialist for home health. Analyze this patient's data to identify care gaps and provider coordination needs.

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
SECONDARY DIAGNOSES: ${patient.secondary_diagnoses?.join(', ') || 'None'}
AGE: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}

CURRENT MEDICATIONS (${patient.current_medications?.length || 0}):
${patient.current_medications?.slice(0, 10).map(m => `- ${m.name} ${m.dosage || ''} - Prescribed by: ${m.prescriber || 'Unknown'}`).join('\n') || 'None documented'}

RECENT VISITS (Last ${visits.length}):
${visits.slice(0, 5).map(v => `- ${v.visit_date} (${v.visit_type}): ${v.nurse_notes?.substring(0, 200)}...`).join('\n')}

ACTIVE CARE PLANS (${carePlans.filter(cp => cp.status === 'active').length}):
${carePlans.filter(cp => cp.status === 'active').map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

RECENT HOSPITALIZATIONS:
${recentHospitalization ? `- ${recentHospitalization.incident_date}: ${recentHospitalization.details?.reason || 'Hospitalized'} at ${recentHospitalization.details?.hospital || 'Unknown facility'}` : 'None in recent history'}

PRIMARY PHYSICIAN: ${patient.physician_name || 'Not specified'} (${patient.physician_phone || 'No phone'})
CAREGIVERS: ${patient.caregiver_name || 'None documented'}

IDENTIFY CARE COORDINATION GAPS:

1. MEDICATION RECONCILIATION ISSUES:
   - Multiple prescribers not coordinating?
   - Potential drug interactions?
   - Missing medication reviews?
   - Post-hospitalization medication changes not communicated?

2. SPECIALIST COORDINATION:
   - Diagnoses requiring specialist input not referenced in notes?
   - Missing specialist recommendations in care plan?
   - Test results or procedures mentioned without follow-up?

3. HOSPITALIZATION FOLLOW-UP:
   - Recent hospitalization without documented discharge summary review?
   - New diagnoses or medications from hospital not integrated?
   - Post-discharge care plan not updated?

4. PHYSICIAN COMMUNICATION GAPS:
   - Changes in patient status not communicated to MD?
   - Outstanding orders or clarifications needed?
   - Care plan goals not aligned with physician orders?

5. CARE PLAN GAPS:
   - Diagnoses without corresponding care plans?
   - Care plans not addressing all active problems?
   - Goals not aligned across providers?

6. TRANSITION OF CARE:
   - Missing information from previous care settings?
   - Incomplete handoff documentation?

7. DUPLICATE OR CONFLICTING CARE:
   - Multiple providers addressing same issue without coordination?
   - Conflicting treatment approaches?

For EACH identified gap, determine:
- Severity (urgent/high/medium/low)
- Which providers need coordination
- Whether interdisciplinary team meeting is needed
- Specific recommended actions
- Communication summary for providers

Return comprehensive analysis with actionable coordination alerts.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_coordination_status: { type: "string", enum: ["excellent", "good", "needs_attention", "critical"] },
            summary: { type: "string" },
            alerts: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  // Constrain to the CareCoordinationAlert schema enums so the model
                  // can't emit a value the backend drops (both are required fields).
                  alert_type: { type: "string", enum: ["care_gap", "provider_communication_needed", "medication_discrepancy", "duplicate_services", "missing_specialist_input", "hospitalization_followup", "transition_of_care"] },
                  severity: { type: "string", enum: ["urgent", "high", "medium", "low"] },
                  title: { type: "string" },
                  description: { type: "string" },
                  identified_gap: { type: "string" },
                  affected_providers: { type: "array", items: { type: "string" } },
                  recommended_actions: { type: "array", items: { type: "string" } },
                  team_meeting_suggested: { type: "boolean" },
                  meeting_attendees: { type: "array", items: { type: "string" } },
                  communication_summary: { type: "string" },
                  supporting_evidence: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        source: { type: "string" },
                        date: { type: "string" },
                        excerpt: { type: "string" }
                      }
                    }
                  },
                  urgency_timeline: { type: "string" }
                }
              }
            }
          }
        }
      });

      setAlerts(result.alerts || []);
    } catch (error) {
      console.error('Error analyzing care coordination:', error);
      toast.error('Failed to analyze care coordination. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, incidents, visits, carePlans]);

  useEffect(() => {
    if (autoAnalyze && patientId && patient && !ai.loading && autoAnalyzedForRef.current !== patientId) {
      autoAnalyzedForRef.current = patientId;
      analyzeCoordination();
    }
  }, [autoAnalyze, patientId, patient, ai.loading, analyzeCoordination]);

  const saveAlert = async (alertData) => {
    try {
      const dueDate = alertData.urgency_timeline?.includes('immediate') || alertData.urgency_timeline?.includes('urgent')
        ? format(addDays(new Date(), 1), 'yyyy-MM-dd')
        : alertData.urgency_timeline?.includes('week')
        ? format(addDays(new Date(), 7), 'yyyy-MM-dd')
        : format(addDays(new Date(), 14), 'yyyy-MM-dd');

      // Coerce the AI values to the schema enums (defense-in-depth): alert_type and
      // severity are required, so an out-of-enum value would make the create throw.
      const ALLOWED_ALERT_TYPES = new Set(['care_gap', 'provider_communication_needed', 'medication_discrepancy', 'duplicate_services', 'missing_specialist_input', 'hospitalization_followup', 'transition_of_care']);
      const ALLOWED_SEVERITIES = new Set(['urgent', 'high', 'medium', 'low']);

      await base44.entities.CareCoordinationAlert.create({
        patient_id: patientId,
        alert_type: ALLOWED_ALERT_TYPES.has(alertData.alert_type) ? alertData.alert_type : 'care_gap',
        severity: ALLOWED_SEVERITIES.has(alertData.severity) ? alertData.severity : 'medium',
        title: alertData.title,
        description: alertData.description,
        identified_gap: alertData.identified_gap,
        affected_providers: alertData.affected_providers,
        recommended_actions: alertData.recommended_actions,
        team_meeting_suggested: alertData.team_meeting_suggested,
        meeting_attendees: alertData.meeting_attendees,
        communication_summary: customNotes[alertData.title] || alertData.communication_summary,
        supporting_evidence: alertData.supporting_evidence,
        status: 'active',
        due_date: dueDate
      });

      queryClient.invalidateQueries({ queryKey: ['coordinationAlerts', patientId] });
      toast.success('Care coordination alert created successfully!');
    } catch (error) {
      console.error('Error saving alert:', error);
      toast.error('Failed to save alert. Please try again.');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  const getSeverityColor = (severity) => {
    const colors = {
      urgent: 'bg-red-100 text-red-800 border-red-300',
      high: 'bg-orange-100 text-orange-800 border-orange-300',
      medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
      low: 'bg-blue-100 text-blue-800 border-blue-300'
    };
    return colors[severity] || 'bg-slate-100 text-slate-800';
  };

  if (!patientId) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <Users className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-900">
          Select a patient to analyze care coordination needs
        </AlertDescription>
      </Alert>
    );
  }

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-navy-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-slate-900 mb-2">Analyzing Care Coordination...</p>
          <p className="text-sm text-slate-600">
            Reviewing {visits.length} visits, {carePlans.length} care plans, {incidents.length} incidents...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0 && !ai.loading) {
    return (
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-600" />
            AI Care Coordination Analyzer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Analyze patient data to identify care gaps, provider coordination needs, and suggest team meetings.
          </p>
          {existingAlerts.length > 0 && (
            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-900">
                {existingAlerts.length} active coordination alert(s) on file
              </AlertDescription>
            </Alert>
          )}
          <Button onClick={analyzeCoordination} className="w-full bg-blue-600 hover:bg-blue-700">
            <Brain className="w-4 h-4 mr-2" />
            Analyze Care Coordination
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-2 border-navy-300 bg-navy-50">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-navy-600" />
              Care Coordination Analysis
            </span>
            <Badge className="bg-navy-600 text-white">
              {alerts.length} gap(s) identified
            </Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      {alerts.map((alert, idx) => (
        <Card key={idx} className={`border-l-4 ${
          alert.severity === 'urgent' ? 'border-l-red-500' :
          alert.severity === 'high' ? 'border-l-orange-500' :
          alert.severity === 'medium' ? 'border-l-yellow-500' : 'border-l-blue-500'
        }`}>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <CardTitle className="text-lg mb-2">{alert.title}</CardTitle>
                <div className="flex gap-2 flex-wrap">
                  <Badge className={getSeverityColor(alert.severity)}>
                    {alert.severity}
                  </Badge>
                  <Badge variant="outline">{(alert.alert_type || '').replace(/_/g, ' ')}</Badge>
                  {alert.team_meeting_suggested && (
                    <Badge className="bg-navy-100 text-navy-800">
                      <Users className="w-3 h-3 mr-1" />
                      Team Meeting Needed
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-slate-900 mb-2">{alert.description}</p>
              <div className="bg-orange-50 p-3 rounded border border-orange-200">
                <p className="text-xs font-semibold text-orange-900 mb-1">Identified Gap:</p>
                <p className="text-sm text-orange-800">{alert.identified_gap}</p>
              </div>
            </div>

            {/* Affected Providers */}
            <div className="bg-blue-50 p-3 rounded border border-blue-200">
              <p className="text-xs font-semibold text-blue-900 mb-2">Affected Providers:</p>
              <div className="flex flex-wrap gap-2">
                {alert.affected_providers?.map((provider, i) => (
                  <Badge key={i} variant="outline" className="text-blue-800">
                    {provider}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Recommended Actions */}
            <div className="bg-green-50 p-3 rounded border border-green-200">
              <p className="text-xs font-semibold text-green-900 mb-2">Recommended Actions:</p>
              <ul className="space-y-1">
                {alert.recommended_actions?.map((action, i) => (
                  <li key={i} className="text-sm text-green-800 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    {action}
                  </li>
                ))}
              </ul>
            </div>

            {/* Supporting Evidence */}
            {alert.supporting_evidence?.length > 0 && (
              <div className="bg-slate-50 p-3 rounded border">
                <p className="text-xs font-semibold text-slate-900 mb-2">Supporting Evidence:</p>
                <div className="space-y-2">
                  {alert.supporting_evidence.map((evidence, i) => (
                    <div key={i} className="bg-white p-2 rounded border text-xs">
                      <p className="font-medium text-slate-700">
                        {evidence.source} - {evidence.date}
                      </p>
                      <p className="text-slate-600 italic">"{evidence.excerpt}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Team Meeting Details */}
            {alert.team_meeting_suggested && (
              <div className="bg-navy-50 p-4 rounded border-2 border-navy-300">
                <div className="flex items-center gap-2 mb-3">
                  <Calendar className="w-5 h-5 text-navy-600" />
                  <p className="font-semibold text-navy-900">Interdisciplinary Team Meeting Recommended</p>
                </div>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs font-semibold text-navy-900 mb-1">Suggested Attendees:</p>
                    <div className="flex flex-wrap gap-2">
                      {alert.meeting_attendees?.map((attendee, i) => (
                        <Badge key={i} className="bg-navy-100 text-navy-800">
                          {attendee}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-navy-900 mb-1">Timeline:</p>
                    <p className="text-sm text-navy-800">{alert.urgency_timeline}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Communication Summary */}
            <div className="bg-indigo-50 p-4 rounded border border-indigo-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-indigo-900">Communication Summary for Providers:</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copyToClipboard(customNotes[alert.title] || alert.communication_summary)}
                >
                  <Copy className="w-3 h-3 mr-1" />
                  Copy
                </Button>
              </div>
              <Textarea
                value={customNotes[alert.title] || alert.communication_summary}
                onChange={(e) => setCustomNotes({ ...customNotes, [alert.title]: e.target.value })}
                className="text-sm min-h-[120px] bg-white"
                placeholder="Edit communication summary..."
              />
              <p className="text-xs text-indigo-600 mt-2">
                Use this summary when contacting providers or in team meeting notes
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 pt-2 border-t">
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                onClick={() => saveAlert(alert)}
              >
                <AlertTriangle className="w-4 h-4 mr-1" />
                Create Alert & Task
              </Button>
              {patient.physician_email && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    window.location.href = `mailto:${patient.physician_email}?subject=Care Coordination: ${patient.first_name} ${patient.last_name}&body=${encodeURIComponent(customNotes[alert.title] || alert.communication_summary)}`;
                  }}
                >
                  <Mail className="w-4 h-4 mr-1" />
                  Email MD
                </Button>
              )}
              {patient.physician_phone && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { window.location.href = `tel:${patient.physician_phone}`; }}
                >
                  <Phone className="w-4 h-4 mr-1" />
                  {patient.physician_phone}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setAlerts([]);
            analyzeCoordination();
          }}
        >
          Refresh Analysis
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAlerts([])}
        >
          Clear Results
        </Button>
      </div>
    </div>
  );
}