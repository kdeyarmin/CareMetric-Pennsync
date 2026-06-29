import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FileText,
  Download,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  BarChart3,
  Shield,
  ChevronDown,
  ChevronUp,
  Printer
} from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth } from "date-fns";

export default function AutomatedComplianceReporting({ _nurseEmail, isAdmin = false }) {
  const ai = useAICall();
  const [report, setReport] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [reportPeriod, setReportPeriod] = useState("last_7_days");

  const { data: visits = [] } = useQuery({
    queryKey: ['allVisits'],
    queryFn: () => base44.entities.Visit.filter({ status: 'completed' }, '-visit_date', 100),
  });

  const { data: incidents = [] } = useQuery({
    queryKey: ['allIncidents'],
    queryFn: () => base44.entities.Incident.list('-incident_date'),
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
  });

  const { data: _securityLogs = [] } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.filter({}, '-timestamp', 200),
    enabled: isAdmin
  });

  const generateReport = async () => {

    try {
      // Calculate date range
      let startDate, endDate = new Date();
      switch (reportPeriod) {
        case 'last_7_days':
          startDate = subDays(new Date(), 7);
          break;
        case 'last_30_days':
          startDate = subDays(new Date(), 30);
          break;
        case 'this_month':
          startDate = startOfMonth(new Date());
          endDate = endOfMonth(new Date());
          break;
        default:
          startDate = subDays(new Date(), 7);
      }

      // Filter data by period
      const periodVisits = visits.filter(v => 
        new Date(v.visit_date) >= startDate && new Date(v.visit_date) <= endDate
      );

      const periodIncidents = incidents.filter(i =>
        new Date(i.incident_date) >= startDate && new Date(i.incident_date) <= endDate
      );

      // Prepare data summary
      const dataSummary = {
        period: `${format(startDate, 'MMM d, yyyy')} - ${format(endDate, 'MMM d, yyyy')}`,
        total_visits: periodVisits.length,
        visits_with_notes: periodVisits.filter(v => v.nurse_notes).length,
        visits_without_notes: periodVisits.filter(v => !v.nurse_notes).length,
        visit_types: {},
        incident_count: periodIncidents.length,
        incident_types: {},
        patient_count: patients.length,
        active_patients: patients.filter(p => p.status === 'active').length
      };

      // Count visit types
      periodVisits.forEach(v => {
        dataSummary.visit_types[v.visit_type] = (dataSummary.visit_types[v.visit_type] || 0) + 1;
      });

      // Count incident types
      periodIncidents.forEach(i => {
        dataSummary.incident_types[i.incident_type] = (dataSummary.incident_types[i.incident_type] || 0) + 1;
      });

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are a healthcare compliance reporting AI. Generate a comprehensive compliance report based on this data.

DATA SUMMARY:
${JSON.stringify(dataSummary, null, 2)}

Generate a detailed compliance report that includes:
1. Executive summary
2. Documentation compliance metrics
3. Incident analysis
4. Risk areas identified
5. Recommendations for improvement
6. Audit trail summary (if security logs available)

Return JSON:
{
  "report_title": "Compliance Report",
  "report_period": "date range",
  "generated_at": "timestamp",
  "executive_summary": "brief overview",
  "compliance_score": 0-100,
  "metrics": {
    "documentation_rate": percentage,
    "on_time_documentation": percentage,
    "incident_rate": per 100 visits,
    "high_severity_incidents": count
  },
  "strengths": ["strength 1", "strength 2"],
  "areas_of_concern": [
    {
      "concern": "description",
      "severity": "high/medium/low",
      "recommendation": "action to take"
    }
  ],
  "visit_analysis": {
    "total": number,
    "by_type": {"type": count},
    "documentation_gaps": ["gap 1", "gap 2"]
  },
  "incident_analysis": {
    "total": number,
    "by_type": {"type": count},
    "trends": "analysis of incident patterns",
    "preventive_actions": ["action 1", "action 2"]
  },
  "recommendations": [
    {
      "priority": "high/medium/low",
      "recommendation": "what to do",
      "expected_impact": "what it will improve"
    }
  ],
  "audit_findings": ["finding 1", "finding 2"],
  "next_steps": ["step 1", "step 2"]
}`,
        response_json_schema: {
          type: "object",
          properties: {
            report_title: { type: "string" },
            report_period: { type: "string" },
            generated_at: { type: "string" },
            executive_summary: { type: "string" },
            compliance_score: { type: "number" },
            metrics: { type: "object" },
            strengths: { type: "array", items: { type: "string" } },
            areas_of_concern: { type: "array" },
            visit_analysis: { type: "object" },
            incident_analysis: { type: "object" },
            recommendations: { type: "array" },
            audit_findings: { type: "array", items: { type: "string" } },
            next_steps: { type: "array", items: { type: "string" } }
          }
        }
      });

      setReport(result);

    } catch (error) {
      console.error("Error generating report:", error);
      toast.error("The AI request didn't complete. Please try again.");
    }

  };

  const downloadReport = () => {
    if (!report) return;

    const reportText = `
COMPLIANCE REPORT
=================
${report.report_title}
Period: ${report.report_period}
Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}

EXECUTIVE SUMMARY
-----------------
${report.executive_summary}

COMPLIANCE SCORE: ${report.compliance_score}%

KEY METRICS
-----------
• Documentation Rate: ${report.metrics?.documentation_rate}%
• On-time Documentation: ${report.metrics?.on_time_documentation}%
• Incident Rate: ${report.metrics?.incident_rate} per 100 visits
• High Severity Incidents: ${report.metrics?.high_severity_incidents}

STRENGTHS
---------
${report.strengths?.map(s => `• ${s}`).join('\n')}

AREAS OF CONCERN
----------------
${report.areas_of_concern?.map(c => `• [${(c.severity || 'unknown').toUpperCase()}] ${c.concern}\n  Recommendation: ${c.recommendation}`).join('\n\n')}

RECOMMENDATIONS
---------------
${report.recommendations?.map(r => `• [${(r.priority || 'unknown').toUpperCase()}] ${r.recommendation}\n  Expected Impact: ${r.expected_impact}`).join('\n\n')}

NEXT STEPS
----------
${report.next_steps?.map((s, i) => `${i + 1}. ${s}`).join('\n')}
    `;

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compliance_report_${format(new Date(), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600 bg-green-100';
    if (score >= 70) return 'text-yellow-600 bg-yellow-100';
    return 'text-red-600 bg-red-100';
  };

  return (
    <Card className="border-emerald-200">
      <CardHeader 
        className="py-3 bg-gradient-to-r from-emerald-50 to-navy-50 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-600" />
            Automated Compliance Reports
          </CardTitle>
          <div className="flex items-center gap-2">
            {report && (
              <Badge className={getScoreColor(report.compliance_score)}>
                Score: {report.compliance_score}%
              </Badge>
            )}
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </div>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="p-4 space-y-4">
          {/* Report Period Selector */}
          <div className="flex items-center gap-2">
            <Select value={reportPeriod} onValueChange={setReportPeriod}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="last_7_days">Last 7 Days</SelectItem>
                <SelectItem value="last_30_days">Last 30 Days</SelectItem>
                <SelectItem value="this_month">This Month</SelectItem>
              </SelectContent>
            </Select>
            <Button
              onClick={generateReport}
              disabled={ai.loading}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {ai.loading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  Generate Report
                </>
              )}
            </Button>
          </div>

          {report && (
            <>
              {/* Compliance Score */}
              <div className={`p-4 rounded-lg text-center ${getScoreColor(report.compliance_score)}`}>
                <p className="text-3xl font-bold">{report.compliance_score}%</p>
                <p className="text-sm">Overall Compliance Score</p>
              </div>

              {/* Executive Summary */}
              <Alert className="bg-blue-50 border-blue-200">
                <Shield className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-900">
                  <p className="font-semibold text-sm mb-1">Executive Summary</p>
                  <p className="text-xs">{report.executive_summary}</p>
                </AlertDescription>
              </Alert>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="text-center p-2 bg-slate-50 rounded">
                  <p className="text-lg font-bold text-slate-900">{report.metrics?.documentation_rate}%</p>
                  <p className="text-xs text-slate-600">Doc Rate</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded">
                  <p className="text-lg font-bold text-slate-900">{report.metrics?.on_time_documentation}%</p>
                  <p className="text-xs text-slate-600">On-Time</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded">
                  <p className="text-lg font-bold text-slate-900">{report.metrics?.incident_rate}</p>
                  <p className="text-xs text-slate-600">Incident Rate</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded">
                  <p className="text-lg font-bold text-slate-900">{report.metrics?.high_severity_incidents}</p>
                  <p className="text-xs text-slate-600">High Severity</p>
                </div>
              </div>

              {/* Strengths */}
              {report.strengths?.length > 0 && (
                <div className="bg-green-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-green-800 mb-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Strengths
                  </p>
                  <ul className="text-xs text-green-700 space-y-0.5">
                    {report.strengths.map((s, idx) => (
                      <li key={idx}>• {s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Areas of Concern */}
              {report.areas_of_concern?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Areas of Concern
                  </p>
                  {report.areas_of_concern.map((concern, idx) => (
                    <div key={idx} className={`p-2 rounded text-xs ${
                      concern.severity === 'high' ? 'bg-red-50 border-l-2 border-red-500' :
                      concern.severity === 'medium' ? 'bg-yellow-50 border-l-2 border-yellow-500' :
                      'bg-slate-50 border-l-2 border-slate-300'
                    }`}>
                      <p className="font-medium">{concern.concern}</p>
                      <p className="text-slate-600 mt-0.5">→ {concern.recommendation}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Recommendations */}
              {report.recommendations?.length > 0 && (
                <div className="bg-indigo-50 p-3 rounded-lg">
                  <p className="text-xs font-semibold text-indigo-800 mb-2">📋 Recommendations:</p>
                  {report.recommendations.slice(0, 3).map((rec, idx) => (
                    <div key={idx} className="text-xs mb-2 last:mb-0">
                      <Badge className={
                        rec.priority === 'high' ? 'bg-red-500' :
                        rec.priority === 'medium' ? 'bg-yellow-500' :
                        'bg-blue-500'
                      } style={{ fontSize: '9px' }}>
                        {rec.priority}
                      </Badge>
                      <span className="ml-1 text-indigo-900">{rec.recommendation}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Download Button */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadReport}
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download Report
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.print()}
                  className="flex-1"
                >
                  <Printer className="w-4 h-4 mr-2" />
                  Print
                </Button>
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  );
}