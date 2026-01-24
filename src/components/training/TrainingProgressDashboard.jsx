import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle, Clock, AlertCircle, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default function TrainingProgressDashboard({ providers }) {
  const { data: allCompletions = [], isLoading } = useQuery({
    queryKey: ['allTrainingCompletions'],
    queryFn: () => base44.entities.TrainingCompletion.list('-created_date', 1000)
  });

  const { data: trainingModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list()
  });

  const stats = useMemo(() => {
    const assigned = allCompletions.filter(c => c.status === 'assigned' || c.status === 'in_progress');
    const completed = allCompletions.filter(c => c.status === 'completed');
    const overdue = allCompletions.filter(c => 
      c.status !== 'completed' && 
      c.due_date && 
      new Date(c.due_date) < new Date()
    );

    const totalAssigned = allCompletions.length;
    const completionRate = totalAssigned > 0 ? Math.round((completed.length / totalAssigned) * 100) : 0;

    return {
      totalAssigned,
      completed: completed.length,
      inProgress: assigned.length,
      overdue: overdue.length,
      completionRate
    };
  }, [allCompletions]);

  // Provider-level progress
  const providerProgress = useMemo(() => {
    return providers.map(provider => {
      const providerCompletions = allCompletions.filter(c => c.nurse_email === provider.email);
      const completed = providerCompletions.filter(c => c.status === 'completed').length;
      const total = providerCompletions.length;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        email: provider.email,
        name: provider.full_name,
        total,
        completed,
        rate,
        overdue: providerCompletions.filter(c => 
          c.status !== 'completed' && 
          c.due_date && 
          new Date(c.due_date) < new Date()
        ).length
      };
    }).sort((a, b) => b.rate - a.rate);
  }, [providers, allCompletions]);

  // Module-level completion
  const moduleProgress = useMemo(() => {
    return trainingModules.map(module => {
      const moduleCompletions = allCompletions.filter(c => c.training_module_id === module.id);
      const completed = moduleCompletions.filter(c => c.status === 'completed').length;
      const total = moduleCompletions.length;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;

      return {
        id: module.id,
        title: module.title,
        total,
        completed,
        rate
      };
    }).sort((a, b) => b.total - a.total).slice(0, 5);
  }, [trainingModules, allCompletions]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Total Assigned</p>
                <p className="text-2xl font-bold text-slate-900">{stats.totalAssigned}</p>
              </div>
              <Clock className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Completed</p>
                <p className="text-2xl font-bold text-green-600">{stats.completed}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Overdue</p>
                <p className="text-2xl font-bold text-red-600">{stats.overdue}</p>
              </div>
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-500">Completion Rate</p>
                <p className="text-2xl font-bold text-blue-600">{stats.completionRate}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Provider Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Provider Training Progress</CardTitle>
          <CardDescription>Completion rates by provider</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {providerProgress.map(p => (
              <div key={p.email} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="font-medium text-sm text-slate-900">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.completed} of {p.total} completed
                      {p.overdue > 0 && (
                        <span className="text-red-600 ml-2">• {p.overdue} overdue</span>
                      )}
                    </p>
                  </div>
                  <Badge className={
                    p.rate >= 80 ? "bg-green-100 text-green-800" :
                    p.rate >= 50 ? "bg-yellow-100 text-yellow-800" :
                    "bg-red-100 text-red-800"
                  }>
                    {p.rate}%
                  </Badge>
                </div>
                <Progress value={p.rate} className="h-2" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Module Popularity */}
      <Card>
        <CardHeader>
          <CardTitle>Most Assigned Modules</CardTitle>
          <CardDescription>Top 5 training modules by assignment count</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {moduleProgress.map(m => (
              <div key={m.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium text-sm text-slate-900">{m.title}</p>
                  <p className="text-xs text-slate-500">{m.completed}/{m.total} completed</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-900">{m.rate}%</p>
                  <Progress value={m.rate} className="h-1 w-20" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}