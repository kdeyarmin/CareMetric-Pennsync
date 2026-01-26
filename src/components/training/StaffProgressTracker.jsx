import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, Award, Target, Calendar, CheckCircle2, Clock, BarChart3, Zap } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function StaffProgressTracker({ currentUser, completions, modules, skillGaps }) {
  // Calculate comprehensive stats
  const stats = useMemo(() => {
    const completed = completions.filter(c => c.status === 'completed');
    const inProgress = completions.filter(c => c.status === 'in_progress');
    
    const totalHours = completed.reduce((sum, c) => {
      const module = modules.find(m => m.id === c.module_id);
      return sum + ((module?.estimated_duration_minutes || 30) / 60);
    }, 0);

    const avgScore = completed.filter(c => c.score).length > 0
      ? Math.round(completed.filter(c => c.score).reduce((sum, c) => sum + c.score, 0) / completed.filter(c => c.score).length)
      : 0;

    // Calculate trend (last 30 days vs previous 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const recentCompletions = completed.filter(c => 
      c.completion_date && new Date(c.completion_date) >= thirtyDaysAgo
    ).length;

    const previousCompletions = completed.filter(c => 
      c.completion_date && 
      new Date(c.completion_date) < thirtyDaysAgo &&
      new Date(c.completion_date) >= sixtyDaysAgo
    ).length;

    const trend = previousCompletions > 0 
      ? Math.round(((recentCompletions - previousCompletions) / previousCompletions) * 100)
      : 0;

    return {
      completed: completed.length,
      inProgress: inProgress.length,
      totalHours: totalHours.toFixed(1),
      avgScore,
      completionRate: modules.length > 0 ? Math.round((completed.length / modules.length) * 100) : 0,
      trend,
      recentCompletions
    };
  }, [completions, modules]);

  // Progress over time chart
  const progressData = useMemo(() => {
    const last90Days = Array.from({ length: 12 }, (_, i) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - ((11 - i) * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);

      const weekCompletions = completions.filter(c => 
        c.completion_date && 
        new Date(c.completion_date) >= weekStart &&
        new Date(c.completion_date) < weekEnd &&
        c.status === 'completed'
      ).length;

      return {
        week: `Week ${i + 1}`,
        completions: weekCompletions,
        date: weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
    });

    return last90Days;
  }, [completions]);

  // Category breakdown
  const categoryData = useMemo(() => {
    const categoryMap = {};
    
    completions.forEach(c => {
      if (c.status === 'completed') {
        const module = modules.find(m => m.id === c.module_id);
        const category = module?.category || 'other';
        categoryMap[category] = (categoryMap[category] || 0) + 1;
      }
    });

    return Object.entries(categoryMap).map(([category, count]) => ({
      category: category.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      count
    }));
  }, [completions, modules]);

  // Recent completions
  const recentCompletions = useMemo(() => {
    return completions
      .filter(c => c.status === 'completed' && c.completion_date)
      .sort((a, b) => new Date(b.completion_date) - new Date(a.completion_date))
      .slice(0, 5)
      .map(c => {
        const module = modules.find(m => m.id === c.module_id);
        return { ...c, moduleTitle: module?.title || 'Unknown Module' };
      });
  }, [completions, modules]);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Award className="w-8 h-8 text-blue-600" />
              {stats.trend > 0 && (
                <Badge className="bg-green-600">
                  +{stats.trend}%
                </Badge>
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.completed}</p>
            <p className="text-sm text-gray-600">Modules Completed</p>
            <p className="text-xs text-gray-500 mt-1">{stats.recentCompletions} this month</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Clock className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.totalHours}</p>
            <p className="text-sm text-gray-600">Hours of Training</p>
            <p className="text-xs text-gray-500 mt-1">{stats.inProgress} in progress</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.avgScore}%</p>
            <p className="text-sm text-gray-600">Average Score</p>
            <p className="text-xs text-gray-500 mt-1">Across all assessments</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Target className="w-8 h-8 text-amber-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{stats.completionRate}%</p>
            <p className="text-sm text-gray-600">Completion Rate</p>
            <p className="text-xs text-gray-500 mt-1">{stats.completed} of {modules.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Progress Over Time */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Training Activity (Last 12 Weeks)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={progressData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="completions" 
                stroke="#3b82f6" 
                strokeWidth={2}
                name="Modules Completed"
                dot={{ fill: '#3b82f6', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Training by Category */}
      {categoryData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-purple-600" />
              Training by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={categoryData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="category" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Recent Achievements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-600" />
            Recent Completions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentCompletions.length > 0 ? (
            <div className="space-y-3">
              {recentCompletions.map((completion) => (
                <div key={completion.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border">
                  <div className="flex items-center gap-3 flex-1">
                    <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-gray-900 truncate">{completion.moduleTitle}</p>
                      <p className="text-xs text-gray-600">
                        {new Date(completion.completion_date).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </p>
                    </div>
                  </div>
                  {completion.score && (
                    <Badge className="bg-green-600 ml-2">
                      {completion.score}%
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p>No completions yet - start your first training module!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Skill Gaps */}
      {skillGaps.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-600" />
              Focus Areas for Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {skillGaps.slice(0, 5).map((gap) => (
                <div key={gap.id} className="flex items-start justify-between p-3 bg-white rounded-lg border border-amber-200">
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">{gap.skill_name}</p>
                    <p className="text-sm text-gray-600">{gap.gap_description}</p>
                    {gap.recommended_training && (
                      <p className="text-xs text-blue-600 mt-1">→ {gap.recommended_training}</p>
                    )}
                  </div>
                  <Badge className={
                    gap.priority === 'high' ? 'bg-red-600' :
                    gap.priority === 'medium' ? 'bg-amber-600' :
                    'bg-blue-600'
                  }>
                    {gap.priority}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overall Progress */}
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-green-600" />
            Overall Training Progress
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-2">
                <span className="font-medium text-gray-900">Completion Rate</span>
                <span className="font-bold text-green-600">{stats.completionRate}%</span>
              </div>
              <Progress value={stats.completionRate} className="h-3" />
              <p className="text-xs text-gray-600 mt-1">
                {stats.completed} of {modules.length} available modules
              </p>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-4 border-t">
              <div className="text-center p-3 bg-white rounded-lg">
                <p className="text-lg font-bold text-blue-600">{stats.completed}</p>
                <p className="text-xs text-gray-600">Completed</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg">
                <p className="text-lg font-bold text-purple-600">{stats.inProgress}</p>
                <p className="text-xs text-gray-600">In Progress</p>
              </div>
              <div className="text-center p-3 bg-white rounded-lg">
                <p className="text-lg font-bold text-green-600">{stats.avgScore}%</p>
                <p className="text-xs text-gray-600">Avg Score</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Certifications & Achievements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-amber-600" />
            Certifications & Badges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.completed >= 5 && (
              <div className="text-center p-4 bg-gradient-to-br from-amber-50 to-yellow-100 rounded-lg border-2 border-amber-300">
                <Award className="w-10 h-10 text-amber-600 mx-auto mb-2" />
                <p className="font-semibold text-sm">Learner</p>
                <p className="text-xs text-gray-600">5+ modules</p>
              </div>
            )}
            {stats.completed >= 10 && (
              <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-cyan-100 rounded-lg border-2 border-blue-300">
                <Award className="w-10 h-10 text-blue-600 mx-auto mb-2" />
                <p className="font-semibold text-sm">Dedicated</p>
                <p className="text-xs text-gray-600">10+ modules</p>
              </div>
            )}
            {stats.avgScore >= 90 && stats.completed >= 5 && (
              <div className="text-center p-4 bg-gradient-to-br from-green-50 to-emerald-100 rounded-lg border-2 border-green-300">
                <Award className="w-10 h-10 text-green-600 mx-auto mb-2" />
                <p className="font-semibold text-sm">Excellence</p>
                <p className="text-xs text-gray-600">90%+ average</p>
              </div>
            )}
            {stats.completed >= 20 && (
              <div className="text-center p-4 bg-gradient-to-br from-purple-50 to-pink-100 rounded-lg border-2 border-purple-300">
                <Award className="w-10 h-10 text-purple-600 mx-auto mb-2" />
                <p className="font-semibold text-sm">Expert</p>
                <p className="text-xs text-gray-600">20+ modules</p>
              </div>
            )}
          </div>
          {stats.completed === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-sm">Complete training modules to earn badges and certifications</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* In Progress Modules */}
      {stats.inProgress > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Currently Learning ({stats.inProgress})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {completions
                .filter(c => c.status === 'in_progress')
                .map(c => {
                  const module = modules.find(m => m.id === c.module_id);
                  return (
                    <div key={c.id} className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <div className="flex items-start justify-between mb-2">
                        <p className="font-medium text-gray-900">{module?.title || 'Unknown Module'}</p>
                        {c.progress_percentage && (
                          <Badge variant="outline">{c.progress_percentage}%</Badge>
                        )}
                      </div>
                      {c.progress_percentage && (
                        <Progress value={c.progress_percentage} className="h-2 mb-2" />
                      )}
                      <p className="text-xs text-gray-600">
                        Started: {new Date(c.started_date).toLocaleDateString()}
                      </p>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}