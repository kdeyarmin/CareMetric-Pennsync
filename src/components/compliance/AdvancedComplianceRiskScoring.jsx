import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Shield,
  Target,
  Users,
  Brain,
  ChevronRight
} from "lucide-react";
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Tooltip } from "recharts";
import { toast } from 'sonner';

export default function AdvancedComplianceRiskScoring({ 
  timeRange = 30,
  audits = [],
  autoAnalyze = false 
}) {
  const ai = useAICall();
  const [riskAnalysis, setRiskAnalysis] = useState(null);

  const { data: alerts = [] } = useQuery({
    queryKey: ['patientAlerts'],
    queryFn: () => base44.entities.PatientAlert.list('-created_date', 500),
    initialData: [],
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const { data: trainingRecommendations = [] } = useQuery({
    queryKey: ['trainingRecommendations'],
    queryFn: () => base44.entities.TrainingRecommendation.list('-created_date', 500),
    initialData: [],
  });

  const analyzeRisk = useCallback(async () => {
    try {
      // Aggregate data for analysis
      const issuesByCategory = {};
      audits.forEach(audit => {
        (audit.issues || []).forEach(issue => {
          const category = issue.element || 'Unknown';
          if (!issuesByCategory[category]) {
            issuesByCategory[category] = {
              count: 0,
              critical: 0,
              high: 0,
              trend: []
            };
          }
          issuesByCategory[category].count++;
          if (issue.severity === 'critical') issuesByCategory[category].critical++;
          if (issue.severity === 'high') issuesByCategory[category].high++;
        });
      });

      const avgComplianceScore = audits.length > 0
        ? audits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / audits.length
        : 0;

      const criticalAlertsCount = alerts.filter(a => a.severity === 'critical').length;
      const trainingGapsCount = trainingRecommendations.filter(t => !t.addressed).length;

      const result = await ai.run({
        model: "claude_opus_4_8",
        prompt: `You are an AI Medicare compliance risk analyst for Pennsylvania home health agencies. Perform advanced risk scoring and predictive analysis.

CURRENT COMPLIANCE DATA (Last ${timeRange} days):
- Total Audits: ${audits.length}
- Average Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Critical Patient Alerts: ${criticalAlertsCount}
- Unaddressed Training Gaps: ${trainingGapsCount}

ISSUE FREQUENCY BY CATEGORY:
${Object.entries(issuesByCategory).slice(0, 10).map(([cat, data]) => 
  `- ${cat}: ${data.count} occurrences (${data.critical} critical, ${data.high} high)`
).join('\n')}

MEDICARE RULES WITH HIGH VIOLATION RATES:
${medicareRules.filter(r => r.severity === 'critical' || r.severity === 'high').slice(0, 5).map(r => 
  `- ${r.rule_name} (${r.cop_reference}): ${r.category}`
).join('\n')}

Perform comprehensive risk analysis:

1. OVERALL RISK SCORE (0-100): Calculate agency-wide compliance risk
   - Lower score = higher risk
   - Consider: audit scores, issue frequency, critical alerts, trend direction

2. CATEGORY RISK SCORES: Score each critical area (0-100 each):
   - Homebound Status Documentation
   - Skilled Nursing Need Justification
   - Patient Response Documentation
   - Functional Status Assessment
   - Medication Management
   - Care Plan Compliance
   - Infection Control
   - Patient Safety

3. TREND ANALYSIS: For each category, determine if risk is:
   - Increasing (getting worse)
   - Stable
   - Decreasing (improving)

4. PREDICTIVE RISK FORECAST (30/60/90 days):
   - Based on current patterns, predict risk trajectory
   - Identify areas likely to deteriorate without intervention

5. ROOT CAUSE ANALYSIS:
   - Why are certain areas high-risk?
   - Systemic vs individual nurse issues
   - Training gaps vs process problems

6. MITIGATION STRATEGIES: Specific, actionable recommendations
   - Immediate actions (next 7 days)
   - Short-term (30 days)
   - Long-term (90 days)

7. RESOURCE ALLOCATION RECOMMENDATIONS:
   - Which nurses need 1-on-1 coaching?
   - Which topics need agency-wide training?
   - Where should QA audits focus?
   - Suggested staff support interventions

8. EARLY WARNING INDICATORS:
   - Leading indicators to monitor
   - Thresholds for escalation

Return detailed JSON analysis suitable for executive dashboard.`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_score: { type: "number", description: "0-100, lower = higher risk" },
            risk_level: { type: "string", enum: ["critical", "high", "medium", "low"] },
            executive_summary: { type: "string" },
            category_risk_scores: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  risk_score: { type: "number" },
                  trend: { type: "string", enum: ["increasing", "stable", "decreasing"] },
                  issue_count: { type: "number" },
                  cop_reference: { type: "string" }
                }
              }
            },
            predictive_forecast: {
              type: "object",
              properties: {
                thirty_day: {
                  type: "object",
                  properties: {
                    predicted_score: { type: "number" },
                    confidence: { type: "string" },
                    risk_areas: { type: "array", items: { type: "string" } }
                  }
                },
                sixty_day: {
                  type: "object",
                  properties: {
                    predicted_score: { type: "number" },
                    confidence: { type: "string" },
                    risk_areas: { type: "array", items: { type: "string" } }
                  }
                },
                ninety_day: {
                  type: "object",
                  properties: {
                    predicted_score: { type: "number" },
                    confidence: { type: "string" },
                    risk_areas: { type: "array", items: { type: "string" } }
                  }
                }
              }
            },
            root_causes: { type: "array", items: { type: "string" } },
            immediate_actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  action: { type: "string" },
                  category: { type: "string" },
                  impact: { type: "string" }
                }
              }
            },
            short_term_strategies: { type: "array", items: { type: "string" } },
            long_term_strategies: { type: "array", items: { type: "string" } },
            resource_allocation: {
              type: "object",
              properties: {
                high_risk_nurses: { type: "array", items: { type: "string" } },
                priority_training_topics: { type: "array", items: { type: "string" } },
                qa_audit_focus: { type: "array", items: { type: "string" } },
                staff_support_interventions: { type: "array", items: { type: "string" } }
              }
            },
            early_warning_indicators: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  indicator: { type: "string" },
                  current_value: { type: "string" },
                  threshold: { type: "string" },
                  action_if_exceeded: { type: "string" }
                }
              }
            }
          }
        }
      });

      setRiskAnalysis(result);
    } catch (error) {
      console.error('Error analyzing risk:', error);
      toast.error('Failed to analyze compliance risk. Please try again.');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [alerts, audits, medicareRules, timeRange, trainingRecommendations]);

  useEffect(() => {
    if (autoAnalyze && audits.length > 0 && !riskAnalysis) {
      analyzeRisk();
    }
  }, [autoAnalyze, audits, riskAnalysis, analyzeRisk]);

  const getRiskColor = (score) => {
    if (score >= 80) return { bg: 'bg-green-500', text: 'text-green-600', border: 'border-green-500' };
    if (score >= 60) return { bg: 'bg-blue-500', text: 'text-blue-600', border: 'border-blue-500' };
    if (score >= 40) return { bg: 'bg-yellow-500', text: 'text-yellow-600', border: 'border-yellow-500' };
    return { bg: 'bg-red-500', text: 'text-red-600', border: 'border-red-500' };
  };

  const getTrendIcon = (trend) => {
    if (trend === 'decreasing') return <TrendingDown className="w-4 h-4 text-green-600" />;
    if (trend === 'increasing') return <TrendingUp className="w-4 h-4 text-red-600" />;
    return <ChevronRight className="w-4 h-4 text-slate-600" />;
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-navy-300">
        <CardContent className="p-8 text-center">
          <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-navy-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-slate-900 mb-2">AI Risk Analysis in Progress</p>
          <p className="text-sm text-slate-600">
            Analyzing {audits.length} audits, {alerts.length} alerts, and compliance patterns...
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!riskAnalysis && !autoAnalyze) {
    return (
      <Card className="border-2 border-navy-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            Advanced Compliance Risk Scoring
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-4">
            AI-powered predictive risk analysis with mitigation strategies and resource allocation recommendations.
          </p>
          <Button onClick={analyzeRisk} className="w-full bg-navy-600 hover:bg-navy-700">
            <Brain className="w-4 h-4 mr-2" />
            Analyze Risk & Generate Predictions
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!riskAnalysis) return null;

  const riskColors = getRiskColor(riskAnalysis.overall_risk_score);
  const radarData = riskAnalysis.category_risk_scores?.map(cat => ({
    category: (cat.category || '').split(' ').slice(0, 2).join(' '),
    score: cat.risk_score,
    fullMark: 100
  }));

  return (
    <div className="space-y-6">
      {/* Overall Risk Score */}
      <Card className={`border-4 ${riskColors.border} bg-gradient-to-r from-navy-50 to-gold-50`}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Shield className="w-6 h-6 text-navy-600" />
              Agency Compliance Risk Score
            </span>
            <Badge className={`${riskColors.bg} text-white text-xl px-4 py-2`}>
              {riskAnalysis.overall_risk_score}/100
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Progress value={riskAnalysis.overall_risk_score} className="h-4" />
          <Alert className={`${riskColors.bg.replace('bg-', 'bg-').replace('-500', '-50')} border-2 ${riskColors.border}`}>
            <Shield className={`w-4 h-4 ${riskColors.text}`} />
            <AlertDescription>
              <p className="font-bold mb-1">Risk Level: {(riskAnalysis.risk_level || '').toUpperCase()}</p>
              <p className="text-sm">{riskAnalysis.executive_summary}</p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      {/* Category Risk Breakdown */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Risk by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="category" />
                <PolarRadiusAxis angle={90} domain={[0, 100]} />
                <Radar name="Risk Score" dataKey="score" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Category Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[300px] overflow-y-auto">
            {riskAnalysis.category_risk_scores?.map((cat, idx) => {
              const catColors = getRiskColor(cat.risk_score);
              return (
                <div key={idx} className="p-3 bg-slate-50 rounded border">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{cat.category}</span>
                      {getTrendIcon(cat.trend)}
                    </div>
                    <Badge className={catColors.bg}>{cat.risk_score}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>{cat.issue_count} issues</span>
                    <span>{cat.cop_reference}</span>
                  </div>
                  <Progress value={cat.risk_score} className="h-1 mt-2" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Predictive Forecast */}
      <Card className="border-2 border-blue-300 bg-blue-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Predictive Risk Forecast
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-4">
            {[
              { label: '30 Days', data: riskAnalysis.predictive_forecast?.thirty_day },
              { label: '60 Days', data: riskAnalysis.predictive_forecast?.sixty_day },
              { label: '90 Days', data: riskAnalysis.predictive_forecast?.ninety_day }
            ].map((forecast, idx) => {
              const forecastColors = getRiskColor(forecast.data?.predicted_score || 0);
              return (
                <div key={idx} className="bg-white p-4 rounded-lg border-2 border-blue-200">
                  <p className="text-sm font-semibold text-slate-700 mb-2">{forecast.label}</p>
                  <p className={`text-3xl font-bold ${forecastColors.text} mb-1`}>
                    {forecast.data?.predicted_score || 0}
                  </p>
                  <Badge variant="outline" className="mb-3">{forecast.data?.confidence}</Badge>
                  {forecast.data?.risk_areas?.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-slate-600 mb-1">Risk Areas:</p>
                      <ul className="text-xs text-slate-700 space-y-0.5">
                        {forecast.data.risk_areas.slice(0, 3).map((area, i) => (
                          <li key={i}>• {area}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Root Causes */}
      {riskAnalysis.root_causes?.length > 0 && (
        <Card className="border-2 border-orange-300 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-orange-600" />
              Root Cause Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {riskAnalysis.root_causes.map((cause, idx) => (
                <li key={idx} className="flex items-start gap-2 bg-white p-3 rounded border">
                  <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                  <span className="text-sm text-slate-900">{cause}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Mitigation Strategies */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Immediate Actions */}
        <Card className="border-2 border-red-300">
          <CardHeader className="bg-red-50">
            <CardTitle className="text-base">🚨 Immediate (7 Days)</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {riskAnalysis.immediate_actions?.map((action, idx) => (
              <div key={idx} className="bg-white p-2 rounded border">
                <p className="text-sm font-medium text-slate-900">{action.action}</p>
                <Badge variant="outline" className="text-xs mt-1">{action.category}</Badge>
                <p className="text-xs text-slate-600 mt-1">{action.impact}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Short-term */}
        <Card className="border-2 border-yellow-300">
          <CardHeader className="bg-yellow-50">
            <CardTitle className="text-base">⚡ Short-term (30 Days)</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {riskAnalysis.short_term_strategies?.map((strategy, idx) => (
              <div key={idx} className="bg-white p-2 rounded border text-sm">
                {strategy}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Long-term */}
        <Card className="border-2 border-green-300">
          <CardHeader className="bg-green-50">
            <CardTitle className="text-base">🎯 Long-term (90 Days)</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {riskAnalysis.long_term_strategies?.map((strategy, idx) => (
              <div key={idx} className="bg-white p-2 rounded border text-sm">
                {strategy}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Resource Allocation */}
      <Card className="border-2 border-navy-300 bg-navy-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-navy-600" />
            Resource Allocation & Targeted Support
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-white p-4 rounded border">
              <p className="font-semibold text-slate-900 mb-2">🎯 QA Audit Focus Areas</p>
              <ul className="space-y-1">
                {riskAnalysis.resource_allocation?.qa_audit_focus?.map((focus, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-navy-600">•</span>
                    {focus}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-4 rounded border">
              <p className="font-semibold text-slate-900 mb-2">📚 Priority Training Topics</p>
              <ul className="space-y-1">
                {riskAnalysis.resource_allocation?.priority_training_topics?.map((topic, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-blue-600">•</span>
                    {topic}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-4 rounded border">
              <p className="font-semibold text-slate-900 mb-2">👥 High-Risk Nurses (1-on-1 Coaching)</p>
              <ul className="space-y-1">
                {riskAnalysis.resource_allocation?.high_risk_nurses?.map((nurse, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-red-600">•</span>
                    {nurse}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-white p-4 rounded border">
              <p className="font-semibold text-slate-900 mb-2">🤝 Staff Support Interventions</p>
              <ul className="space-y-1">
                {riskAnalysis.resource_allocation?.staff_support_interventions?.map((intervention, idx) => (
                  <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-green-600">•</span>
                    {intervention}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Early Warning Indicators */}
      <Card className="border-2 border-red-300 bg-red-50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600" />
            Early Warning Indicators
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {riskAnalysis.early_warning_indicators?.map((indicator, idx) => (
              <div key={idx} className="bg-white p-3 rounded border-l-4 border-l-red-500">
                <div className="flex items-start justify-between mb-1">
                  <p className="font-medium text-sm text-slate-900">{indicator.indicator}</p>
                  <Badge variant="outline" className="text-xs">Monitor</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 mb-2">
                  <span><strong>Current:</strong> {indicator.current_value}</span>
                  <span><strong>Threshold:</strong> {indicator.threshold}</span>
                </div>
                <p className="text-xs text-red-700">
                  <strong>Action if exceeded:</strong> {indicator.action_if_exceeded}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setRiskAnalysis(null);
          analyzeRisk();
        }}
        className="w-full"
      >
        Refresh Risk Analysis
      </Button>
    </div>
  );
}