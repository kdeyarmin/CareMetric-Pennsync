import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  TrendingUp,
  AlertTriangle,
  Target,
  BarChart3,
  FileText,
  Brain,
  CheckCircle2,
  ArrowRight,
  Loader2,
  GraduationCap
} from "lucide-react";
import { format } from "date-fns";
import { analyzeNurseDeficits as analyzeNurseDeficitsBackend } from "@/functions/analyzeNurseDeficits";

export default function DetailedDeficitReport({ 
  nurseEmail, 
  onStartScenario, 
  onStartQuiz 
}) {
  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [daysPeriod, setDaysPeriod] = useState(30);

  const loadAnalysis = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await analyzeNurseDeficitsBackend({
        nurseEmail,
        daysPeriod
      });
      setAnalysis(response.data);
    } catch (error) {
      console.error("Error loading deficit analysis:", error);
    }
    setIsLoading(false);
  }, [nurseEmail, daysPeriod]);

  useEffect(() => {
    if (nurseEmail) {
      loadAnalysis();
    }
  }, [nurseEmail, daysPeriod, loadAnalysis]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <Loader2 className="w-12 h-12 animate-spin text-indigo-600 mx-auto mb-4" />
          <p className="text-slate-600">Analyzing your documentation patterns...</p>
        </CardContent>
      </Card>
    );
  }

  if (!analysis || analysis.totalSuggestions === 0) {
    return (
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardContent className="p-8 text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-green-900 mb-2">Excellent Documentation!</h3>
          <p className="text-green-700">
            No recurring AI suggestions found in the last {daysPeriod} days. Keep up the great work!
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Analysis Summary */}
      <Card className="bg-gradient-to-r from-indigo-50 to-navy-50 border-indigo-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Documentation Pattern Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-3 rounded-lg border">
              <p className="text-xs text-slate-600 mb-1">Total AI Suggestions</p>
              <p className="text-2xl font-bold text-slate-900">{analysis.totalSuggestions}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <p className="text-xs text-slate-600 mb-1">Analysis Period</p>
              <p className="text-2xl font-bold text-slate-900">{daysPeriod}</p>
              <p className="text-xs text-slate-500">days</p>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <p className="text-xs text-slate-600 mb-1">Deficit Areas</p>
              <p className="text-2xl font-bold text-red-600">{analysis.deficits.length}</p>
            </div>
            <div className="bg-white p-3 rounded-lg border">
              <p className="text-xs text-slate-600 mb-1">Patients Affected</p>
              <p className="text-2xl font-bold text-slate-900">
                {analysis.analytics.patientSpecificCount}
              </p>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant={daysPeriod === 7 ? "default" : "outline"}
              onClick={() => setDaysPeriod(7)}
            >
              7 Days
            </Button>
            <Button
              size="sm"
              variant={daysPeriod === 30 ? "default" : "outline"}
              onClick={() => setDaysPeriod(30)}
            >
              30 Days
            </Button>
            <Button
              size="sm"
              variant={daysPeriod === 90 ? "default" : "outline"}
              onClick={() => setDaysPeriod(90)}
            >
              90 Days
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Identified Patterns */}
      {analysis.patterns.length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-900">
              <TrendingUp className="w-5 h-5" />
              Identified Patterns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {analysis.patterns.map((pattern, idx) => (
              <div key={idx} className="bg-white p-3 rounded-lg border border-orange-200">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900 mb-1">{pattern.description}</p>
                    <p className="text-sm text-slate-600 mb-2">{pattern.implication}</p>
                    <Badge className="bg-orange-100 text-orange-800">
                      {pattern.count} occurrences
                    </Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Detailed Deficits with Training Recommendations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-red-600" />
            Deficit Areas & Recommended Training
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {analysis.deficits.map((deficit, idx) => (
            <Card key={idx} className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h4 className="font-bold text-lg capitalize">{deficit.name}</h4>
                      <Badge className={
                        deficit.severity === 'critical' ? 'bg-red-600 text-white' :
                        deficit.severity === 'high' ? 'bg-orange-600 text-white' :
                        'bg-yellow-600 text-white'
                      }>
                        {deficit.severity}
                      </Badge>
                      <Badge variant="outline">
                        {deficit.percentage}% of suggestions
                      </Badge>
                    </div>
                    <p className="text-sm text-slate-700 mb-2">
                      AI has provided {deficit.count} suggestion{deficit.count > 1 ? 's' : ''} in this area
                    </p>
                    <Progress 
                      value={Math.min((deficit.count / analysis.totalSuggestions) * 100, 100)} 
                      className="h-2 mb-3" 
                    />
                  </div>
                </div>

                {/* Recent Examples */}
                <div className="bg-white p-3 rounded-lg border mb-3">
                  <p className="text-xs font-semibold text-slate-700 mb-2">Recent Examples:</p>
                  <div className="space-y-2">
                    {deficit.examples.map((ex, i) => (
                      <div key={i} className="text-xs text-slate-600 pl-3 border-l-2 border-slate-300">
                        <p className="italic mb-1">"{(ex.text || '').substring(0, 120)}..."</p>
                        <p className="text-[10px] text-slate-500">
                          {ex.element && `${ex.element} • `}
                          {ex.source} • {format(new Date(ex.date), 'MMM d, h:mm a')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Recommended Training */}
                {analysis.recommendations.find(r => r.category === deficit.name) && (
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2 flex items-center gap-1">
                      <GraduationCap className="w-3 h-3" />
                      Recommended Training:
                    </p>
                    <div className="space-y-2">
                      {analysis.recommendations
                        .find(r => r.category === deficit.name)
                        ?.suggestedScenarios.map((scenarioId, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="w-full justify-between"
                            onClick={() => onStartScenario?.(scenarioId)}
                          >
                            <span className="flex items-center gap-2">
                              <FileText className="w-3 h-3" />
                              Practice: {scenarioId.replace(/_/g, ' ')}
                            </span>
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        ))}
                      {analysis.recommendations
                        .find(r => r.category === deficit.name)
                        ?.suggestedQuizzes.slice(0, 2).map((quizId, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="w-full justify-between"
                            onClick={() => onStartQuiz?.(quizId)}
                          >
                            <span className="flex items-center gap-2">
                              <Brain className="w-3 h-3" />
                              Quiz: {quizId.replace(/_/g, ' ')}
                            </span>
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      {/* Analytics Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="w-4 h-4 text-slate-600" />
            Detailed Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Category Breakdown */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Suggestions by Category</p>
            <div className="space-y-2">
              {Object.entries(analysis.analytics.categoryBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([category, count], idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <span className="text-sm capitalize text-slate-700">{category}</span>
                    <div className="flex items-center gap-2">
                      <Progress 
                        value={(count / analysis.totalSuggestions) * 100} 
                        className="w-24 h-2" 
                      />
                      <span className="text-sm font-medium text-slate-900 w-8 text-right">{count}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Source Breakdown */}
          <div className="pt-3 border-t">
            <p className="text-xs font-semibold text-slate-700 mb-2">Suggestions by AI Component</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(analysis.analytics.sourceBreakdown)
                .sort((a, b) => b[1] - a[1])
                .map(([source, count], idx) => (
                  <Badge key={idx} variant="outline" className="text-xs">
                    {source.replace(/_/g, ' ')}: {count}
                  </Badge>
                ))}
            </div>
          </div>

          {/* Severity Distribution */}
          <div className="pt-3 border-t">
            <p className="text-xs font-semibold text-slate-700 mb-2">By Severity</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-red-50 p-2 rounded border border-red-200 text-center">
                <p className="text-xs text-red-700">Critical</p>
                <p className="text-lg font-bold text-red-900">{analysis.analytics.severityDistribution.critical}</p>
              </div>
              <div className="bg-orange-50 p-2 rounded border border-orange-200 text-center">
                <p className="text-xs text-orange-700">High</p>
                <p className="text-lg font-bold text-orange-900">{analysis.analytics.severityDistribution.high}</p>
              </div>
              <div className="bg-yellow-50 p-2 rounded border border-yellow-200 text-center">
                <p className="text-xs text-yellow-700">Medium</p>
                <p className="text-lg font-bold text-yellow-900">{analysis.analytics.severityDistribution.medium}</p>
              </div>
              <div className="bg-blue-50 p-2 rounded border border-blue-200 text-center">
                <p className="text-xs text-blue-700">Low</p>
                <p className="text-lg font-bold text-blue-900">{analysis.analytics.severityDistribution.low}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Strengths */}
      {analysis.strengths.length > 0 && (
        <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-900">
              <CheckCircle2 className="w-5 h-5" />
              Your Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analysis.strengths.map((strength, idx) => (
                <Badge key={idx} className="bg-green-600 text-white">
                  {strength.category}
                </Badge>
              ))}
            </div>
            <p className="text-sm text-green-800 mt-3">
              These areas show minimal AI assistance needed, indicating strong independent documentation skills.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}