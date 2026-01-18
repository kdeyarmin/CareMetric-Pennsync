import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  TrendingUp, 
  Award,
  Target,
  Users,
  BarChart3,
  Loader2,
  Star,
  Zap,
  Clock,
  FileText,
  CheckCircle2
} from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function ClinicalStaffPerformanceInsights({ providerType, careSetting, timeRange = 30 }) {
  const [generating, setGenerating] = useState(false);
  const [insights, setInsights] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: myVisits = [] } = useQuery({
    queryKey: ['myVisits', currentUser?.email, timeRange],
    queryFn: async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeRange);
      const allVisits = await base44.entities.Visit.filter({ created_by: currentUser.email }, '-visit_date', 500);
      return allVisits.filter(v => new Date(v.visit_date) >= cutoffDate);
    },
    enabled: !!currentUser?.email
  });

  const { data: myAudits = [] } = useQuery({
    queryKey: ['myAudits', currentUser?.email, timeRange],
    queryFn: async () => {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeRange);
      const audits = await base44.entities.ComplianceAudit.filter({ nurse_email: currentUser.email }, '-audit_date', 500);
      return audits.filter(a => new Date(a.audit_date) >= cutoffDate);
    },
    enabled: !!currentUser?.email
  });

  const { data: myTrainingCompletions = [] } = useQuery({
    queryKey: ['myTrainingCompletions', currentUser?.email],
    queryFn: () => base44.entities.TrainingCompletion.filter({ 
      nurse_email: currentUser.email,
      status: 'completed'
    }),
    enabled: !!currentUser?.email
  });

  const { data: noteConversions = [] } = useQuery({
    queryKey: ['myNoteConversions', currentUser?.email, timeRange],
    queryFn: async () => {
      const conversions = await base44.entities.NoteConversion.filter({ nurse_email: currentUser.email }, '-created_date', 500);
      return conversions.slice(0, timeRange);
    },
    enabled: !!currentUser?.email
  });

  const generateInsights = async () => {
    setGenerating(true);
    try {
      const avgComplianceScore = myAudits.length > 0 ?
        myAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / myAudits.length : 0;

      const avgQualityScore = noteConversions.length > 0 ?
        noteConversions.reduce((sum, n) => sum + (n.quality_score || 0), 0) / noteConversions.length : 0;

      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a performance analytics AI analyzing clinical staff performance for ${providerType} in ${careSetting}.

PROVIDER: ${currentUser.full_name} (${providerType})
TIME PERIOD: Last ${timeRange} days
CARE SETTING: ${careSetting}

PERFORMANCE METRICS:
- Total Visits Documented: ${myVisits.length}
- Compliance Audits: ${myAudits.length}
- Average Compliance Score: ${avgComplianceScore.toFixed(1)}%
- Average Documentation Quality: ${avgQualityScore.toFixed(1)}%
- Training Modules Completed: ${myTrainingCompletions.length}
- Notes Enhanced with AI: ${noteConversions.length}

COMPLIANCE AUDIT DETAILS:
${myAudits.slice(0, 10).map(a => `- Score: ${a.compliance_score}%, Status: ${a.status}, Issues: ${a.issues?.length || 0}`).join('\n')}

TOP COMPLIANCE ISSUES:
${(() => {
  const issueMap = {};
  myAudits.forEach(a => {
    (a.issues || []).forEach(issue => {
      issueMap[issue.element] = (issueMap[issue.element] || 0) + 1;
    });
  });
  return Object.entries(issueMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([elem, count]) => `- ${elem}: ${count} occurrences`)
    .join('\n');
})()}

NOTE QUALITY TRENDS:
${noteConversions.slice(0, 10).map(n => `- Quality: ${n.quality_score}%, Compliance Improvement: ${n.compliance_improvement || 0}%`).join('\n')}

Provide performance insights specific to ${providerType} and ${careSetting}:

1. **Overall Performance Rating** (0-100 with justification)
2. **Strengths** (3-5 areas of excellence)
3. **Improvement Areas** (3-5 specific areas to focus on)
4. **Trend Analysis** (improving, stable, declining with evidence)
5. **Personalized Recommendations** (5-7 actionable steps for ${providerType})
6. **Peer Comparison** (estimated percentile)
7. **Goal Suggestions** (3 SMART goals for next ${timeRange} days)
8. **Training Recommendations** (specific modules based on gaps)

Focus on ${providerType}-specific metrics and ${careSetting} best practices.`,
        response_json_schema: {
          type: 'object',
          properties: {
            overall_rating: {
              type: 'object',
              properties: {
                score: { type: 'number' },
                level: { type: 'string' },
                justification: { type: 'string' }
              }
            },
            strengths: { type: 'array', items: { type: 'string' } },
            improvement_areas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  area: { type: 'string' },
                  impact: { type: 'string' },
                  specific_tip: { type: 'string' }
                }
              }
            },
            trend_analysis: {
              type: 'object',
              properties: {
                direction: { type: 'string' },
                evidence: { type: 'string' },
                forecast: { type: 'string' }
              }
            },
            recommendations: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  action: { type: 'string' },
                  priority: { type: 'string' },
                  expected_impact: { type: 'string' },
                  timeframe: { type: 'string' }
                }
              }
            },
            peer_comparison: {
              type: 'object',
              properties: {
                percentile: { type: 'number' },
                interpretation: { type: 'string' }
              }
            },
            suggested_goals: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  goal: { type: 'string' },
                  metric: { type: 'string' },
                  target: { type: 'string' },
                  deadline: { type: 'string' }
                }
              }
            },
            training_recommendations: { type: 'array', items: { type: 'string' } }
          }
        }
      });

      setInsights(response);
    } catch (error) {
      console.error('Performance insights error:', error);
    } finally {
      setGenerating(false);
    }
  };

  const getRatingColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-blue-300 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Award className="w-6 h-6 text-blue-600" />
            My Performance Insights
          </span>
          <Button 
            onClick={generateInsights} 
            disabled={generating || myVisits.length === 0}
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
          >
            {generating ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <BarChart3 className="w-4 h-4 mr-2" />
                Generate Insights
              </>
            )}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!insights ? (
          <Alert>
            <Target className="w-4 h-4" />
            <AlertDescription>
              Get AI-powered insights on your performance as a {providerType} in {careSetting} setting. 
              Analyze your last {timeRange} days of clinical work ({myVisits.length} visits, {myAudits.length} audits).
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {/* Overall Rating */}
            <Card className="border-purple-300 bg-purple-50 dark:bg-purple-950">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold mb-1">Overall Performance</p>
                    <p className={`text-4xl font-bold ${getRatingColor(insights.overall_rating?.score || 0)}`}>
                      {insights.overall_rating?.score || 0}/100
                    </p>
                    <Badge className="mt-2">{insights.overall_rating?.level || 'Good'}</Badge>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-500 mb-1">Peer Comparison</p>
                    <p className="text-2xl font-bold text-blue-600">
                      {insights.peer_comparison?.percentile || 0}th
                    </p>
                    <p className="text-xs text-gray-600">percentile</p>
                  </div>
                </div>
                <p className="text-xs text-gray-700 dark:text-gray-400 mt-3">
                  {insights.overall_rating?.justification}
                </p>
              </CardContent>
            </Card>

            {/* Trend Analysis */}
            {insights.trend_analysis && (
              <Alert className={
                insights.trend_analysis.direction === 'improving' ? 'bg-green-50 border-green-300' :
                insights.trend_analysis.direction === 'declining' ? 'bg-red-50 border-red-300' :
                'bg-blue-50 border-blue-300'
              }>
                <TrendingUp className="w-4 h-4" />
                <AlertDescription>
                  <p className="font-semibold text-sm mb-1">
                    Trend: {insights.trend_analysis.direction.toUpperCase()}
                  </p>
                  <p className="text-xs mb-2">{insights.trend_analysis.evidence}</p>
                  <p className="text-xs font-semibold">Forecast: {insights.trend_analysis.forecast}</p>
                </AlertDescription>
              </Alert>
            )}

            {/* Strengths & Improvements Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card className="border-green-300 bg-green-50 dark:bg-green-950">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Star className="w-4 h-4 text-green-600" />
                    Your Strengths
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.strengths?.map((strength, i) => (
                      <li key={i} className="text-xs flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                        <span>{strength}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>

              <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-orange-600" />
                    Growth Opportunities
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {insights.improvement_areas?.map((area, i) => (
                      <div key={i} className="bg-white dark:bg-slate-900 p-2 rounded border">
                        <p className="text-xs font-semibold mb-1">{area.area}</p>
                        <Badge className="text-xs mb-1">{area.impact} Impact</Badge>
                        <p className="text-xs text-gray-600 dark:text-gray-400">{area.specific_tip}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Personalized Recommendations */}
            <Card className="border-blue-300 bg-blue-50 dark:bg-blue-950">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4 text-blue-600" />
                  Action Plan for {providerType}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {insights.recommendations?.map((rec, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 p-3 rounded-lg border">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={
                          rec.priority === 'high' ? 'bg-red-600' :
                          rec.priority === 'medium' ? 'bg-yellow-600' :
                          'bg-blue-600'
                        }>
                          {rec.priority}
                        </Badge>
                        <p className="text-sm font-semibold">{rec.action}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{rec.timeframe}</Badge>
                    </div>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">{rec.expected_impact}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* SMART Goals */}
            <Card className="border-indigo-300 bg-indigo-50 dark:bg-indigo-950">
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4 text-indigo-600" />
                  Suggested Goals (Next {timeRange} Days)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {insights.suggested_goals?.map((goal, i) => (
                  <div key={i} className="bg-white dark:bg-slate-900 p-3 rounded-lg border">
                    <p className="text-sm font-semibold mb-2">{goal.goal}</p>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-gray-500">Metric:</p>
                        <p className="font-medium">{goal.metric}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Target:</p>
                        <p className="font-medium">{goal.target}</p>
                      </div>
                      <div>
                        <p className="text-gray-500">Deadline:</p>
                        <p className="font-medium">{goal.deadline}</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 w-full text-xs"
                      onClick={async () => {
                        try {
                          await base44.entities.NurseGoal.create({
                            nurse_email: currentUser.email,
                            goal_description: goal.goal,
                            target_metric: goal.metric,
                            target_value: goal.target,
                            deadline: new Date(new Date().setDate(new Date().getDate() + timeRange)).toISOString().split('T')[0],
                            status: 'active',
                            source: 'ai_generated'
                          });
                          alert('✅ Goal added to your personal goals!');
                        } catch (error) {
                          alert('Failed to create goal');
                        }
                      }}
                    >
                      Add to My Goals
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Training Recommendations */}
            {insights.training_recommendations && insights.training_recommendations.length > 0 && (
              <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950">
                <CardHeader>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-600" />
                    Recommended Training Modules
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2">
                    {insights.training_recommendations.map((training, i) => (
                      <li key={i} className="text-xs bg-white dark:bg-slate-900 p-2 rounded border flex items-center justify-between">
                        <span>{training}</span>
                        <Badge variant="outline" className="text-xs">Recommended</Badge>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}