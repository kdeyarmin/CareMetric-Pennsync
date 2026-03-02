import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  Brain, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle2, Info, Zap, FileText, BarChart3, Download,
  RefreshCw, ChevronDown, ChevronUp, Lightbulb, Activity
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

const PRIORITY_COLORS = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-blue-100 text-blue-800 border-blue-200",
};

const IMPACT_COLORS = {
  positive: "text-green-700 bg-green-50 border-green-200",
  negative: "text-red-700 bg-red-50 border-red-200",
  neutral: "text-slate-700 bg-slate-50 border-slate-200",
};

const ALERT_STYLES = {
  critical: "bg-red-50 border-red-300 text-red-800",
  warning: "bg-amber-50 border-amber-300 text-amber-800",
  info: "bg-blue-50 border-blue-300 text-blue-800",
};

const PIE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"];

function TrendIcon({ trend }) {
  if (trend === "increasing") return <TrendingUp className="w-4 h-4 text-green-600" />;
  if (trend === "decreasing") return <TrendingDown className="w-4 h-4 text-red-600" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

function Section({ title, icon: Icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="p-4 pb-0 cursor-pointer" onClick={() => setOpen(!open)}>
        <CardTitle className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span className="flex items-center gap-2">
            <Icon className="w-4 h-4 text-blue-600" />
            {title}
          </span>
          {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </CardTitle>
      </CardHeader>
      {open && <CardContent className="p-4 pt-3">{children}</CardContent>}
    </Card>
  );
}

export default function ClinicalTrendsAnalyzer() {
  const [dateRange, setDateRange] = useState("30");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await base44.functions.invoke('analyzeClinicalTrends', { dateRangeDays: parseInt(dateRange) });
      if (res?.data?.success) {
        setResult(res.data);
      } else {
        setError(res?.data?.error || "Analysis failed.");
      }
    } catch (e) {
      setError(e.message || "Unexpected error.");
    } finally {
      setLoading(false);
    }
  };

  const exportReport = () => {
    if (!result) return;
    const report = JSON.stringify(result, null, 2);
    const blob = new Blob([report], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clinical-trends-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const trends = result?.trends;

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-blue-600" />
              <span className="font-semibold text-slate-800">AI Clinical Trend Analysis</span>
              <Badge className="bg-blue-100 text-blue-700 text-[10px]">Powered by GPT-4o</Badge>
            </div>
            <div className="flex items-center gap-2 ml-auto flex-wrap">
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">Last 7 days</SelectItem>
                  <SelectItem value="30">Last 30 days</SelectItem>
                  <SelectItem value="60">Last 60 days</SelectItem>
                  <SelectItem value="90">Last 90 days</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={runAnalysis} disabled={loading} className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
                {loading ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Brain className="w-3.5 h-3.5 mr-1.5" />}
                {loading ? "Analyzing..." : "Run Analysis"}
              </Button>
              {result && (
                <Button onClick={exportReport} variant="outline" className="h-8 text-xs">
                  <Download className="w-3.5 h-3.5 mr-1.5" /> Export
                </Button>
              )}
            </div>
          </div>
          {result && (
            <p className="text-xs text-slate-500 mt-2">
              Analyzed <span className="font-semibold text-slate-700">{result.note_count}</span> notes from the last {result.date_range_days} days
              · Generated {new Date(result.generated_at).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card>
          <CardContent className="p-12 text-center">
            <Brain className="w-12 h-12 text-blue-400 mx-auto mb-3 animate-pulse" />
            <p className="text-slate-600 font-medium">GPT-4o is analyzing clinical notes...</p>
            <p className="text-slate-400 text-sm mt-1">This may take 15–30 seconds</p>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 flex items-center gap-2 text-red-700 text-sm">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {result && result.note_count === 0 && (
        <Card>
          <CardContent className="p-10 text-center text-slate-500">
            <FileText className="w-10 h-10 mx-auto mb-2 text-slate-300" />
            <p>No notes found in the selected date range. Try a wider range.</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {trends && result.note_count > 0 && (
        <div className="space-y-4">
          {/* Alerts */}
          {trends.alerts?.length > 0 && (
            <div className="space-y-2">
              {trends.alerts.map((alert, i) => (
                <div key={i} className={`flex items-start gap-2 p-3 rounded-lg border text-sm ${ALERT_STYLES[alert.type] || ALERT_STYLES.info}`}>
                  {alert.type === "critical" ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> :
                   alert.type === "warning" ? <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> :
                   <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  {alert.message}
                </div>
              ))}
            </div>
          )}

          {/* Executive Summary */}
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="p-4">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-1">Executive Summary</p>
              <p className="text-sm text-slate-700">{trends.summary}</p>
            </CardContent>
          </Card>

          {/* Quality Metrics */}
          {trends.quality_metrics && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: "Avg Compliance", value: `${trends.quality_metrics.avg_compliance_score?.toFixed(0) || 0}%`, color: "text-green-700" },
                { label: "Avg Quality", value: `${trends.quality_metrics.avg_quality_score?.toFixed(0) || 0}%`, color: "text-blue-700" },
                { label: "Completeness Rate", value: `${trends.quality_metrics.documentation_completeness_rate?.toFixed(0) || 0}%`, color: "text-purple-700" },
                { label: "Risk Flags", value: trends.quality_metrics.high_risk_documentation_flags || 0, color: "text-red-700" },
              ].map(m => (
                <Card key={m.label} className="border-slate-200">
                  <CardContent className="p-3 text-center">
                    <div className={`text-xl font-bold ${m.color}`}>{m.value}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{m.label}</div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Diagnosis Trends */}
          {trends.diagnosis_trends?.length > 0 && (
            <Section title="Diagnosis Trends" icon={Activity}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  {trends.diagnosis_trends.slice(0, 8).map((d, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <TrendIcon trend={d.trend} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="text-xs font-medium text-slate-700 truncate">{d.diagnosis}</span>
                          <span className="text-xs text-slate-500 ml-2 flex-shrink-0">{d.count} cases ({d.percentage?.toFixed(0)}%)</span>
                        </div>
                        <Progress value={d.percentage} className="h-1.5" />
                        {d.clinical_note && <p className="text-[10px] text-slate-400 mt-0.5">{d.clinical_note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={trends.diagnosis_trends.slice(0, 6)} dataKey="count" nameKey="diagnosis" cx="50%" cy="50%" outerRadius={80} label={({ diagnosis, percentage }) => `${percentage?.toFixed(0)}%`}>
                      {trends.diagnosis_trends.slice(0, 6).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [v, n]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Section>
          )}

          {/* Treatment Trends */}
          {trends.treatment_trends?.length > 0 && (
            <Section title="Treatment Patterns" icon={TrendingUp}>
              <div className="space-y-3">
                {trends.treatment_trends.map((t, i) => (
                  <div key={i} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="text-sm font-medium text-slate-800">{t.treatment_pattern}</p>
                      <Badge variant="outline" className="text-[10px] flex-shrink-0 capitalize">{t.frequency}</Badge>
                    </div>
                    <p className="text-xs text-slate-600 mb-1">{t.effectiveness_signal}</p>
                    {t.recommendation && (
                      <p className="text-xs text-blue-700 flex items-start gap-1">
                        <Lightbulb className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        {t.recommendation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Patient Outcome Insights */}
          {trends.outcome_insights?.length > 0 && (
            <Section title="Patient Outcome Insights" icon={BarChart3}>
              <div className="space-y-2">
                {trends.outcome_insights.map((o, i) => (
                  <div key={i} className={`p-3 rounded-lg border text-sm ${IMPACT_COLORS[o.impact] || IMPACT_COLORS.neutral}`}>
                    <div className="flex items-start justify-between gap-2 mb-0.5">
                      <p className="font-medium">{o.finding}</p>
                      <Badge variant="outline" className="text-[10px] capitalize flex-shrink-0">{o.impact}</Badge>
                    </div>
                    <p className="text-xs opacity-80">{o.detail}</p>
                    {o.affected_patient_count > 0 && (
                      <p className="text-[10px] opacity-60 mt-1">Affects ~{o.affected_patient_count} patients</p>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Protocol Improvement Opportunities */}
          {trends.protocol_improvement_opportunities?.length > 0 && (
            <Section title="Protocol Improvement Opportunities" icon={Zap} defaultOpen={true}>
              <div className="space-y-3">
                {trends.protocol_improvement_opportunities.map((p, i) => (
                  <div key={i} className={`p-3 rounded-lg border ${PRIORITY_COLORS[p.priority] || PRIORITY_COLORS.medium}`}>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p className="font-semibold text-sm">{p.area}</p>
                      <Badge className={`text-[10px] ${PRIORITY_COLORS[p.priority]} flex-shrink-0 capitalize`}>{p.priority}</Badge>
                    </div>
                    <p className="text-xs mb-1.5 opacity-80"><strong>Gap:</strong> {p.current_gap}</p>
                    <p className="text-xs mb-1.5 opacity-80"><strong>Action:</strong> {p.recommended_action}</p>
                    <p className="text-xs opacity-70 flex items-start gap-1">
                      <CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <strong>Expected Impact:</strong> {p.expected_impact}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {/* Idle state */}
      {!loading && !result && !error && (
        <Card className="border-dashed border-2 border-slate-200">
          <CardContent className="p-12 text-center text-slate-400">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">Run an analysis to see AI-powered clinical trends</p>
            <p className="text-sm mt-1">Analyzes diagnoses, treatments, outcomes, and protocol improvement opportunities</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}