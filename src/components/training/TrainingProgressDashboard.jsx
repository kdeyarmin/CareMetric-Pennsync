import React from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  Clock,
  Award,
  TrendingUp,
  BookOpen,
  Target,
  AlertCircle
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { useMyTrainingCompletions } from "@/hooks/useMyTrainingCompletions";

export default function TrainingProgressDashboard({ nurseEmail }) {
  // Progress is derived from the live course-assignment system rather than the
  // retired per-module TrainingCompletion entity.
  const { assignments, certificates, isCompleted } = useMyTrainingCompletions(nurseEmail);

  const { data: recommendations = [] } = useQuery({
    queryKey: ['activeRecommendations', nurseEmail],
    queryFn: () => base44.entities.TrainingRecommendation.filter({ nurse_email: nurseEmail, addressed: false }),
    enabled: !!nurseEmail
  });

  const certCourseIds = React.useMemo(
    () => new Set(certificates.filter(c => !c.revoked && c.course_id).map(c => c.course_id)),
    [certificates]
  );

  const stats = React.useMemo(() => {
    const completed = assignments.filter(isCompleted).length;
    const inProgress = assignments.filter(a => a.status === 'in_progress').length;
    const assigned = assignments.filter(a => a.status === 'assigned').length;
    const scored = assignments.filter(a => typeof a.score_percentage === 'number');
    const avgScore = scored.reduce((sum, a) => sum + a.score_percentage, 0) / (scored.length || 1);
    // CEU hours earned (from issued certificates) as the "total hours" proxy.
    const totalHours = certificates.reduce((sum, c) => sum + (Number(c.hours) || 0), 0);

    return {
      completed,
      inProgress,
      assigned,
      avgScore: Math.round(avgScore),
      totalHours: Math.round(totalHours),
      completionRate: ((completed / (completed + inProgress + assigned || 1)) * 100).toFixed(0)
    };
  }, [assignments, certificates, isCompleted]);

  const recentCompletions = React.useMemo(() => {
    return assignments
      .filter(isCompleted)
      .sort((a, b) => new Date(b.completion_date || 0) - new Date(a.completion_date || 0))
      .slice(0, 5)
      .map(a => ({
        id: a.id,
        title: a.course_title,
        score: a.score_percentage,
        completion_date: a.completion_date,
        hasCert: a.course_id ? certCourseIds.has(a.course_id) : false,
      }));
  }, [assignments, certCourseIds, isCompleted]);

  const upcomingDeadlines = React.useMemo(() => {
    return assignments
      .filter(a => !isCompleted(a) && a.due_date)
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 5)
      .map(a => ({ id: a.id, title: a.course_title, due_date: a.due_date, status: a.status }));
  }, [assignments, isCompleted]);

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-2 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Completed</p>
                <p className="text-3xl font-bold text-green-600">{stats.completed}</p>
              </div>
              <CheckCircle2 className="w-10 h-10 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Avg Score</p>
                <p className="text-3xl font-bold text-blue-600">{stats.avgScore}%</p>
              </div>
              <Award className="w-10 h-10 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-yellow-50 border-2 border-orange-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">In Progress</p>
                <p className="text-3xl font-bold text-orange-600">{stats.inProgress}</p>
              </div>
              <BookOpen className="w-10 h-10 text-orange-600" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-navy-50 to-gold-50 border-2 border-navy-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Total Hours</p>
                <p className="text-3xl font-bold text-navy-600">{stats.totalHours}</p>
              </div>
              <Clock className="w-10 h-10 text-navy-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              Overall Progress
            </span>
            <Badge className="bg-indigo-600 text-white">{stats.completionRate}%</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Progress value={parseInt(stats.completionRate)} className="h-3 mb-4" />
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              <p className="text-xs text-slate-600">Completed</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-600">{stats.inProgress}</p>
              <p className="text-xs text-slate-600">In Progress</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{stats.assigned}</p>
              <p className="text-xs text-slate-600">Assigned</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Completions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              Recent Completions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {recentCompletions.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No completed modules yet</p>
                ) : (
                  recentCompletions.map((completion) => (
                    <div key={completion.id} className="border rounded-lg p-3 bg-green-50">
                      <div className="flex items-start justify-between mb-2">
                        <h4 className="font-semibold text-sm">{completion.title || 'Untitled Course'}</h4>
                        {completion.score != null && (
                          <Badge className={completion.score >= 80 ? 'bg-green-600' : 'bg-yellow-600'}>
                            {completion.score}%
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-600">
                        Completed {completion.completion_date ? formatEastern(completion.completion_date, 'MMM d, yyyy') : '—'}
                      </p>
                      {completion.hasCert && (
                        <Badge variant="outline" className="mt-2">
                          <Award className="w-3 h-3 mr-1" />
                          Certificate
                        </Badge>
                      )}
                    </div>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Upcoming Deadlines */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-orange-600" />
              Upcoming Deadlines
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
              <div className="space-y-3">
                {upcomingDeadlines.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No upcoming deadlines</p>
                ) : (
                  upcomingDeadlines.map((completion) => {
                    const daysUntilDue = Math.ceil((new Date(completion.due_date) - new Date()) / (1000 * 60 * 60 * 24));
                    const isOverdue = daysUntilDue < 0;
                    const isUrgent = daysUntilDue <= 3 && daysUntilDue >= 0;

                    return (
                      <div key={completion.id} className={`border rounded-lg p-3 ${isOverdue ? 'bg-red-50 border-red-200' : isUrgent ? 'bg-orange-50 border-orange-200' : 'bg-blue-50'}`}>
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="font-semibold text-sm">{completion.title || 'Untitled Course'}</h4>
                          <Badge className={isOverdue ? 'bg-red-600' : isUrgent ? 'bg-orange-600' : 'bg-blue-600'}>
                            {isOverdue ? 'Overdue' : isUrgent ? 'Urgent' : `${daysUntilDue}d`}
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-600">
                          Due {formatEastern(completion.due_date, 'MMM d, yyyy')}
                        </p>
                        <Progress 
                          value={completion.status === 'in_progress' ? 50 : 0} 
                          className="h-2 mt-2" 
                        />
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      {/* Open AI Recommendations */}
      {recommendations.length > 0 && (
        <Card className="border-2 border-navy-300">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-5 h-5 text-navy-600" />
              AI-Identified Learning Opportunities ({recommendations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recommendations.slice(0, 5).map((rec) => (
                <div key={rec.id} className="border-l-4 border-navy-500 pl-3 py-2 bg-navy-50">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge className="bg-navy-600 text-white text-xs">
                      {rec.recommendation_type.replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{rec.severity}</Badge>
                  </div>
                  <p className="text-sm text-slate-700">{rec.recommendation_text}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}