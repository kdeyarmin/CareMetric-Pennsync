import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  RefreshCw,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Calendar,
  Activity,
  FileText,
  Target
} from "lucide-react";
import { format } from "date-fns";
import { toast } from 'sonner';

export default function AIPatientSummary({ patient }) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [copied, setCopied] = useState(false);

  const { data: visits } = useQuery({
    queryKey: ['patientVisits', patient?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient.id }, '-visit_date', 10),
    enabled: !!patient?.id,
    initialData: [],
  });

  const { data: incidents } = useQuery({
    queryKey: ['patientIncidents', patient?.id],
    queryFn: () => base44.entities.Incident.filter({ patient_id: patient.id }, '-incident_date', 10),
    enabled: !!patient?.id,
    initialData: [],
  });

  const { data: carePlans } = useQuery({
    queryKey: ['patientCarePlans', patient?.id],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patient.id }),
    enabled: !!patient?.id,
    initialData: [],
  });

  const generateSummary = async () => {
    if (!patient) {
      toast.error('No patient selected');
      return;
    }
    
    try {
      const recentVisits = visits.slice(0, 5);
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentIncidents = incidents.slice(0, 5);

      const prompt = `You are a clinical documentation specialist. Generate a concise, comprehensive patient summary for a home health/hospice clinician.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- DOB: ${patient.date_of_birth || 'Not recorded'}
- MRN: ${patient.medical_record_number || 'N/A'}
- Care Type: ${patient.care_type === 'hospice' ? 'Hospice' : 'Home Health'}
- Status: ${patient.status || 'Active'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}

RECENT VISITS (Last 5):
${recentVisits.length > 0 ? recentVisits.map(v => `- ${v.visit_date}: ${(v.visit_type || '').replace(/_/g, ' ')} - ${v.status}
  ${v.vital_signs ? `Vitals: BP ${v.vital_signs.blood_pressure_systolic || '?'}/${v.vital_signs.blood_pressure_diastolic || '?'}, HR ${v.vital_signs.heart_rate || '?'}, O2 ${v.vital_signs.oxygen_saturation || '?'}%` : ''}
  ${v.nurse_notes ? `Notes excerpt: ${v.nurse_notes.substring(0, 200)}...` : ''}`).join('\n') : 'No recent visits'}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.length > 0 ? activeCarePlans.map(cp => `- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Status: ${cp.status}`).join('\n') : 'No active care plans'}

RECENT INCIDENTS:
${recentIncidents.length > 0 ? recentIncidents.map(i => `- ${i.incident_date}: ${(i.incident_type || '').replace(/_/g, ' ')} (${i.severity || 'unknown'} severity)`).join('\n') : 'No recent incidents'}

Generate a clinical summary in JSON format:
{
  "overview": "2-3 sentence overview of patient status and primary concerns",
  "clinical_status": "Current clinical status assessment",
  "key_findings": ["List of 3-5 key clinical findings from recent visits"],
  "active_issues": ["List of active clinical issues requiring attention"],
  "care_plan_progress": "Brief summary of care plan progress",
  "risk_factors": ["List of identified risk factors"],
  "recommendations": ["2-3 clinical recommendations for upcoming visits"],
  "priority_level": "low|medium|high|critical"
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overview: { type: "string" },
            clinical_status: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            active_issues: { type: "array", items: { type: "string" } },
            care_plan_progress: { type: "string" },
            risk_factors: { type: "array", items: { type: "string" } },
            recommendations: { type: "array", items: { type: "string" } },
            priority_level: { type: "string" }
          }
        }
      });

      setSummary({
        ...result,
        generated_at: new Date().toISOString(),
        visit_count: visits.length,
        incident_count: incidents.length,
        care_plan_count: activeCarePlans.length
      });
    } catch (error) {
      console.error('Error generating summary:', error);
      toast.error('Failed to generate summary. Please try again.');
    }
  };

  const handleCopy = () => {
    const text = `
PATIENT SUMMARY: ${patient.first_name} ${patient.last_name}
Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}

OVERVIEW:
${summary.overview}

CLINICAL STATUS:
${summary.clinical_status}

KEY FINDINGS:
${summary.key_findings?.map(f => `• ${f}`).join('\n')}

ACTIVE ISSUES:
${summary.active_issues?.map(i => `• ${i}`).join('\n')}

CARE PLAN PROGRESS:
${summary.care_plan_progress}

RISK FACTORS:
${summary.risk_factors?.map(r => `• ${r}`).join('\n')}

RECOMMENDATIONS:
${summary.recommendations?.map(r => `• ${r}`).join('\n')}
    `.trim();
    
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getPriorityColor = (level) => {
    switch (level) {
      case 'critical': return 'bg-red-500 text-white';
      case 'high': return 'bg-orange-500 text-white';
      case 'medium': return 'bg-yellow-500 text-black';
      case 'low': return 'bg-green-500 text-white';
      default: return 'bg-slate-500 text-white';
    }
  };

  if (!patient) return null;

  return (
    <Card className="border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Patient Summary
          </CardTitle>
          <Button
            onClick={generateSummary}
            disabled={ai.loading}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700"
          >
            {ai.loading ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                {summary ? 'Regenerate' : 'Generate Summary'}
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {!summary && !ai.loading && (
          <div className="text-center py-8 text-slate-500">
            <Sparkles className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p>Click "Generate Summary" to create an AI-powered clinical overview</p>
            <p className="text-sm mt-2">
              Synthesizes data from {visits.length} visits, {incidents.length} incidents, and {carePlans.filter(cp => cp.status === 'active').length} active care plans
            </p>
          </div>
        )}

        {summary && (
          <div className="space-y-4">
            {/* Header with stats */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge className={getPriorityColor(summary.priority_level)}>
                  {summary.priority_level?.toUpperCase()} Priority
                </Badge>
                <span className="text-xs text-slate-500">
                  Generated {format(new Date(summary.generated_at), 'MMM d, h:mm a')}
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleCopy}>
                {copied ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-blue-50 rounded-lg p-2 text-center">
                <Calendar className="w-4 h-4 text-blue-600 mx-auto" />
                <p className="text-lg font-bold text-blue-700">{summary.visit_count}</p>
                <p className="text-xs text-blue-600">Visits</p>
              </div>
              <div className="bg-orange-50 rounded-lg p-2 text-center">
                <AlertTriangle className="w-4 h-4 text-orange-600 mx-auto" />
                <p className="text-lg font-bold text-orange-700">{summary.incident_count}</p>
                <p className="text-xs text-orange-600">Incidents</p>
              </div>
              <div className="bg-green-50 rounded-lg p-2 text-center">
                <Target className="w-4 h-4 text-green-600 mx-auto" />
                <p className="text-lg font-bold text-green-700">{summary.care_plan_count}</p>
                <p className="text-xs text-green-600">Care Plans</p>
              </div>
            </div>

            {/* Overview */}
            <Alert className="bg-navy-50 border-navy-200">
              <AlertDescription className="text-navy-900">
                <strong>Overview:</strong> {summary.overview}
              </AlertDescription>
            </Alert>

            {/* Clinical Status */}
            <div>
              <h4 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-1">
                <Activity className="w-4 h-4" /> Clinical Status
              </h4>
              <p className="text-sm text-slate-700">{summary.clinical_status}</p>
            </div>

            {/* Key Findings */}
            {summary.key_findings?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-1">
                  <FileText className="w-4 h-4" /> Key Findings
                </h4>
                <ul className="list-disc ml-5 text-sm text-slate-700 space-y-1">
                  {summary.key_findings.map((finding, idx) => (
                    <li key={idx}>{finding}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Active Issues */}
            {summary.active_issues?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-orange-600" /> Active Issues
                </h4>
                <div className="flex flex-wrap gap-1">
                  {summary.active_issues.map((issue, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs border-orange-200 text-orange-700">
                      {issue}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Factors */}
            {summary.risk_factors?.length > 0 && (
              <div>
                <h4 className="font-semibold text-slate-900 text-sm mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4 text-red-600" /> Risk Factors
                </h4>
                <div className="flex flex-wrap gap-1">
                  {summary.risk_factors.map((risk, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs border-red-200 text-red-700">
                      {risk}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Recommendations */}
            {summary.recommendations?.length > 0 && (
              <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                <h4 className="font-semibold text-green-900 text-sm mb-2">💡 Recommendations</h4>
                <ul className="list-disc ml-5 text-sm text-green-800 space-y-1">
                  {summary.recommendations.map((rec, idx) => (
                    <li key={idx}>{rec}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}