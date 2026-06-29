import { useState, useEffect, useCallback } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  Calendar,
  FileText,
  Activity,
  RefreshCw,
  Loader2
} from "lucide-react";
import { isValid } from "date-fns";

export default function AIPatientDashboardSummary({ 
  patient, 
  visits = [], 
  carePlans = [],
  tasks = [],
  incidents = []
}) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();

  const generateSummary = useCallback(async () => {
    try {
      // Get recent visits (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const recentVisits = visits.filter(v => {
        const visitDate = new Date(v.visit_date);
        return isValid(visitDate) && visitDate >= thirtyDaysAgo;
      }).slice(0, 10);

      // Get upcoming visits
      const today = new Date();
      const upcomingVisits = visits.filter(v => {
        const visitDate = new Date(v.visit_date);
        return v.status === 'scheduled' && isValid(visitDate) && visitDate >= today;
      }).slice(0, 5);

      // Get active care plans
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');

      // Get pending tasks
      const pendingTasks = tasks.filter(t => t.status === 'pending');

      // Get recent incidents
      const recentIncidents = incidents.slice(0, 3);

      const prompt = `You are an expert home health clinical coordinator providing a concise, actionable patient status summary for the care team.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Status: ${patient.status}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not documented'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Allergies: ${patient.allergies || 'None documented'}

RECENT ACTIVITY (Last 30 Days):
${recentVisits.length > 0 ? recentVisits.map(v => `- ${v.visit_date}: ${v.visit_type} (${v.status})`).join('\n') : '- No recent visits'}

UPCOMING APPOINTMENTS:
${upcomingVisits.length > 0 ? upcomingVisits.map(v => `- ${v.visit_date} at ${v.visit_time || 'TBD'}: ${v.visit_type}`).join('\n') : '- No scheduled visits'}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.length > 0 ? activeCarePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') : '- None'}

PENDING TASKS (${pendingTasks.length}):
${pendingTasks.length > 0 ? pendingTasks.slice(0, 5).map(t => `- ${t.title} (${t.priority} priority)`).join('\n') : '- None'}

RECENT INCIDENTS:
${recentIncidents.length > 0 ? recentIncidents.map(i => `- ${i.incident_type}: ${i.severity} severity`).join('\n') : '- None'}

Provide a comprehensive yet concise dashboard summary in JSON:
{
  "overall_status": "stable/improving/declining/critical",
  "status_reason": "1-2 sentence explanation of overall status",
  "key_highlights": ["3-5 most important current facts about patient"],
  "clinical_trends": {
    "direction": "improving/stable/declining",
    "indicators": ["specific observations supporting the trend"]
  },
  "priority_concerns": [
    {
      "concern": "specific issue",
      "severity": "high/medium/low",
      "action_needed": "what to do"
    }
  ],
  "recent_activity_summary": "1-2 sentences about recent care",
  "upcoming_focus": ["2-3 key things to focus on in upcoming visits"],
  "care_plan_progress": "brief assessment of how patient is progressing on goals",
  "recommendations": ["3-5 actionable recommendations for care team"],
  "next_visit_priorities": ["what to prioritize in next visit"],
  "red_flags": ["any concerning patterns or issues requiring immediate attention"]
}`;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            overall_status: { type: "string" },
            status_reason: { type: "string" },
            key_highlights: { type: "array", items: { type: "string" } },
            clinical_trends: { type: "object" },
            priority_concerns: { type: "array", items: { type: "object" } },
            recent_activity_summary: { type: "string" },
            upcoming_focus: { type: "array", items: { type: "string" } },
            care_plan_progress: { type: "string" },
            recommendations: { type: "array", items: { type: "string" } },
            next_visit_priorities: { type: "array", items: { type: "string" } },
            red_flags: { type: "array", items: { type: "string" } }
          }
        }
      });

      setSummary(result);
    } catch (error) {
      console.error("Error generating summary:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [patient, visits, carePlans, tasks, incidents]);

  useEffect(() => {
    if (patient) {
      generateSummary();
    }
  }, [patient, patient?.id, generateSummary]);

  const getStatusColor = (status) => {
    const colors = {
      stable: "bg-green-100 text-green-800 border-green-300",
      improving: "bg-blue-100 text-blue-800 border-blue-300",
      declining: "bg-orange-100 text-orange-800 border-orange-300",
      critical: "bg-red-100 text-red-800 border-red-300"
    };
    return colors[status] || colors.stable;
  };

  const getStatusIcon = (status) => {
    if (status === 'improving') return <TrendingUp className="w-5 h-5" />;
    if (status === 'declining') return <TrendingDown className="w-5 h-5" />;
    if (status === 'critical') return <AlertCircle className="w-5 h-5" />;
    return <CheckCircle2 className="w-5 h-5" />;
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
        <CardContent className="p-6 text-center">
          <Loader2 className="w-8 h-8 text-navy-600 mx-auto mb-3 animate-spin" />
          <p className="text-sm font-medium text-navy-900">Generating AI Summary...</p>
        </CardContent>
      </Card>
    );
  }

  if (!summary) {
    return (
      <Card className="border-2 border-navy-300">
        <CardContent className="p-4">
          <Button onClick={generateSummary} className="bg-navy-600 hover:bg-navy-700">
            <Sparkles className="w-4 h-4 mr-2" />
            Generate AI Summary
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-navy-300 bg-gradient-to-br from-navy-50 to-gold-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-navy-600" />
            AI Patient Dashboard Summary
          </CardTitle>
          <Button size="sm" variant="outline" onClick={generateSummary}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall Status */}
        <Alert className={getStatusColor(summary.overall_status)}>
          <div className="flex items-start gap-2">
            {getStatusIcon(summary.overall_status)}
            <div>
              <p className="font-semibold mb-1 capitalize">{summary.overall_status} Status</p>
              <p className="text-sm">{summary.status_reason}</p>
            </div>
          </div>
        </Alert>

        {/* Red Flags */}
        {summary.red_flags?.length > 0 && (
          <Alert className="bg-red-50 border-red-300">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <AlertDescription>
              <p className="font-semibold text-red-900 mb-2">⚠️ Red Flags</p>
              <ul className="space-y-1">
                {summary.red_flags.map((flag, idx) => (
                  <li key={idx} className="text-sm text-red-800">• {flag}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Key Highlights */}
        <div className="bg-white p-3 rounded-lg border border-navy-200">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1">
            <Activity className="w-4 h-4 text-navy-600" />
            Key Highlights
          </h4>
          <ul className="space-y-1">
            {summary.key_highlights?.map((highlight, idx) => (
              <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                <span className="text-navy-600 font-bold">•</span>
                {highlight}
              </li>
            ))}
          </ul>
        </div>

        {/* Clinical Trends */}
        {summary.clinical_trends && (
          <div className="bg-white p-3 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1">
              {summary.clinical_trends.direction === 'improving' ? (
                <TrendingUp className="w-4 h-4 text-green-600" />
              ) : summary.clinical_trends.direction === 'declining' ? (
                <TrendingDown className="w-4 h-4 text-red-600" />
              ) : (
                <Activity className="w-4 h-4 text-blue-600" />
              )}
              Clinical Trends: <span className="capitalize">{summary.clinical_trends.direction}</span>
            </h4>
            <ul className="space-y-1">
              {summary.clinical_trends.indicators?.map((indicator, idx) => (
                <li key={idx} className="text-xs text-slate-600">• {indicator}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Priority Concerns */}
        {summary.priority_concerns?.length > 0 && (
          <div className="space-y-2">
            <h4 className="font-semibold text-sm">Priority Concerns</h4>
            {summary.priority_concerns.map((concern, idx) => (
              <div key={idx} className="bg-white p-3 rounded-lg border border-orange-200">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-900">{concern.concern}</p>
                  <Badge className={
                    concern.severity === 'high' ? 'bg-red-600' :
                    concern.severity === 'medium' ? 'bg-orange-500' : 'bg-yellow-500'
                  }>
                    {concern.severity}
                  </Badge>
                </div>
                <p className="text-xs text-slate-700">Action: {concern.action_needed}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recent Activity */}
        <div className="bg-white p-3 rounded-lg border">
          <h4 className="font-semibold text-sm mb-2 flex items-center gap-1">
            <FileText className="w-4 h-4 text-slate-600" />
            Recent Activity
          </h4>
          <p className="text-sm text-slate-700">{summary.recent_activity_summary}</p>
        </div>

        {/* Care Plan Progress */}
        {summary.care_plan_progress && (
          <div className="bg-white p-3 rounded-lg border border-green-200">
            <h4 className="font-semibold text-sm mb-2">Care Plan Progress</h4>
            <p className="text-sm text-slate-700">{summary.care_plan_progress}</p>
          </div>
        )}

        {/* Next Visit Priorities */}
        {summary.next_visit_priorities?.length > 0 && (
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-sm mb-2 flex items-center gap-1">
              <Calendar className="w-4 h-4 text-blue-600" />
              Next Visit Priorities
            </h4>
            <ul className="space-y-1">
              {summary.next_visit_priorities.map((priority, idx) => (
                <li key={idx} className="text-sm text-blue-900">
                  {idx + 1}. {priority}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Recommendations */}
        {summary.recommendations?.length > 0 && (
          <div className="bg-navy-50 p-3 rounded-lg border border-navy-200">
            <h4 className="font-semibold text-sm mb-2">Recommendations</h4>
            <ul className="space-y-1">
              {summary.recommendations.map((rec, idx) => (
                <li key={idx} className="text-sm text-navy-900">• {rec}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Upcoming Focus */}
        {summary.upcoming_focus?.length > 0 && (
          <div className="bg-gradient-to-r from-indigo-50 to-navy-50 p-3 rounded-lg border border-indigo-200">
            <h4 className="font-semibold text-sm mb-2">Upcoming Focus Areas</h4>
            <ul className="space-y-1">
              {summary.upcoming_focus.map((focus, idx) => (
                <li key={idx} className="text-sm text-indigo-900">• {focus}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}