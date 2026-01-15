import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, TrendingUp, Brain, BarChart3, Loader } from 'lucide-react';
import { toast } from 'sonner';

export default function AIInsightsPanel() {
  const [feedbackAnalysis, setFeedbackAnalysis] = useState(null);
  const [complianceRisks, setComplianceRisks] = useState(null);
  const [loading, setLoading] = useState({
    feedback: false,
    compliance: false
  });

  const handleAnalyzeFeedback = async () => {
    setLoading(prev => ({ ...prev, feedback: true }));
    try {
      const response = await base44.functions.invoke('analyzeFeedbackTrends', {});
      setFeedbackAnalysis(response.data);
      toast.success('Feedback analysis completed');
    } catch (error) {
      console.error('Error analyzing feedback:', error);
      toast.error('Failed to analyze feedback');
    } finally {
      setLoading(prev => ({ ...prev, feedback: false }));
    }
  };

  const handleDetectRisks = async () => {
    setLoading(prev => ({ ...prev, compliance: true }));
    try {
      const response = await base44.functions.invoke('detectComplianceRisks', {});
      setComplianceRisks(response.data);
      toast.success('Compliance analysis completed');
    } catch (error) {
      console.error('Error detecting risks:', error);
      toast.error('Failed to analyze compliance');
    } finally {
      setLoading(prev => ({ ...prev, compliance: false }));
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="feedback" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="feedback" className="flex items-center gap-2">
            <TrendingUp size={16} />
            Feedback Trends
          </TabsTrigger>
          <TabsTrigger value="compliance" className="flex items-center gap-2">
            <AlertCircle size={16} />
            Compliance Risks
          </TabsTrigger>
        </TabsList>

        {/* Feedback Analysis Tab */}
        <TabsContent value="feedback" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5" />
                AI-Powered Feedback Analysis
              </CardTitle>
              <CardDescription>Analyze training feedback trends and identify improvements</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!feedbackAnalysis ? (
                <Button
                  onClick={handleAnalyzeFeedback}
                  disabled={loading.feedback}
                  className="w-full bg-blue-600 hover:bg-blue-700"
                >
                  {loading.feedback && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                  {loading.feedback ? 'Analyzing...' : 'Analyze Feedback Trends'}
                </Button>
              ) : (
                <div className="space-y-6">
                  {/* Summary Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-3 bg-slate-100 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Total Feedback</p>
                      <p className="text-2xl font-bold text-gray-900">{feedbackAnalysis.summary?.total_feedback || 0}</p>
                    </div>
                    <div className="p-3 bg-slate-100 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Avg Rating</p>
                      <p className="text-2xl font-bold text-yellow-600">★ {feedbackAnalysis.summary?.average_rating || 'N/A'}</p>
                    </div>
                    <div className="p-3 bg-slate-100 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Effectiveness</p>
                      <p className="text-2xl font-bold text-blue-600">{feedbackAnalysis.summary?.average_effectiveness || 'N/A'}★</p>
                    </div>
                    <div className="p-3 bg-slate-100 rounded-lg">
                      <p className="text-xs text-gray-600 mb-1">Would Recommend</p>
                      <p className="text-2xl font-bold text-green-600">{feedbackAnalysis.summary?.would_recommend_percentage || 'N/A'}%</p>
                    </div>
                  </div>

                  {/* AI Analysis */}
                  {feedbackAnalysis.analysis && (
                    <div className="space-y-4">
                      {feedbackAnalysis.analysis.trends && feedbackAnalysis.analysis.trends.length > 0 && (
                        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                          <h4 className="font-semibold text-blue-900 mb-3">Key Trends</h4>
                          <ul className="space-y-2">
                            {feedbackAnalysis.analysis.trends.map((trend, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-blue-800">
                                <span className="text-blue-600 font-bold mt-0.5">•</span>
                                {trend}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {feedbackAnalysis.analysis.improvement_areas && feedbackAnalysis.analysis.improvement_areas.length > 0 && (
                        <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                          <h4 className="font-semibold text-orange-900 mb-3">Areas for Improvement</h4>
                          <ul className="space-y-2">
                            {feedbackAnalysis.analysis.improvement_areas.map((area, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-orange-800">
                                <span className="text-orange-600 font-bold mt-0.5">•</span>
                                {area}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {feedbackAnalysis.analysis.actionable_recommendations && feedbackAnalysis.analysis.actionable_recommendations.length > 0 && (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                          <h4 className="font-semibold text-green-900 mb-3">Recommended Actions</h4>
                          <ul className="space-y-2">
                            {feedbackAnalysis.analysis.actionable_recommendations.map((rec, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-green-800">
                                <span className="text-green-600 font-bold mt-0.5">→</span>
                                {rec}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <Button
                    onClick={() => setFeedbackAnalysis(null)}
                    variant="outline"
                    className="w-full"
                  >
                    Clear Analysis
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliance Risks Tab */}
        <TabsContent value="compliance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5" />
                AI Compliance Risk Detection
              </CardTitle>
              <CardDescription>Identify compliance risks and incident patterns</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!complianceRisks ? (
                <Button
                  onClick={handleDetectRisks}
                  disabled={loading.compliance}
                  className="w-full bg-red-600 hover:bg-red-700"
                >
                  {loading.compliance && <Loader className="mr-2 h-4 w-4 animate-spin" />}
                  {loading.compliance ? 'Analyzing...' : 'Detect Compliance Risks'}
                </Button>
              ) : (
                <div className="space-y-6">
                  {/* Risk Severity */}
                  {complianceRisks.ai_insights?.risk_severity && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-gray-600 mb-1">Overall Risk</p>
                        <Badge className={
                          complianceRisks.ai_insights.risk_severity.overall === 'critical' ? 'bg-red-600' :
                          complianceRisks.ai_insights.risk_severity.overall === 'high' ? 'bg-orange-600' :
                          'bg-yellow-600'
                        }>
                          {complianceRisks.ai_insights.risk_severity.overall}
                        </Badge>
                      </div>
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-gray-600 mb-1">Compliance</p>
                        <Badge variant="outline">{complianceRisks.ai_insights.risk_severity.compliance}</Badge>
                      </div>
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-gray-600 mb-1">Incidents</p>
                        <Badge variant="outline">{complianceRisks.ai_insights.risk_severity.incidents}</Badge>
                      </div>
                      <div className="p-3 bg-slate-100 rounded-lg">
                        <p className="text-xs text-gray-600 mb-1">Alerts</p>
                        <Badge variant="outline">{complianceRisks.ai_insights.risk_severity.alerts}</Badge>
                      </div>
                    </div>
                  )}

                  {/* Critical Risks */}
                  {complianceRisks.ai_insights?.critical_risks && complianceRisks.ai_insights.critical_risks.length > 0 && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                      <h4 className="font-semibold text-red-900 mb-3">🚨 Critical Risks</h4>
                      <ul className="space-y-2">
                        {complianceRisks.ai_insights.critical_risks.map((risk, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-red-800">
                            <span className="text-red-600 font-bold mt-0.5">!</span>
                            {risk}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recurring Patterns */}
                  {complianceRisks.ai_insights?.recurring_patterns && complianceRisks.ai_insights.recurring_patterns.length > 0 && (
                    <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                      <h4 className="font-semibold text-orange-900 mb-3">Recurring Patterns</h4>
                      <ul className="space-y-2">
                        {complianceRisks.ai_insights.recurring_patterns.map((pattern, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-orange-800">
                            <span className="text-orange-600 font-bold mt-0.5">⚠</span>
                            {pattern}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Prevention Recommendations */}
                  {complianceRisks.ai_insights?.prevention_recommendations && complianceRisks.ai_insights.prevention_recommendations.length > 0 && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <h4 className="font-semibold text-blue-900 mb-3">Prevention Recommendations</h4>
                      <ul className="space-y-2">
                        {complianceRisks.ai_insights.prevention_recommendations.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-blue-800">
                            <span className="text-blue-600 font-bold mt-0.5">→</span>
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Action Items */}
                  {complianceRisks.ai_insights?.action_items && complianceRisks.ai_insights.action_items.length > 0 && (
                    <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                      <h4 className="font-semibold text-purple-900 mb-3">Immediate Action Items</h4>
                      <ul className="space-y-2">
                        {complianceRisks.ai_insights.action_items.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-purple-800">
                            <span className="text-purple-600 font-bold mt-0.5">✓</span>
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <Button
                    onClick={() => setComplianceRisks(null)}
                    variant="outline"
                    className="w-full"
                  >
                    Clear Analysis
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}