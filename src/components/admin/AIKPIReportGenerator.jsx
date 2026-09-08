import { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from '@/hooks/useAgencyScopedQuery';
import { useScopedPatients } from '@/hooks/useScopedPatients';
import { useAuthorizedVisits } from '@/hooks/useAuthorizedVisits';
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Brain,
  Lightbulb
} from "lucide-react";
import { sameAuthorizedTenantScope } from '@/lib/authorizedTenantScope';

function freshQuerySuccess(query) {
  return query.isSuccess
    && query.isFetchedAfterMount
    && query.fetchStatus === 'idle'
    && !query.error
    && !query.isFetching;
}

// ComplianceAudit has an admin-global read arm and no immutable tenant
// provenance. Keep the combined KPI/LLM capability paused until a reviewed
// tenant-authorized aggregate broker can supply that source atomically.
const KPI_REPORTS_ENABLED = false;

export default function AIKPIReportGenerator() {

  const [timeframe, setTimeframe] = useState("30");
  const [report, setReport] = useState(null);
  const [reportBasis, setReportBasis] = useState(null);
  const ai = useAICall();
  const timeframeRef = useRef(timeframe);
  timeframeRef.current = timeframe;

  const visitQuery = useAuthorizedVisits({
    purpose: 'reporting',
    sort: '-created_date',
    limit: 500,
    enabled: KPI_REPORTS_ENABLED,
  });

  const patientQuery = useScopedPatients({
    purpose: 'roster',
    sort: '-updated_date',
    limit: 2000,
    enabled: KPI_REPORTS_ENABLED,
  });
  const tenantScopesMismatch = patientQuery.isSuccess
    && visitQuery.isSuccess
    && !sameAuthorizedTenantScope(patientQuery.tenantScope, visitQuery.tenantScope);
  const tenantSnapshot = useMemo(() => (
    visitQuery.isSuccess
      && patientQuery.isSuccess
      && !tenantScopesMismatch
      ? {
        visits: visitQuery.data,
        patients: patientQuery.data,
        patientTenantScope: patientQuery.tenantScope,
        visitTenantScope: visitQuery.tenantScope,
      }
      : null
  ), [
    patientQuery.data,
    patientQuery.isSuccess,
    patientQuery.tenantScope,
    tenantScopesMismatch,
    visitQuery.data,
    visitQuery.isSuccess,
    visitQuery.tenantScope,
  ]);

  const incidentQuery = useAgencyScopedQuery({
    queryKey: ['incidentsForKPI'],
    fetch: () => base44.entities.Incident.list('-created_date', 200),
    initialData: [],
    enabled: KPI_REPORTS_ENABLED,
  });
  const incidentFresh = freshQuerySuccess(incidentQuery);

  const analysisSnapshot = useMemo(() => (
    tenantSnapshot
      && incidentFresh
      ? {
        ...tenantSnapshot,
        incidents: incidentQuery.data,
      }
      : null
  ), [
    incidentQuery.data,
    incidentFresh,
    tenantSnapshot,
  ]);
  const analysisSnapshotRef = useRef(analysisSnapshot);
  analysisSnapshotRef.current = analysisSnapshot;
  const reportSequenceRef = useRef(0);

  // A report contains Patient and Visit-derived PHI. Never retain or reveal it
  // across a fresh authority check, denial, dataset change, or timeframe change.
  useEffect(() => {
    reportSequenceRef.current += 1;
    setReport(null);
    setReportBasis(null);
  }, [analysisSnapshot, timeframe]);

  const generateReport = async () => {
    if (!KPI_REPORTS_ENABLED) {
      toast.error('KPI report generation is paused pending a tenant-authorized compliance aggregate.');
      return;
    }
    const authorizedSnapshot = analysisSnapshotRef.current;
    if (!authorizedSnapshot) {
      toast.error('Patient and Visit access must be verified before generating a KPI report.');
      return;
    }
    const authorizedTimeframe = timeframe;
    const reportSequence = ++reportSequenceRef.current;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(authorizedTimeframe, 10));
    
    const recentVisits = authorizedSnapshot.visits.filter(v => new Date(v.created_date) >= cutoffDate);
    const recentIncidents = authorizedSnapshot.incidents.filter(i => new Date(i.created_date) >= cutoffDate);

    try {
      const prompt = `Generate a comprehensive KPI report for healthcare agency administration based on the following data.

TIMEFRAME: Last ${authorizedTimeframe} days

DATA SUMMARY:
- Total Visits: ${recentVisits.length}
  - Completed: ${recentVisits.filter(v => v.status === 'completed').length}
  - Scheduled: ${recentVisits.filter(v => v.status === 'scheduled').length}
  - In Progress: ${recentVisits.filter(v => v.status === 'in_progress').length}

- Active Patients: ${authorizedSnapshot.patients.filter(p => p.status === 'active').length}
- Total Patients: ${authorizedSnapshot.patients.length}

- Compliance Audits: Unavailable pending a tenant-authorized aggregate source. Do not infer compliance rates, pass counts, or flags.

- Incidents: ${recentIncidents.length}
  - High Severity: ${recentIncidents.filter(i => i.severity === 'high').length}
  - Medium Severity: ${recentIncidents.filter(i => i.severity === 'medium').length}
  - Low Severity: ${recentIncidents.filter(i => i.severity === 'low').length}

TOP DIAGNOSES (from visits):
${[...new Set(recentVisits.filter(v => v?.nurse_notes).map(v => {
  const match = v.nurse_notes.match(/(?:diagnosis|dx|condition):?\s*([^.\n]+)/i);
  return match?.[1] ? match[1].trim() : null;
}).filter(Boolean))].slice(0, 5).map((dx, i) => `${i + 1}. ${dx}`).join('\n') || 'Not available'}

Analyze and provide:

1. **Executive Summary** - 2-3 key takeaways
2. **Documentation Compliance**
   - Overall compliance rate and trend
   - Common gaps
   - Top performers
3. **Patient Outcomes by Diagnosis**
   - Top 5 diagnoses
   - Visit frequency per diagnosis
   - Incident rates per diagnosis
   - Outcome trends
4. **Operational Efficiency**
   - Visit completion rate
   - Average visits per patient
   - Response time insights
5. **Risk Analysis**
   - Incident patterns
   - High-risk patient indicators
   - Safety concerns
6. **Recommendations**
   - Top 3-5 actionable recommendations

Return as JSON:
{
  "executive_summary": "string",
  "generated_date": "ISO date string",
  "timeframe_days": number,
  "documentation_compliance": {
    "overall_rate": number (0-100),
    "trend": "improving|stable|declining",
    "common_gaps": ["string"],
    "top_performers": ["string"]
  },
  "patient_outcomes": [
    {
      "diagnosis": "string",
      "visit_count": number,
      "incident_count": number,
      "trend": "improving|stable|concerning",
      "insights": "string"
    }
  ],
  "operational_metrics": {
    "visit_completion_rate": number (0-100),
    "avg_visits_per_patient": number,
    "efficiency_score": number (0-100),
    "insights": "string"
  },
  "risk_analysis": {
    "high_risk_patterns": ["string"],
    "incident_trends": "string",
    "safety_score": number (0-100)
  },
  "recommendations": [
    {
      "priority": "high|medium|low",
      "category": "string",
      "recommendation": "string",
      "expected_impact": "string"
    }
  ]
}`;

      const result = await ai.run({
        model: "automatic",
        prompt,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            generated_date: { type: "string" },
            timeframe_days: { type: "number" },
            documentation_compliance: {
              type: "object",
              properties: {
                overall_rate: { type: "number" },
                trend: { type: "string" },
                common_gaps: { type: "array", items: { type: "string" } },
                top_performers: { type: "array", items: { type: "string" } }
              }
            },
            patient_outcomes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  visit_count: { type: "number" },
                  incident_count: { type: "number" },
                  trend: { type: "string" },
                  insights: { type: "string" }
                }
              }
            },
            operational_metrics: {
              type: "object",
              properties: {
                visit_completion_rate: { type: "number" },
                avg_visits_per_patient: { type: "number" },
                efficiency_score: { type: "number" },
                insights: { type: "string" }
              }
            },
            risk_analysis: {
              type: "object",
              properties: {
                high_risk_patterns: { type: "array", items: { type: "string" } },
                incident_trends: { type: "string" },
                safety_score: { type: "number" }
              }
            },
            recommendations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  priority: { type: "string" },
                  category: { type: "string" },
                  recommendation: { type: "string" },
                  expected_impact: { type: "string" }
                }
              }
            }
          }
        }
      });

      if (
        analysisSnapshotRef.current !== authorizedSnapshot
        || timeframeRef.current !== authorizedTimeframe
        || reportSequenceRef.current !== reportSequence
      ) return;
      setReportBasis({ snapshot: authorizedSnapshot, timeframe: authorizedTimeframe });
      setReport(result);
    } catch (error) {
      console.error("Error generating KPI report:", error);
      if (
        analysisSnapshotRef.current === authorizedSnapshot
        && timeframeRef.current === authorizedTimeframe
        && reportSequenceRef.current === reportSequence
      ) {
        toast.error("The AI request didn't complete. Please try again.");
      }
    }
    
  };

  const getTrendIcon = (trend) => {
    if (trend === 'improving') return <TrendingUp className="w-4 h-4 text-green-600" />;
    if (trend === 'declining' || trend === 'concerning') return <TrendingDown className="w-4 h-4 text-red-600" />;
    return <Activity className="w-4 h-4 text-slate-600" />;
  };

  const getScoreColor = (score) => {
    if (score >= 90) return "text-green-600";
    if (score >= 70) return "text-yellow-600";
    return "text-red-600";
  };
  const reportAvailable = Boolean(
    analysisSnapshot
    && report
    && reportBasis?.snapshot === analysisSnapshot
    && reportBasis.timeframe === timeframe
  );

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            AI KPI Report Generator
          </CardTitle>
          {reportAvailable && (
            <Badge variant="outline">
              Last {report.timeframe_days} days
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <span>
              KPI report generation is unavailable until ComplianceAudit metrics have a reviewed tenant-authorized aggregate broker. Missing compliance data is not treated as zero.
            </span>
          </div>
        </div>
        {KPI_REPORTS_ENABLED && !analysisSnapshot && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <span>
                {visitQuery.isError
                  || patientQuery.isError
                  || tenantScopesMismatch
                  || incidentQuery.isError
                  ? 'KPI report generation is unavailable because one or more authorized data sources could not be verified. Platform owners remain blocked until a reviewed agency selector is available.'
                  : 'Reverifying matching tenant access and every report source before KPI report generation…'}
              </span>
            </div>
          </div>
        )}
        <div className="flex gap-3">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Timeframe" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>

          <Button
            onClick={generateReport}
            disabled={ai.loading || !analysisSnapshot || !KPI_REPORTS_ENABLED}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            {ai.loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Generate KPI Report
              </>
            )}
          </Button>
        </div>

        {reportAvailable && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-sm font-semibold text-blue-900 mb-2">Executive Summary</p>
              <p className="text-sm text-blue-800">{report.executive_summary}</p>
            </div>

            <Tabs defaultValue="compliance">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="compliance">Compliance</TabsTrigger>
                <TabsTrigger value="outcomes">Outcomes</TabsTrigger>
                <TabsTrigger value="operations">Operations</TabsTrigger>
                <TabsTrigger value="risks">Risks</TabsTrigger>
              </TabsList>

              <TabsContent value="compliance" className="space-y-3">
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold">Overall Compliance Rate</p>
                    <div className="flex items-center gap-2">
                      <span className={`text-2xl font-bold ${getScoreColor(report.documentation_compliance?.overall_rate)}`}>
                        {report.documentation_compliance?.overall_rate}%
                      </span>
                      {getTrendIcon(report.documentation_compliance?.trend)}
                    </div>
                  </div>
                  <Badge className={`${
                    report.documentation_compliance?.trend === 'improving' ? 'bg-green-100 text-green-800' :
                    report.documentation_compliance?.trend === 'declining' ? 'bg-red-100 text-red-800' :
                    'bg-slate-100 text-slate-800'
                  }`}>
                    {report.documentation_compliance?.trend}
                  </Badge>
                </div>

                {report.documentation_compliance?.common_gaps?.length > 0 && (
                  <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
                    <p className="font-semibold text-sm mb-2">Common Documentation Gaps</p>
                    <ul className="space-y-1">
                      {report.documentation_compliance?.common_gaps.map((gap, idx) => (
                        <li key={idx} className="text-sm text-yellow-900 flex items-start gap-2">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {gap}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.documentation_compliance?.top_performers?.length > 0 && (
                  <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                    <p className="font-semibold text-sm mb-2">Top Performers</p>
                    <ul className="space-y-1">
                      {report.documentation_compliance?.top_performers.map((performer, idx) => (
                        <li key={idx} className="text-sm text-green-900 flex items-start gap-2">
                          <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {performer}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="outcomes" className="space-y-3">
                {report.patient_outcomes?.map((outcome, idx) => (
                  <div key={idx} className="bg-white rounded-lg p-4 border border-slate-200">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-semibold">{outcome.diagnosis}</p>
                      {getTrendIcon(outcome.trend)}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div className="text-sm">
                        <span className="text-slate-500">Visits:</span>{' '}
                        <span className="font-medium">{outcome.visit_count}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-slate-500">Incidents:</span>{' '}
                        <span className="font-medium">{outcome.incident_count}</span>
                      </div>
                    </div>
                    <p className="text-xs text-slate-600">{outcome.insights}</p>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="operations" className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-white rounded-lg p-4 border border-slate-200 text-center">
                    <p className="text-2xl font-bold text-blue-600">
                      {report.operational_metrics?.visit_completion_rate}%
                    </p>
                    <p className="text-xs text-slate-600 mt-1">Completion Rate</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-slate-200 text-center">
                    <p className="text-2xl font-bold text-navy-600">
                      {report.operational_metrics?.avg_visits_per_patient?.toFixed(1)}
                    </p>
                    <p className="text-xs text-slate-600 mt-1">Avg Visits/Patient</p>
                  </div>
                  <div className="bg-white rounded-lg p-4 border border-slate-200 text-center">
                    <p className={`text-2xl font-bold ${getScoreColor(report.operational_metrics?.efficiency_score)}`}>
                      {report.operational_metrics?.efficiency_score}%
                    </p>
                    <p className="text-xs text-slate-600 mt-1">Efficiency Score</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-sm text-slate-700">{report.operational_metrics?.insights}</p>
                </div>
              </TabsContent>

              <TabsContent value="risks" className="space-y-3">
                <div className="bg-white rounded-lg p-4 border border-slate-200">
                  <div className="flex items-center justify-between mb-3">
                    <p className="font-semibold">Safety Score</p>
                    <span className={`text-2xl font-bold ${getScoreColor(report.risk_analysis?.safety_score)}`}>
                      {report.risk_analysis?.safety_score}%
                    </span>
                  </div>
                </div>

                {report.risk_analysis?.high_risk_patterns?.length > 0 && (
                  <div className="bg-red-50 rounded-lg p-4 border border-red-200">
                    <p className="font-semibold text-sm mb-2 text-red-900">High-Risk Patterns</p>
                    <ul className="space-y-1">
                      {report.risk_analysis?.high_risk_patterns.map((pattern, idx) => (
                        <li key={idx} className="text-sm text-red-800 flex items-start gap-2">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                          {pattern}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="font-semibold text-sm mb-2">Incident Trends</p>
                  <p className="text-sm text-slate-700">{report.risk_analysis?.incident_trends}</p>
                </div>
              </TabsContent>
            </Tabs>

            {/* Recommendations */}
            <div className="bg-white rounded-lg p-4 border-2 border-indigo-200">
              <p className="font-semibold mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-indigo-600" />
                AI Recommendations
              </p>
              <div className="space-y-3">
                {report.recommendations?.map((rec, idx) => (
                  <div key={idx} className="bg-indigo-50 rounded-lg p-3 border border-indigo-100">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={`${
                        rec.priority === 'high' ? 'bg-red-600' :
                        rec.priority === 'medium' ? 'bg-yellow-600' :
                        'bg-blue-600'
                      } text-white text-xs`}>
                        {rec.priority}
                      </Badge>
                      <span className="text-xs text-slate-600">{rec.category}</span>
                    </div>
                    <p className="text-sm font-medium text-slate-900 mb-1">{rec.recommendation}</p>
                    <p className="text-xs text-slate-600">Expected Impact: {rec.expected_impact}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
