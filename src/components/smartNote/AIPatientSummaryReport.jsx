import { useState } from "react";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  Loader2,
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
  ChevronDown,
  ChevronUp,
  Sparkles
} from "lucide-react";

export default function AIPatientSummaryReport({
  patient,
  previousVisits = [],
  carePlans = [],
  onInsertSummary,
  compact = false
}) {
  const [summary, setSummary] = useState(null);
  const ai = useAICall();
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!compact);

  const generateSummary = async () => {
    if (!patient) return;

    try {
      const activeCarePlans = carePlans.filter(cp => cp.status === 'active');
      const recentVisits = previousVisits.slice(0, 5);
      const lastVisit = recentVisits[0];

      // Build visit history summary
      const visitHistory = recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        vitals: v.vital_signs,
        notes: v.nurse_notes?.substring(0, 300)
      }));

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate a concise clinical summary report for this patient. This will be used by nurses for quick context before/during visits.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
DOB: ${patient.date_of_birth || 'Unknown'}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Allergies: ${patient.allergies || 'NKDA'}
Care Type: ${patient.care_type}
Status: ${patient.status}

ACTIVE CARE PLAN GOALS (${activeCarePlans.length}):
${activeCarePlans.map(cp => `- Problem: ${cp.problem}\n  Goal: ${cp.goal}\n  Target: ${cp.target_date || 'Ongoing'}`).join('\n') || 'None'}

RECENT VISIT HISTORY (Last ${recentVisits.length} visits):
${JSON.stringify(visitHistory, null, 2)}

LAST VISIT DETAILS:
${lastVisit ? `
Date: ${lastVisit.visit_date}
Type: ${lastVisit.visit_type}
Vitals: ${lastVisit.vital_signs ? JSON.stringify(lastVisit.vital_signs) : 'None'}
Notes: ${lastVisit.nurse_notes || 'None'}
` : 'No previous visits'}

Generate a structured clinical summary with:
1. One-liner patient overview (diagnosis, key concerns)
2. Current clinical status (stable/improving/declining with rationale)
3. Key vitals trends (any concerning patterns)
4. Active care priorities (what to focus on)
5. Recent interventions summary
6. Alerts/concerns for today's visit
7. A brief narrative paragraph suitable for inserting into clinical notes

Return JSON:
{
  "one_liner": "Brief patient overview in one sentence",
  "clinical_status": {
    "status": "stable" | "improving" | "declining" | "critical",
    "rationale": "Why this status"
  },
  "vital_trends": [
    {"vital": "BP/HR/Weight/etc", "trend": "stable" | "improving" | "worsening", "detail": "specifics"}
  ],
  "care_priorities": ["priority 1", "priority 2"],
  "recent_interventions": ["intervention 1", "intervention 2"],
  "alerts": ["alert 1 if any"],
  "narrative_summary": "2-3 sentence clinical narrative suitable for note insertion",
  "days_on_service": number,
  "total_visits": number,
  "last_visit_date": "date string"
}`,
        response_json_schema: {
          type: "object",
          properties: {
            one_liner: { type: "string" },
            clinical_status: { type: "object" },
            vital_trends: { type: "array", items: { type: "object" } },
            care_priorities: { type: "array", items: { type: "string" } },
            recent_interventions: { type: "array", items: { type: "string" } },
            alerts: { type: "array", items: { type: "string" } },
            narrative_summary: { type: "string" },
            days_on_service: { type: "number" },
            total_visits: { type: "number" },
            last_visit_date: { type: "string" }
          }
        }
      });

      setSummary(result);
      setIsExpanded(true);
    } catch (error) {
      console.error("Error generating summary:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const handleCopy = () => {
    if (summary?.narrative_summary) {
      navigator.clipboard.writeText(summary.narrative_summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleInsert = () => {
    if (summary?.narrative_summary && onInsertSummary) {
      onInsertSummary(summary.narrative_summary);
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
      case 'stable': return <Minus className="w-3 h-3" />;
      case 'improving': return <TrendingUp className="w-3 h-3" />;
      case 'declining': return <TrendingDown className="w-3 h-3" />;
      case 'critical': return <AlertTriangle className="w-3 h-3" />;
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

  if (!patient) {
    return null;
  }

  return (
    <Card className={`border-2 ${summary ? 'border-indigo-300 bg-gradient-to-br from-indigo-50 to-navy-50' : 'border-slate-200'}`}>
      <CardHeader 
        className="py-2 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => summary && setIsExpanded(!isExpanded)}
      >
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <span>AI Patient Summary</span>
          </div>
          <div className="flex items-center gap-2">
            {summary?.clinical_status && (
              <Badge className={`${getStatusColor(summary.clinical_status.status)} text-xs flex items-center gap-1`}>
                {getStatusIcon(summary.clinical_status.status)}
                {summary.clinical_status.status}
              </Badge>
            )}
            {summary && (isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />)}
          </div>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3">
        {!summary ? (
          <Button
            onClick={generateSummary}
            disabled={ai.loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            size="sm"
          >
            {ai.loading ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Summary...</>
            ) : (
              <><FileText className="w-4 h-4 mr-2" /> Generate Patient Summary</>
            )}
          </Button>
        ) : isExpanded ? (
          <div className="space-y-3">
            {/* One-liner Overview */}
            <div className="bg-white p-2 rounded-lg border">
              <p className="text-sm font-medium text-slate-900">{summary.one_liner}</p>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="bg-white p-2 rounded border text-center">
                <Calendar className="w-3 h-3 mx-auto mb-1 text-slate-500" />
                <span className="font-bold">{summary.total_visits || previousVisits.length}</span>
                <p className="text-slate-500">Visits</p>
              </div>
              <div className="bg-white p-2 rounded border text-center">
                <Clock className="w-3 h-3 mx-auto mb-1 text-slate-500" />
                <span className="font-bold">{summary.days_on_service || '—'}</span>
                <p className="text-slate-500">Days</p>
              </div>
              <div className="bg-white p-2 rounded border text-center">
                <Target className="w-3 h-3 mx-auto mb-1 text-slate-500" />
                <span className="font-bold">{carePlans.filter(cp => cp.status === 'active').length}</span>
                <p className="text-slate-500">Goals</p>
              </div>
            </div>

            {/* Clinical Status */}
            <div className={`p-2 rounded-lg border ${getStatusColor(summary.clinical_status?.status)}`}>
              <div className="flex items-center gap-1 text-xs font-semibold mb-1">
                {getStatusIcon(summary.clinical_status?.status)}
                <span className="capitalize">{summary.clinical_status?.status}</span>
              </div>
              <p className="text-xs">{summary.clinical_status?.rationale}</p>
            </div>

            {/* Alerts */}
            {summary.alerts?.length > 0 && (
              <Alert className="bg-red-50 border-red-200 py-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-xs text-red-800">
                  {summary.alerts.map((alert, idx) => (
                    <div key={idx}>• {alert}</div>
                  ))}
                </AlertDescription>
              </Alert>
            )}

            {/* Vital Trends */}
            {summary.vital_trends?.length > 0 && (
              <div className="bg-white p-2 rounded-lg border">
                <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Activity className="w-3 h-3" /> Vital Trends
                </p>
                <div className="space-y-1">
                  {summary.vital_trends.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      {getTrendIcon(v.trend)}
                      <span className="font-medium">{v.vital}:</span>
                      <span className="text-slate-600">{v.detail}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Care Priorities */}
            {summary.care_priorities?.length > 0 && (
              <div className="bg-white p-2 rounded-lg border">
                <p className="text-xs font-semibold text-slate-700 mb-1 flex items-center gap-1">
                  <Target className="w-3 h-3 text-navy-600" /> Care Priorities
                </p>
                <div className="flex flex-wrap gap-1">
                  {summary.care_priorities.map((p, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">{p}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Narrative Summary */}
            <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-200">
              <p className="text-xs font-semibold text-indigo-800 mb-1">📋 Narrative Summary</p>
              <p className="text-xs text-indigo-900 italic">"{summary.narrative_summary}"</p>
              <div className="flex gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs flex-1"
                  onClick={handleCopy}
                >
                  {copied ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Copied!</> : <><Copy className="w-3 h-3 mr-1" /> Copy</>}
                </Button>
                {onInsertSummary && (
                  <Button
                    size="sm"
                    className="h-6 text-xs flex-1 bg-indigo-600 hover:bg-indigo-700"
                    onClick={handleInsert}
                  >
                    Insert into Notes
                  </Button>
                )}
              </div>
            </div>

            {/* Refresh */}
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-xs"
              onClick={generateSummary}
              disabled={ai.loading}
            >
              {ai.loading ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Sparkles className="w-3 h-3 mr-1" />}
              Refresh Summary
            </Button>
          </div>
        ) : (
          <div className="text-xs text-slate-600">
            <p className="truncate">{summary.one_liner}</p>
            <p className="text-indigo-600 mt-1">Click to expand</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}