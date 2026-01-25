import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Users, CheckCircle, Clock, TrendingUp } from "lucide-react";

export default function AgencyTrainingReport({ agency }) {
  const { data: agencyUsers = [] } = useQuery({
    queryKey: ['agencyUsers', agency.agency_code],
    queryFn: async () => {
      const allUsers = await base44.asServiceRole.entities.User.list();
      return allUsers.filter(u => u.agency_code === agency.agency_code);
    }
  });

  const { data: allModules = [] } = useQuery({
    queryKey: ['trainingModules'],
    queryFn: () => base44.entities.TrainingModule.list()
  });

  const { data: allCompletions = [] } = useQuery({
    queryKey: ['allTrainingCompletions', agency.agency_code],
    queryFn: async () => {
      const completions = await base44.asServiceRole.entities.TrainingCompletion.list();
      const agencyUserEmails = agencyUsers.map(u => u.email);
      return completions.filter(c => agencyUserEmails.includes(c.nurse_email));
    },
    enabled: agencyUsers.length > 0
  });

  // Calculate stats
  const requiredModules = allModules.filter(m => m.is_required);
  const totalRequired = requiredModules.length * agencyUsers.length;
  const completedRequired = allCompletions.filter(c => {
    const module = allModules.find(m => m.id === c.training_module_id);
    return module?.is_required && c.status === 'completed';
  }).length;
  const overallCompletionRate = totalRequired > 0 ? Math.round((completedRequired / totalRequired) * 100) : 0;

  // User completion stats
  const userStats = agencyUsers.map(user => {
    const userCompletions = allCompletions.filter(c => c.nurse_email === user.email && c.status === 'completed');
    const userRequired = requiredModules.length;
    const userCompleted = userCompletions.filter(c => {
      const module = allModules.find(m => m.id === c.training_module_id);
      return module?.is_required;
    }).length;
    
    return {
      name: user.full_name || user.email,
      email: user.email,
      completed: userCompleted,
      total: userRequired,
      percentage: userRequired > 0 ? Math.round((userCompleted / userRequired) * 100) : 0
    };
  }).sort((a, b) => b.percentage - a.percentage);

  // Module completion stats
  const moduleStats = requiredModules.map(module => {
    const moduleCompletions = allCompletions.filter(c => 
      c.training_module_id === module.id && c.status === 'completed'
    );
    const completionRate = agencyUsers.length > 0 
      ? Math.round((moduleCompletions.length / agencyUsers.length) * 100) 
      : 0;

    return {
      title: module.title,
      completed: moduleCompletions.length,
      total: agencyUsers.length,
      percentage: completionRate
    };
  }).sort((a, b) => a.percentage - b.percentage);

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Overall Completion</p>
                <p className="text-2xl font-bold">{overallCompletionRate}%</p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Active Users</p>
                <p className="text-2xl font-bold">{agencyUsers.length}</p>
              </div>
              <Users className="w-8 h-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Required Modules</p>
                <p className="text-2xl font-bold">{requiredModules.length}</p>
              </div>
              <BarChart3 className="w-8 h-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600">Completions</p>
                <p className="text-2xl font-bold">{completedRequired}/{totalRequired}</p>
              </div>
              <CheckCircle className="w-8 h-8 text-orange-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* User Progress */}
      <Card>
        <CardHeader>
          <CardTitle>User Progress</CardTitle>
          <CardDescription>Required training completion by user</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {userStats.map((user, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-medium text-sm">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.completed}/{user.total} completed</p>
                  </div>
                  <Badge className={
                    user.percentage === 100 ? "bg-green-600" :
                    user.percentage >= 50 ? "bg-blue-600" :
                    "bg-orange-600"
                  }>
                    {user.percentage}%
                  </Badge>
                </div>
                <Progress value={user.percentage} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Module Completion Rates */}
      <Card>
        <CardHeader>
          <CardTitle>Module Completion Rates</CardTitle>
          <CardDescription>How many users completed each required module</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {moduleStats.map((mod, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-center">
                  <p className="font-medium text-sm">{mod.title}</p>
                  <span className="text-sm text-slate-600">{mod.completed}/{mod.total}</span>
                </div>
                <Progress value={mod.percentage} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}