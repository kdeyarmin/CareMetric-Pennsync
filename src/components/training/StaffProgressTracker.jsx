import React, { useState, useMemo } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Users, 
  Search, 
  TrendingUp, 
  AlertTriangle, 
  CheckCircle2,
  Clock,
  Award,
  ArrowUpDown,
  UserPlus,
  Send,
  BarChart3
} from 'lucide-react';
import { format, differenceInDays } from 'date-fns';
import { toast } from 'sonner';

export default function StaffProgressTracker({ users, trainingModules }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('completion');
  const [filterStatus, setFilterStatus] = useState('all');
  const [selectedUser, setSelectedUser] = useState(null);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedModule, setSelectedModule] = useState('');
  const queryClient = useQueryClient();

  // Fetch all completions for admin view
  const { data: allCompletions = [], isLoading } = useQuery({
    queryKey: ['allCompletions'],
    queryFn: () => base44.entities.TrainingCompletion.list('-created_date', 1000),
    initialData: []
  });

  // Fetch all skill gaps
  const { data: allSkillGaps = [] } = useQuery({
    queryKey: ['allSkillGaps'],
    queryFn: () => base44.entities.SkillGap.list('-created_date', 500),
    initialData: []
  });

  const assignTrainingMutation = useMutation({
    mutationFn: ({ userEmail, moduleId }) => base44.entities.TrainingCompletion.create({
      nurse_email: userEmail,
      training_module_id: moduleId,
      status: 'assigned',
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    }),
    onSuccess: () => {
      queryClient.invalidateQueries(['allCompletions']);
      toast.success('Training assigned successfully');
      setAssignDialogOpen(false);
    }
  });

  // Calculate staff progress data
  const staffProgress = useMemo(() => {
    return users.map(user => {
      const userCompletions = allCompletions.filter(c => c.nurse_email === user.email);
      const completed = userCompletions.filter(c => c.status === 'completed');
      const inProgress = userCompletions.filter(c => c.status === 'in_progress' || c.status === 'assigned');
      const overdue = userCompletions.filter(c => 
        c.status !== 'completed' && 
        c.due_date && 
        new Date(c.due_date) < new Date()
      );

      const avgScore = completed.length > 0
        ? Math.round(completed.reduce((sum, c) => sum + (c.score || 0), 0) / completed.length)
        : 0;

      const userGaps = allSkillGaps.filter(g => 
        g.user_email === user.email && 
        (g.status === 'identified' || g.status === 'in_progress')
      );

      const completionRate = userCompletions.length > 0
        ? Math.round((completed.length / userCompletions.length) * 100)
        : 0;

      return {
        email: user.email,
        name: user.full_name || user.email.split('@')[0],
        role: user.credential_type || user.role,
        totalAssigned: userCompletions.length,
        completed: completed.length,
        inProgress: inProgress.length,
        overdue: overdue.length,
        avgScore,
        skillGaps: userGaps.length,
        completionRate,
        lastActivity: userCompletions[0]?.updated_date
      };
    });
  }, [users, allCompletions, allSkillGaps]);

  // Filter and sort
  const filteredStaff = useMemo(() => {
    let filtered = staffProgress;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(s => 
        s.name.toLowerCase().includes(query) ||
        s.email.toLowerCase().includes(query)
      );
    }

    // Status filter
    if (filterStatus === 'overdue') {
      filtered = filtered.filter(s => s.overdue > 0);
    } else if (filterStatus === 'active') {
      filtered = filtered.filter(s => s.inProgress > 0);
    } else if (filterStatus === 'completed') {
      filtered = filtered.filter(s => s.completionRate === 100);
    }

    // Sort
    switch (sortBy) {
      case 'name':
        filtered.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'overdue':
        filtered.sort((a, b) => b.overdue - a.overdue);
        break;
      case 'gaps':
        filtered.sort((a, b) => b.skillGaps - a.skillGaps);
        break;
      case 'completion':
      default:
        filtered.sort((a, b) => b.completionRate - a.completionRate);
        break;
    }

    return filtered;
  }, [staffProgress, searchQuery, filterStatus, sortBy]);

  // Overall stats
  const overallStats = useMemo(() => {
    const total = staffProgress.length;
    const avgCompletion = total > 0
      ? Math.round(staffProgress.reduce((sum, s) => sum + s.completionRate, 0) / total)
      : 0;
    const totalOverdue = staffProgress.reduce((sum, s) => sum + s.overdue, 0);
    const totalGaps = staffProgress.reduce((sum, s) => sum + s.skillGaps, 0);

    return { total, avgCompletion, totalOverdue, totalGaps };
  }, [staffProgress]);

  const getCompletionColor = (rate) => {
    if (rate >= 80) return 'text-green-600 bg-green-100 dark:bg-green-900 dark:text-green-300';
    if (rate >= 50) return 'text-amber-600 bg-amber-100 dark:bg-amber-900 dark:text-amber-300';
    return 'text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-300';
  };

  return (
    <div className="space-y-6">
      {/* Overall Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{overallStats.total}</p>
              <p className="text-xs text-slate-500">Total Staff</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-green-600 dark:text-green-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{overallStats.avgCompletion}%</p>
              <p className="text-xs text-slate-500">Avg Completion</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-red-100 dark:bg-red-900 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{overallStats.totalOverdue}</p>
              <p className="text-xs text-slate-500">Overdue Tasks</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-orange-600 dark:text-orange-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-600">{overallStats.totalGaps}</p>
              <p className="text-xs text-slate-500">Skill Gaps</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search staff by name or email..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <div className="flex gap-2">
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Staff</SelectItem>
                  <SelectItem value="overdue">Has Overdue</SelectItem>
                  <SelectItem value="active">In Progress</SelectItem>
                  <SelectItem value="completed">100% Complete</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[140px]">
                  <ArrowUpDown className="w-4 h-4 mr-2" />
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completion">Completion Rate</SelectItem>
                  <SelectItem value="name">Name A-Z</SelectItem>
                  <SelectItem value="overdue">Most Overdue</SelectItem>
                  <SelectItem value="gaps">Most Skill Gaps</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff List */}
      <Card>
        <CardHeader>
          <CardTitle>Staff Training Progress</CardTitle>
          <CardDescription>Monitor and manage training completion across your team</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {filteredStaff.map((staff) => (
              <div 
                key={staff.email} 
                className={`p-4 rounded-lg border ${
                  staff.overdue > 0 ? 'border-red-200 bg-red-50/50 dark:bg-red-950/30' : 
                  'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  {/* User Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {staff.name}
                      </h4>
                      {staff.role && (
                        <Badge variant="outline" className="text-xs">
                          {staff.role}
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-slate-500 truncate">{staff.email}</p>
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="text-center">
                      <p className="text-lg font-bold text-green-600">{staff.completed}</p>
                      <p className="text-xs text-slate-500">Completed</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-blue-600">{staff.inProgress}</p>
                      <p className="text-xs text-slate-500">In Progress</p>
                    </div>
                    {staff.overdue > 0 && (
                      <div className="text-center">
                        <p className="text-lg font-bold text-red-600">{staff.overdue}</p>
                        <p className="text-xs text-slate-500">Overdue</p>
                      </div>
                    )}
                    {staff.skillGaps > 0 && (
                      <div className="text-center">
                        <p className="text-lg font-bold text-orange-600">{staff.skillGaps}</p>
                        <p className="text-xs text-slate-500">Skill Gaps</p>
                      </div>
                    )}
                    <Badge className={`${getCompletionColor(staff.completionRate)} font-bold`}>
                      {staff.completionRate}%
                    </Badge>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Dialog open={assignDialogOpen && selectedUser === staff.email} onOpenChange={(open) => {
                      setAssignDialogOpen(open);
                      if (open) setSelectedUser(staff.email);
                    }}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline">
                          <UserPlus className="w-4 h-4 mr-1" />
                          Assign
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Assign Training to {staff.name}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4 pt-4">
                          <Select value={selectedModule} onValueChange={setSelectedModule}>
                            <SelectTrigger>
                              <SelectValue placeholder="Select a training module" />
                            </SelectTrigger>
                            <SelectContent>
                              {trainingModules.map(m => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button 
                            className="w-full"
                            disabled={!selectedModule || assignTrainingMutation.isPending}
                            onClick={() => assignTrainingMutation.mutate({ 
                              userEmail: staff.email, 
                              moduleId: selectedModule 
                            })}
                          >
                            <Send className="w-4 h-4 mr-2" />
                            Assign Training
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex justify-between text-xs text-slate-500 mb-1">
                    <span>Overall Progress</span>
                    <span>{staff.completed} of {staff.totalAssigned} modules</span>
                  </div>
                  <Progress value={staff.completionRate} className="h-2" />
                </div>
              </div>
            ))}
          </div>

          {filteredStaff.length === 0 && (
            <div className="py-12 text-center">
              <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600 dark:text-slate-400">No staff members match your filters.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}