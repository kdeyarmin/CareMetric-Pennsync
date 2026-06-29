import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Heart,
  ThermometerSun,
  GitCompare,
  Brain,
  Shield
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { format } from "date-fns";
import { toast } from 'sonner';

export default function ClinicalTrendsAnalyzer({ patientId }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [expandedSections, setExpandedSections] = useState(['vitals']);

  const analyzePatient = async () => {
    if (!patientId) return;

    setIsAnalyzing(true);
    try {
      const { data } = await base44.functions.invoke('analyzeClinicalTrends', {
        patient_id: patientId
      });

      setAnalysis(data);
    } catch (error) {
      console.error('Error analyzing trends:', error);
      toast.error('Failed to analyze trends. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev =>
      prev.includes(section) ? prev.filter(s => s !== section) : [...prev, section]
    );
  };

  const getTrendIcon = (direction) => {
    if (direction?.toLowerCase().includes('improv') || direction?.toLowerCase().includes('stable')) {
      return TrendingUp;
    }
    if (direction?.toLowerCase().includes('declin') || direction?.toLowerCase().includes('worsen')) {
      return TrendingDown;
    }
    return Activity;
  };

  const getConcernColor = (level) => {
    switch (level?.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'bg-red-600';
      case 'medium':
      case 'moderate':
        return 'bg-orange-600';
      case 'low':
        return 'bg-yellow-600';
      default:
        return 'bg-green-600';
    }
  };

  const prepareVitalsChartData = () => {
    if (!analysis?.vitals_data) return [];
    
    return analysis.vitals_data.map(v => ({
      date: format(new Date(v.date), 'MM/dd'),
      BP_Systolic: v.vitals?.blood_pressure_systolic,
      BP_Diastolic: v.vitals?.blood_pressure_diastolic,
      Heart_Rate: v.vitals?.heart_rate,
      O2_Sat: v.vitals?.oxygen_saturation,
      Weight: v.vitals?.weight,
      Temp: v.vitals?.temperature
    })).reverse();
  };

  if (!analysis) {
    return (
      <Card className="border-2 border-navy-300 bg-navy-50">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2 text-navy-900">
            <Activity className="w-4 h-4" />
            Clinical Trends Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-navy-800 mb-3">
            AI-powered analysis of vital signs, symptoms, and clinical data over time to identify patterns and risks.
          </p>
          <Button
            onClick={analyzePatient}
            disabled={isAnalyzing}
            size="sm"
            className="bg-navy-600 hover:bg-navy-700 w-full"
          >
            {isAnalyzing ? (
              <>
                <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                Analyzing Clinical Data...
              </>
            ) : (
              <>
                <Activity className="w-4 h-4 mr-2" />
                Analyze Trends
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const chartData = prepareVitalsChartData();

  return (
    <Card className="border-2 border-navy-300 bg-navy-50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2 text-navy-900">
            <Activity className="w-4 h-4" />
            Clinical Trends Analysis
          </CardTitle>
          <Badge className="bg-navy-600 text-white">
            {analysis.data_analyzed?.visits} visits analyzed
          </Badge>
        </div>
        {analysis.overall_trajectory && (
          <Alert className="mt-2 bg-blue-50 border-blue-300">
            <TrendingUp className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-xs text-blue-800">
              <strong>Overall Trajectory:</strong> {analysis.overall_trajectory}
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Vital Signs Trends */}
        {chartData.length > 0 && (
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('vitals')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Heart className="w-4 h-4 text-red-500" />
                  Vital Signs Over Time
                </h4>
                {expandedSections.includes('vitals') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('vitals') && (
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" style={{ fontSize: '10px' }} />
                    <YAxis style={{ fontSize: '10px' }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Line type="monotone" dataKey="BP_Systolic" stroke="#ef4444" strokeWidth={2} name="BP Sys" />
                    <Line type="monotone" dataKey="Heart_Rate" stroke="#3557b0" strokeWidth={2} name="HR" />
                    <Line type="monotone" dataKey="O2_Sat" stroke="#10b981" strokeWidth={2} name="O2" />
                  </LineChart>
                </ResponsiveContainer>
                
                <div className="mt-3 space-y-2">
                  {analysis.vital_trends?.map((trend, idx) => {
                    const TrendIcon = getTrendIcon(trend.trend_direction);
                    return (
                      <Alert key={idx} className={`border-l-4 ${trend.concern_level === 'high' ? 'border-red-400 bg-red-50' : trend.concern_level === 'medium' ? 'border-orange-400 bg-orange-50' : 'border-green-400 bg-green-50'}`}>
                        <TrendIcon className="w-4 h-4" />
                        <AlertDescription className="text-xs">
                          <div className="flex items-center gap-2 mb-1">
                            <strong>{trend.vital_type}:</strong>
                            <Badge className={`${getConcernColor(trend.concern_level)} text-white text-xs`}>
                              {trend.concern_level}
                            </Badge>
                          </div>
                          <p className="text-slate-700">{trend.description}</p>
                          {trend.recommendation && (
                            <p className="text-slate-600 mt-1 italic">→ {trend.recommendation}</p>
                          )}
                        </AlertDescription>
                      </Alert>
                    );
                  })}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* Risk Indicators */}
        {analysis.risk_indicators?.length > 0 && (
          <Card className="bg-white border-l-4 border-red-400">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('risks')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  Risk Indicators ({analysis.risk_indicators.length})
                </h4>
                {expandedSections.includes('risks') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('risks') && (
              <CardContent className="space-y-2">
                {analysis.risk_indicators.map((risk, idx) => (
                  <Alert key={idx} className="bg-red-50 border-red-300">
                    <AlertDescription className="text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={`${getConcernColor(risk.severity)} text-white text-xs`}>
                          {risk.severity}
                        </Badge>
                        <strong>{risk.risk_type}</strong>
                      </div>
                      <p className="text-slate-700 mb-1">{risk.evidence}</p>
                      <p className="text-red-700 font-medium">Action: {risk.action_needed}</p>
                    </AlertDescription>
                  </Alert>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* Symptom Patterns */}
        {analysis.symptom_patterns?.length > 0 && (
          <Card className="bg-white">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('symptoms')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <ThermometerSun className="w-4 h-4 text-orange-500" />
                  Symptom Patterns
                </h4>
                {expandedSections.includes('symptoms') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('symptoms') && (
              <CardContent className="space-y-2">
                {analysis.symptom_patterns.map((pattern, idx) => (
                  <div key={idx} className="text-xs bg-orange-50 border border-orange-200 rounded p-2">
                    <p className="font-semibold text-slate-900">{pattern.symptom}</p>
                    <p className="text-slate-700">Pattern: {pattern.pattern}</p>
                    <p className="text-slate-700">Severity Trend: {pattern.severity_trend}</p>
                    <p className="text-slate-600 italic mt-1">{pattern.clinical_notes}</p>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* Comparative Insights */}
        {analysis.comparative_insights?.length > 0 && (
          <Card className="bg-white border-l-4 border-navy-400">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('comparative')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <GitCompare className="w-4 h-4 text-navy-600" />
                  Comparative Analysis
                </h4>
                {expandedSections.includes('comparative') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('comparative') && (
              <CardContent className="space-y-2">
                {analysis.comparative_insights.map((insight, idx) => (
                  <Alert key={idx} className="bg-navy-50 border-navy-300">
                    <GitCompare className="w-4 h-4 text-navy-600" />
                    <AlertDescription className="text-xs">
                      <p className="font-semibold text-navy-900 mb-1">{insight.correlation}</p>
                      <div className="text-slate-700 space-y-1">
                        <p>Metric A: {insight.metric_a}</p>
                        <p>Metric B: {insight.metric_b}</p>
                        <p>Relationship: {insight.relationship}</p>
                        <p className="text-navy-700 font-medium mt-2">Clinical Significance: {insight.clinical_significance}</p>
                      </div>
                    </AlertDescription>
                  </Alert>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* Predictive Analytics */}
        {analysis.predictive_analytics && (
          <Card className="bg-white border-l-4 border-indigo-400">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('predictive')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <Brain className="w-4 h-4 text-indigo-600" />
                  Predictive Analytics
                </h4>
                {expandedSections.includes('predictive') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('predictive') && (
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <Alert className={`${analysis.predictive_analytics.readmission_risk_score > 70 ? 'bg-red-50 border-red-300' : analysis.predictive_analytics.readmission_risk_score > 40 ? 'bg-orange-50 border-orange-300' : 'bg-green-50 border-green-300'}`}>
                    <Shield className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      <p className="font-semibold mb-1">Readmission Risk</p>
                      <div className="text-2xl font-bold">{analysis.predictive_analytics.readmission_risk_score}%</div>
                      <Badge className={`mt-1 ${getConcernColor(analysis.predictive_analytics.readmission_risk_level)} text-white text-xs`}>
                        {analysis.predictive_analytics.readmission_risk_level}
                      </Badge>
                    </AlertDescription>
                  </Alert>

                  <Alert className={`${analysis.predictive_analytics.deterioration_risk_score > 70 ? 'bg-red-50 border-red-300' : analysis.predictive_analytics.deterioration_risk_score > 40 ? 'bg-orange-50 border-orange-300' : 'bg-green-50 border-green-300'}`}>
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription className="text-xs">
                      <p className="font-semibold mb-1">Deterioration Risk</p>
                      <div className="text-2xl font-bold">{analysis.predictive_analytics.deterioration_risk_score}%</div>
                      <Badge className={`mt-1 ${getConcernColor(analysis.predictive_analytics.deterioration_risk_level)} text-white text-xs`}>
                        {analysis.predictive_analytics.deterioration_risk_level}
                      </Badge>
                    </AlertDescription>
                  </Alert>
                </div>

                {analysis.predictive_analytics.key_risk_factors?.length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded p-2">
                    <p className="text-xs font-semibold text-red-900 mb-1">Key Risk Factors:</p>
                    <ul className="space-y-1">
                      {analysis.predictive_analytics.key_risk_factors.map((factor, idx) => (
                        <li key={idx} className="text-xs text-red-800">• {factor}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {analysis.predictive_analytics.predicted_outcomes?.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-slate-900">Predicted Outcomes:</p>
                    {analysis.predictive_analytics.predicted_outcomes.map((outcome, idx) => (
                      <div key={idx} className="bg-indigo-50 border border-indigo-200 rounded p-2">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs font-semibold text-indigo-900">{outcome.outcome}</p>
                          <Badge className="bg-indigo-600 text-white text-xs">{outcome.probability}</Badge>
                        </div>
                        <p className="text-xs text-slate-700">Timeframe: {outcome.timeframe}</p>
                        {outcome.prevention_strategies?.length > 0 && (
                          <div className="mt-2">
                            <p className="text-xs font-semibold text-indigo-800">Prevention:</p>
                            <ul className="space-y-1">
                              {outcome.prevention_strategies.map((strategy, sidx) => (
                                <li key={sidx} className="text-xs text-indigo-700">• {strategy}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* Positive Trends */}
        {analysis.positive_trends?.length > 0 && (
          <Card className="bg-white border-l-4 border-green-400">
            <CardHeader className="pb-2">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => toggleSection('positive')}
              >
                <h4 className="text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  Positive Trends
                </h4>
                {expandedSections.includes('positive') ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </div>
            </CardHeader>
            {expandedSections.includes('positive') && (
              <CardContent className="space-y-2">
                {analysis.positive_trends.map((trend, idx) => (
                  <div key={idx} className="text-xs bg-green-50 border border-green-200 rounded p-2">
                    <p className="font-semibold text-green-900">✓ {trend.achievement}</p>
                    <p className="text-slate-600">{trend.supporting_data}</p>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}

        {/* Priority Recommendations */}
        {analysis.priority_recommendations?.length > 0 && (
          <Alert className="bg-indigo-50 border-indigo-300">
            <Sparkles className="w-4 h-4 text-indigo-600" />
            <AlertDescription>
              <p className="text-xs font-semibold text-indigo-900 mb-2">Priority Recommendations:</p>
              <ul className="space-y-1">
                {analysis.priority_recommendations.map((rec, idx) => (
                  <li key={idx} className="text-xs text-indigo-800">• {rec}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <Button
          onClick={analyzePatient}
          variant="outline"
          size="sm"
          className="w-full"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Re-analyze Trends
        </Button>
      </CardContent>
    </Card>
  );
}