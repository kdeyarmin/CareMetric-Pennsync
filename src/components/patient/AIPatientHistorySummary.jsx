import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Brain,
  Loader2,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Target,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  FileText,
  ChevronDown,
  ChevronUp,
  Plus,
  History
} from "lucide-react";
import { format, differenceInDays, isValid } from "date-fns";
import PatientRiskStratification from "./PatientRiskStratification";

export default function AIPatientHistorySummary({
  patient,
  visits = [],
  carePlans = [],
  incidents = [],
  onInsertSummary,
  autoGenerate = true,
  prominent = true
}) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [isExpanded, setIsExpanded] = useState(true);
  const [copied, setCopied] = useState(false);

  const calculateAge = useCallback((dob) => {
    const today = new Date();
    const birthDate = new Date(dob);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
  }, []);

  const generateSummary = useCallback(async () => {
    if (!patient) return;

    try {
      const completedVisits = visits.filter(v => v.status === 'completed');
      const recentVisits = completedVisits.slice(0, 10);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentIncidents = incidents.slice(0, 5);

      // Extract vital trends from visits
      const vitalHistory = recentVisits
        .filter(v => v.vital_signs)
        .map(v => ({
          date: v.visit_date,
          vitals: v.vital_signs
        }));

      // Build comprehensive clinical history
      const visitNotes = recentVisits
        .filter(v => v.nurse_notes)
        .map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          notes: v.nurse_notes?.substring(0, 500)
        }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an expert clinical summarization AI. Generate a comprehensive yet concise patient history summary that gives nurses immediate context before a visit.

PATIENT DEMOGRAPHICS:
- Name: ${patient.first_name} ${patient.last_name}
- DOB: ${patient.date_of_birth || 'Unknown'}
- Age: ${patient.date_of_birth ? calculateAge(patient.date_of_birth) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None documented'}
- Allergies: ${patient.allergies || 'NKDA'}
- Status: ${patient.status || 'active'}
- Caregiver: ${patient.caregiver_name || 'Not documented'}

VISIT STATISTICS:
- Total Completed Visits: ${completedVisits.length}
- First Visit: ${completedVisits.length > 0 ? completedVisits[completedVisits.length - 1]?.visit_date : 'None'}
- Last Visit: ${recentVisits[0]?.visit_date || 'None'}
- Days on Service: ${completedVisits.length > 0 && completedVisits[completedVisits.length - 1]?.visit_date && isValid(new Date(completedVisits[completedVisits.length - 1].visit_date)) ? differenceInDays(new Date(), new Date(completedVisits[completedVisits.length - 1].visit_date)) : 0}

VITAL SIGNS HISTORY (Last ${vitalHistory.length} readings):
${JSON.stringify(vitalHistory, null, 2)}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.map(cp => `
- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Target Date: ${cp.target_date || 'Ongoing'}
  Baseline: ${cp.baseline_measurement || 'Not documented'}
  Frequency: ${cp.frequency || 'Each visit'}
`).join('\n') || 'No active care plans'}

RECENT CLINICAL NOTES (Last ${visitNotes.length} visits):
${visitNotes.map(v => `
[${v.date}] ${v.type}:
${v.notes}
`).join('\n') || 'No clinical notes available'}

RECENT INCIDENTS (${recentIncidents.length}):
${recentIncidents.map(i => `- ${i.incident_date}: ${i.incident_type} - ${i.severity} severity`).join('\n') || 'No recent incidents'}

---

GENERATE A COMPREHENSIVE SUMMARY WITH:

1. **Patient Overview**: One-liner capturing who this patient is clinically
2. **Key Diagnoses & Conditions**: Primary concerns driving care
3. **Past Interventions Summary**: What has been done, what's working, what isn't
4. **Vital Signs Trends**: Patterns in BP, HR, weight, O2, pain - highlight concerning trends
5. **Current Clinical Status**: Stable/Improving/Declining with evidence
6. **Outstanding Issues**: Unresolved problems, pending follow-ups
7. **Care Plan Progress**: Status of active goals
8. **Risk Factors**: Fall risk, readmission risk, infection risk, etc.
9. **Today's Focus Areas**: What to prioritize this visit
10. **Clinical Narrative**: 3-4 sentence summary suitable for documentation

Return JSON:
{
  "patient_overview": "Concise one-liner about the patient",
  "key_diagnoses": [
    {"diagnosis": "Name", "significance": "Why it matters for care", "management": "Current approach"}
  ],
  "past_interventions": [
    {"intervention": "What was done", "outcome": "Result", "status": "ongoing|completed|discontinued"}
  ],
  "vital_trends": {
    "blood_pressure": {"trend": "stable|improving|worsening", "detail": "Specifics", "last_reading": "Value"},
    "heart_rate": {"trend": "stable|improving|worsening", "detail": "Specifics", "last_reading": "Value"},
    "weight": {"trend": "stable|improving|worsening", "detail": "Specifics", "last_reading": "Value"},
    "oxygen": {"trend": "stable|improving|worsening", "detail": "Specifics", "last_reading": "Value"},
    "pain": {"trend": "stable|improving|worsening", "detail": "Specifics", "last_reading": "Value"}
  },
  "clinical_status": {
    "status": "stable|improving|declining|critical",
    "evidence": ["Evidence point 1", "Evidence point 2"],
    "trajectory": "Expected path"
  },
  "outstanding_issues": [
    {"issue": "Description", "priority": "high|medium|low", "action_needed": "What to do"}
  ],
  "care_plan_progress": [
    {"goal": "Goal name", "progress": "On track|Behind|Ahead", "barriers": "Any barriers"}
  ],
  "risk_factors": [
    {"risk": "Risk type", "level": "high|medium|low", "mitigation": "How to address"}
  ],
  "focus_areas": ["Priority 1", "Priority 2", "Priority 3"],
  "clinical_narrative": "3-4 sentence summary for documentation",
  "stats": {
    "total_visits": number,
    "days_on_service": number,
    "active_care_plans": number,
    "recent_incidents": number,
    "last_visit_date": "date"
  }
}`,
        response_json_schema: {
          type: "object",
          properties: {
            patient_overview: { type: "string" },
            key_diagnoses: { type: "array", items: { type: "object" } },
            past_interventions: { type: "array", items: { type: "object" } },
            vital_trends: { type: "object" },
            clinical_status: { type: "object" },
            outstanding_issues: { type: "array", items: { type: "object" } },
            care_plan_progress: { type: "array", items: { type: "object" } },
            risk_factors: { type: "array", items: { type: "object" } },
            focus_areas: { type: "array", items: { type: "string" } },
            clinical_narrative: { type: "string" },
            stats: { type: "object" }
          }
        }
      });

      setSummary(result);
    } catch (error) {
      console.error("Error generating patient history summary:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, carePlans, incidents, calculateAge]);

  // Auto-generate on patient selection
  useEffect(() => {
    if (autoGenerate && patient && !summary) {
      generateSummary();
    }
  }, [patient, summary, autoGenerate, generateSummary]);

  const handleCopy = () => {
    if (summary?.clinical_narrative) {
      navigator.clipboard.writeText(summary.clinical_narrative);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleInsert = () => {
    if (summary?.clinical_narrative && onInsertSummary) {
      onInsertSummary(summary.clinical_narrative);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'stable': return 'bg-green-100 text-green-800 border-green-300';
      case 'improving': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'declining': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'stable': return <Minus className="w-4 h-4" />;
      case 'improving': return <TrendingUp className="w-4 h-4" />;
      case 'declining': return <TrendingDown className="w-4 h-4" />;
      case 'critical': return <AlertTriangle className="w-4 h-4" />;
      default: return null;
    }
  };

  const getTrendIcon = (trend) => {
    switch (trend) {
      case 'improving': return <TrendingUp className="w-3 h-3 text-green-600" />;
      case 'worsening': return <TrendingDown className="w-3 h-3 text-red-600" />;
      default: return <Minus className="w-3 h-3 text-slate-500" />;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800';
      case 'medium': return 'bg-yellow-100 text-yellow-800';
      case 'low': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  if (!patient) return null;

  return (
    <Card className={`border-2 ${prominent ? 'border-indigo-300 shadow-lg' : 'border-slate-200'} ${summary ? 'bg-gradient-to-br from-indigo-50 via-navy-50 to-gold-50' : ''}`}>
      <CardHeader 
        className={`py-3 cursor-pointer ${prominent ? 'bg-gradient-to-r from-indigo-100 to-navy-100' : 'bg-slate-50'}`}
        onClick={() => summary && setIsExpanded(!isExpanded)}
      >
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-600" />
            <span className="text-base font-semibold">AI Patient History Summary</span>
            {summary?.clinical_status && (
              <Badge className={`${getStatusColor(summary.clinical_status.status)} flex items-center gap-1`}>
                {getStatusIcon(summary.clinical_status.status)}
                {summary.clinical_status.status}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {summary && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); generateSummary(); }}
                  disabled={ai.loading}
                  className="h-7 px-2"
                >
                  <RefreshCw className={`w-3 h-3 ${ai.loading ? 'animate-spin' : ''}`} />
                </Button>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </>
            )}
            {ai.loading && <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-4">
        {!summary && !ai.loading && (
          <div className="text-center py-6">
            <History className="w-12 h-12 text-indigo-300 mx-auto mb-3" />
            <p className="text-slate-600 mb-4">Generate a comprehensive patient history summary</p>
            <Button
              onClick={generateSummary}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              <Brain className="w-4 h-4 mr-2" />
              Generate Summary
            </Button>
          </div>
        )}

        {ai.loading && !summary && (
          <div className="flex flex-col items-center justify-center py-8">
            <Loader2 className="w-10 h-10 animate-spin text-indigo-600 mb-3" />
            <p className="text-slate-600">Analyzing patient history...</p>
            <p className="text-xs text-slate-500 mt-1">Reviewing visits, vitals, care plans, and incidents</p>
          </div>
        )}

        {summary && isExpanded && (
          <div className="space-y-4">
            {/* Patient Overview - Prominent */}
            <div className="bg-white p-3 rounded-lg border-2 border-indigo-200 shadow-sm">
              <p className="text-base font-medium text-slate-900">{summary.patient_overview}</p>
            </div>

            {/* Quick Stats Row */}
            <div className="grid grid-cols-5 gap-2">
              <div className="bg-white p-2 rounded-lg border text-center">
                <Calendar className="w-4 h-4 mx-auto mb-1 text-indigo-500" />
                <p className="text-lg font-bold text-slate-900">{summary.stats?.total_visits || visits.length}</p>
                <p className="text-xs text-slate-500">Visits</p>
              </div>
              <div className="bg-white p-2 rounded-lg border text-center">
                <Clock className="w-4 h-4 mx-auto mb-1 text-blue-500" />
                <p className="text-lg font-bold text-slate-900">{summary.stats?.days_on_service || '—'}</p>
                <p className="text-xs text-slate-500">Days</p>
              </div>
              <div className="bg-white p-2 rounded-lg border text-center">
                <Target className="w-4 h-4 mx-auto mb-1 text-navy-500" />
                <p className="text-lg font-bold text-slate-900">{summary.stats?.active_care_plans || carePlans.filter(cp => cp.status === 'active').length}</p>
                <p className="text-xs text-slate-500">Goals</p>
              </div>
              <div className="bg-white p-2 rounded-lg border text-center">
                <AlertTriangle className="w-4 h-4 mx-auto mb-1 text-orange-500" />
                <p className="text-lg font-bold text-slate-900">{summary.stats?.recent_incidents || incidents.length}</p>
                <p className="text-xs text-slate-500">Incidents</p>
              </div>
              <div className="bg-white p-2 rounded-lg border text-center">
                <FileText className="w-4 h-4 mx-auto mb-1 text-green-500" />
                <p className="text-sm font-bold text-slate-900">{summary.stats?.last_visit_date && isValid(new Date(summary.stats.last_visit_date)) ? format(new Date(summary.stats.last_visit_date), 'MM/dd') : '—'}</p>
                <p className="text-xs text-slate-500">Last Visit</p>
              </div>
            </div>

            {/* Clinical Status */}
            <div className={`p-3 rounded-lg border-2 ${getStatusColor(summary.clinical_status?.status)}`}>
              <div className="flex items-center gap-2 mb-2">
                {getStatusIcon(summary.clinical_status?.status)}
                <span className="font-semibold capitalize">{summary.clinical_status?.status} Patient</span>
              </div>
              <ul className="text-sm space-y-1">
                {summary.clinical_status?.evidence?.map((e, i) => (
                  <li key={i} className="flex items-start gap-1">
                    <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{e}</span>
                  </li>
                ))}
              </ul>
              {summary.clinical_status?.trajectory && (
                <p className="text-xs mt-2 italic">Trajectory: {summary.clinical_status.trajectory}</p>
              )}
            </div>

            {/* Outstanding Issues - Alert Style */}
            {summary.outstanding_issues?.length > 0 && (
              <Alert className="bg-orange-50 border-orange-300">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                <AlertDescription>
                  <p className="font-semibold text-orange-800 mb-2">Outstanding Issues ({summary.outstanding_issues.length})</p>
                  <div className="space-y-2">
                    {summary.outstanding_issues.map((issue, idx) => (
                      <div key={idx} className="flex items-start gap-2 text-sm">
                        <Badge className={`${getPriorityColor(issue.priority)} text-xs`}>{issue.priority}</Badge>
                        <div>
                          <span className="font-medium">{issue.issue}</span>
                          {issue.action_needed && (
                            <p className="text-xs text-slate-600">→ {issue.action_needed}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Today's Focus Areas */}
            {summary.focus_areas?.length > 0 && (
              <div className="bg-navy-50 p-3 rounded-lg border border-navy-200">
                <p className="font-semibold text-navy-800 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4" />
                  Today's Focus Areas
                </p>
                <div className="flex flex-wrap gap-2">
                  {summary.focus_areas.map((focus, idx) => (
                    <Badge key={idx} className="bg-navy-100 text-navy-800 border-navy-300">
                      {idx + 1}. {focus}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Vital Signs Trends */}
            {summary.vital_trends && (
              <div className="bg-white p-3 rounded-lg border">
                <p className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  Vital Signs Trends
                </p>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  {Object.entries(summary.vital_trends).map(([vital, data]) => (
                    data && data.last_reading && (
                      <div key={vital} className="bg-slate-50 p-2 rounded border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium capitalize">{vital.replace('_', ' ')}</span>
                          {getTrendIcon(data.trend)}
                        </div>
                        <p className="text-sm font-bold">{data.last_reading}</p>
                        <p className="text-xs text-slate-500 truncate">{data.detail}</p>
                      </div>
                    )
                  ))}
                </div>
              </div>
            )}

            {/* AI Risk Stratification - Compact */}
            <PatientRiskStratification
              patient={patient}
              visits={visits}
              carePlans={carePlans}
              incidents={incidents}
              compact={true}
              autoCalculate={true}
            />

            {/* Risk Factors */}
            {summary.risk_factors?.length > 0 && (
              <div className="bg-white p-3 rounded-lg border">
                <p className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-500" />
                  Risk Factors
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {summary.risk_factors.map((risk, idx) => (
                    <div key={idx} className={`p-2 rounded border ${risk.level === 'high' ? 'bg-red-50 border-red-200' : risk.level === 'medium' ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'}`}>
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{risk.risk}</span>
                        <Badge className={getPriorityColor(risk.level)}>{risk.level}</Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-1">{risk.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Care Plan Progress */}
            {summary.care_plan_progress?.length > 0 && (
              <div className="bg-white p-3 rounded-lg border">
                <p className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-600" />
                  Care Plan Progress
                </p>
                <div className="space-y-2">
                  {summary.care_plan_progress.map((cp, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                      <span className="text-sm flex-1">{cp.goal}</span>
                      <Badge className={cp.progress === 'On track' ? 'bg-green-100 text-green-800' : cp.progress === 'Behind' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'}>
                        {cp.progress}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clinical Narrative - Insertable */}
            <div className="bg-indigo-100 p-3 rounded-lg border-2 border-indigo-300">
              <p className="font-semibold text-indigo-800 mb-2 flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Clinical Narrative Summary
              </p>
              <p className="text-sm text-indigo-900 italic leading-relaxed">"{summary.clinical_narrative}"</p>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="flex-1"
                >
                  {copied ? <><CheckCircle2 className="w-4 h-4 mr-1" /> Copied!</> : <><Copy className="w-4 h-4 mr-1" /> Copy</>}
                </Button>
                {onInsertSummary && (
                  <Button
                    size="sm"
                    onClick={handleInsert}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Insert into Notes
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {summary && !isExpanded && (
          <div className="text-sm text-slate-600">
            <p className="line-clamp-2">{summary.patient_overview}</p>
            <p className="text-indigo-600 mt-2 text-xs">Click header to expand full summary</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}