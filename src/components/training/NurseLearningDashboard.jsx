import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  Award,
  Target,
  AlertCircle,
  CheckCircle2,
  Clock,
  Brain,
  FileText,
  Sparkles,
  ArrowRight
} from "lucide-react";
import { format } from "date-fns";
import { analyzeNurseDeficits } from "./DeficitAnalyzer";

export default function NurseLearningDashboard({ 
  nurseEmail, 
  trainingProgress = [], 
  recommendations = [],
  onStartScenario,
  onStartQuiz
}) {
  const [deficitAnalysis, setDeficitAnalysis] = useState(null);
  const [_isAnalyzing, setIsAnalyzing] = useState(false);

  const loadDeficitAnalysis = useCallback(async () => {
    setIsAnalyzing(true);
    const analysis = await analyzeNurseDeficits(nurseEmail);
    setDeficitAnalysis(analysis);
    setIsAnalyzing(false);
  }, [nurseEmail]);

  useEffect(() => {
    if (nurseEmail) {
      loadDeficitAnalysis();
    }
  }, [nurseEmail, loadDeficitAnalysis]);
  // Calculate statistics
  const totalCompleted = trainingProgress.filter(p => p.status === 'completed').length;
  const totalInProgress = trainingProgress.filter(p => p.status === 'in_progress').length;
  const averageScore = trainingProgress.length > 0
    ? trainingProgress.reduce((sum, p) => sum + (p.score || 0), 0) / trainingProgress.length
    : 0;

  // Group by skill area
  const skillAreas = trainingProgress.reduce((acc, item) => {
    if (!acc[item.skill_area]) {
      acc[item.skill_area] = [];
    }
    acc[item.skill_area].push(item);
    return acc;
  }, {});

  // Calculate skill area stats
  const skillAreaStats = Object.entries(skillAreas).map(([area, items]) => {
    const completed = items.filter(i => i.status === 'completed').length;
    const avgScore = items.reduce((sum, i) => sum + (i.score || 0), 0) / items.length;
    return {
      area,
      completed,
      total: items.length,
      avgScore,
      items
    };
  }).sort((a, b) => b.completed - a.completed);

  // Recent activity
  const recentActivity = [...trainingProgress]
    .sort((a, b) => new Date(b.created_date) - new Date(a.created_date))
    .slice(0, 10);

  // Identify weak areas (score < 70)
  const weakAreas = skillAreaStats.filter(s => s.avgScore < 70);

  return (
    <div className="space-y-6">
      {/* AI-Identified Deficits with Auto-Recommendations */}
      {deficitAnalysis?.deficits && deficitAnalysis.deficits.length > 0 && (
        <Card className="bg-gradient-to-r from-navy-50 to-gold-50 border-navy-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-navy-600" />
              AI-Detected Documentation Patterns
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-white/70 p-3 rounded-lg border border-navy-200">
              <p className="text-sm text-navy-900 mb-2">
                Based on {deficitAnalysis.totalSuggestions} AI suggestions from your recent documentation, 
                we've identified areas where additional training could strengthen your skills:
              </p>
            </div>

            {deficitAnalysis.deficits.map((deficit, idx) => (
              <Card key={idx} className="bg-white hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-semibold text-lg capitalize">{deficit.category}</h4>
                        <Badge className={
                          deficit.severity === 'critical' ? 'bg-red-100 text-red-800' :
                          deficit.severity === 'high' ? 'bg-orange-100 text-orange-800' :
                          'bg-yellow-100 text-yellow-800'
                        }>
                          {deficit.count} AI suggestions
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mb-2">
                        AI has provided assistance in this area {deficit.count} times across your recent notes
                      </p>
                    </div>
                  </div>

                  {/* Recent examples */}
                  {deficit.examples.length > 0 && (
                    <div className="mb-3 space-y-1">
                      <p className="text-xs font-semibold text-slate-700">Recent examples:</p>
                      {deficit.examples.slice(0, 2).map((ex, i) => (
                        <p key={i} className="text-xs text-slate-600 italic pl-3 border-l-2 border-slate-200">
                          "{(ex.text || '').substring(0, 100)}..." - from {ex.source}
                        </p>
                      ))}
                    </div>
                  )}

                  {/* Auto-recommended training */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200">
                    <p className="text-xs font-semibold text-blue-900 mb-2 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Recommended Training:
                    </p>
                    <div className="space-y-2">
                      {deficitAnalysis.recommendations
                        ?.find(r => r.category === deficit.category)
                        ?.suggestedScenarios?.slice(0, 2).map((scenarioId, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="w-full justify-between text-xs"
                            onClick={() => onStartScenario?.(scenarioId)}
                          >
                            <span className="flex items-center gap-1">
                              <FileText className="w-3 h-3" />
                              Practice: {scenarioId.replace(/_/g, ' ')}
                            </span>
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        ))}
                      {deficitAnalysis.recommendations
                        ?.find(r => r.category === deficit.category)
                        ?.suggestedQuizzes?.slice(0, 1).map((quizId, i) => (
                          <Button
                            key={i}
                            size="sm"
                            variant="outline"
                            className="w-full justify-between text-xs"
                            onClick={() => onStartQuiz?.(quizId)}
                          >
                            <span className="flex items-center gap-1">
                              <Brain className="w-3 h-3" />
                              Quiz: {quizId.replace(/_/g, ' ')}
                            </span>
                            <ArrowRight className="w-3 h-3" />
                          </Button>
                        ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Completion Rate</p>
                <p className="text-3xl font-bold text-slate-900">
                  {trainingProgress.length > 0 
                    ? Math.round((totalCompleted / trainingProgress.length) * 100)
                    : 0}%
                </p>
              </div>
              <CheckCircle2 className="w-12 h-12 text-green-600" />
            </div>
            <Progress 
              value={trainingProgress.length > 0 ? (totalCompleted / trainingProgress.length) * 100 : 0} 
              className="mt-3" 
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Average Score</p>
                <p className="text-3xl font-bold text-slate-900">{averageScore.toFixed(0)}%</p>
              </div>
              <Award className="w-12 h-12 text-yellow-600" />
            </div>
            <Progress value={averageScore} className="mt-3" />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 mb-1">Total Modules</p>
                <p className="text-3xl font-bold text-slate-900">{trainingProgress.length}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {totalInProgress} in progress
                </p>
              </div>
              <Brain className="w-12 h-12 text-indigo-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Weak Areas Alert */}
      {weakAreas.length > 0 && (
        <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              Areas Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {weakAreas.map((area) => (
                <div key={area.area} className="flex items-center justify-between p-3 bg-white rounded-lg border">
                  <div>
                    <p className="font-medium text-slate-900">{area.area}</p>
                    <p className="text-sm text-slate-600">
                      {area.completed} / {area.total} completed
                    </p>
                  </div>
                  <Badge className="bg-orange-100 text-orange-800">
                    {area.avgScore.toFixed(0)}% avg
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Skill Area Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Performance by Topic
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {skillAreaStats.map((stat) => (
              <div key={stat.area} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-slate-500" />
                    <span className="font-medium text-slate-900">{stat.area}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-slate-600">
                      {stat.completed} / {stat.total} modules
                    </span>
                    <Badge 
                      className={
                        stat.avgScore >= 90 ? 'bg-green-100 text-green-800' :
                        stat.avgScore >= 70 ? 'bg-yellow-100 text-yellow-800' :
                        'bg-red-100 text-red-800'
                      }
                    >
                      {stat.avgScore.toFixed(0)}%
                    </Badge>
                  </div>
                </div>
                <Progress value={stat.avgScore} className="h-2" />
              </div>
            ))}

            {skillAreaStats.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Brain className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No training completed yet. Start with a practice scenario or quiz!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start gap-3 p-3 bg-slate-50 rounded-lg">
                <div className={`p-2 rounded-lg ${
                  activity.module_type === 'quiz' ? 'bg-navy-100' : 'bg-indigo-100'
                }`}>
                  {activity.module_type === 'quiz' ? (
                    <Brain className="w-4 h-4 text-navy-600" />
                  ) : (
                    <FileText className="w-4 h-4 text-indigo-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <p className="font-medium text-slate-900">{activity.skill_area}</p>
                    <Badge className={
                      activity.status === 'completed' ? 'bg-green-100 text-green-800' :
                      activity.status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }>
                      {activity.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="capitalize">{activity.module_type}</span>
                    {activity.score && (
                      <>
                        <span>•</span>
                        <span className="font-medium">{activity.score}%</span>
                      </>
                    )}
                    <span>•</span>
                    <span>{format(new Date(activity.created_date), 'MMM d, h:mm a')}</span>
                  </div>
                </div>
              </div>
            ))}

            {recentActivity.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <Clock className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p>No recent activity. Start your learning journey today!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Active Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-orange-600" />
              Training Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recommendations.map((rec) => (
                <div key={rec.id} className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className="bg-amber-100 text-amber-800 text-xs">
                          {rec.recommendation_type}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {rec.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-700">{rec.recommendation_text}</p>
                      <p className="text-xs text-slate-500 mt-1">Source: {rec.source}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}