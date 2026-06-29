import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { createPageUrl } from '@/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Calendar, CheckCircle2, Clock, AlertCircle, Award, BookOpen, Loader2 } from 'lucide-react';

export default function LearningPathProgress({ planId, userId }) {
    const { data: plan } = useQuery({
        queryKey: ['learning-plan', planId],
        queryFn: async () => {
            const plans = await base44.entities.LearningPlan.filter({ id: planId });
            return plans[0];
        },
        enabled: !!planId
    });

    const { data: planCourses = [] } = useQuery({
        queryKey: ['learning-plan-courses', planId],
        queryFn: () => base44.entities.LearningPlanCourse.filter({ plan_id: planId }, 'order_index', 100),
        enabled: !!planId,
        initialData: []
    });

    const { data: assignments = [] } = useQuery({
        queryKey: ['plan-assignments', planId, userId],
        queryFn: () => base44.entities.TrainingAssignment.filter({
            plan_id: planId,
            assigned_to_user_id: userId
        }, '-due_date', 100),
        enabled: !!planId && !!userId,
        initialData: []
    });

    const { data: certificates = [] } = useQuery({
        queryKey: ['plan-certificates', userId],
        queryFn: () => base44.entities.TrainingCertificate.filter({
            user_id: userId,
            annual_cycle_year: plan?.year
        }, '-issued_at', 100),
        enabled: !!userId && !!plan?.year,
        initialData: []
    });

    if (!plan) return (
        <div className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
        </div>
    );

    const completedAssignments = assignments.filter(a => a.status === 'completed');
    const completedCount = completedAssignments.length;
    // The denominator should reflect the work actually expected of this user.
    // Prefer the plan's defined courses; fall back to the number of assignments
    // when plan courses haven't loaded, and never let it understate the work the
    // user has already been assigned. Clamp to <= 100 so completed-but-extra
    // assignments can't push the bar past full.
    const totalCourses = Math.max(planCourses.length, assignments.length);
    const progressPercentage = totalCourses > 0
        ? Math.min(100, Math.round((completedCount / totalCourses) * 100))
        : 0;

    const now = new Date();
    const _upcomingDue = assignments
        .filter(a => a.due_date && a.status !== 'completed')
        .sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    const overdue = assignments.filter(a => 
        a.due_date && 
        new Date(a.due_date) < now && 
        a.status !== 'completed'
    );

    const formatDate = (dateString) => {
        if (!dateString) return 'No due date';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const getDaysUntil = (dateString) => {
        if (!dateString) return null;
        const days = Math.ceil((new Date(dateString) - now) / (1000 * 60 * 60 * 24));
        return days;
    };

    const getStatusBadge = (assignment) => {
        if (assignment.status === 'completed') {
            return <Badge className="bg-green-100 text-green-700 border-green-300">Completed</Badge>;
        }
        if (assignment.status === 'overdue' || (assignment.due_date && new Date(assignment.due_date) < now)) {
            return <Badge className="bg-red-100 text-red-700 border-red-300">Overdue</Badge>;
        }
        if (assignment.status === 'in_progress') {
            return <Badge className="bg-blue-100 text-blue-700 border-blue-300">In Progress</Badge>;
        }
        const daysUntil = getDaysUntil(assignment.due_date);
        if (daysUntil !== null && daysUntil <= 7) {
            return <Badge className="bg-amber-100 text-amber-700 border-amber-300">Due Soon</Badge>;
        }
        return <Badge variant="outline">Not Started</Badge>;
    };

    return (
        <div className="space-y-6">
            {/* Header Card */}
            <Card className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white border-0">
                <CardHeader>
                    <div className="flex items-start justify-between">
                        <div>
                            <CardTitle className="text-2xl mb-2">{plan.name}</CardTitle>
                            <p className="text-indigo-100 text-sm">{plan.description}</p>
                        </div>
                        <Award className="h-8 w-8 text-indigo-200" />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                            <span className="text-indigo-100">Overall Progress</span>
                            <span className="font-semibold">{completedCount} of {totalCourses} completed</span>
                        </div>
                        <Progress value={progressPercentage} className="h-3 bg-indigo-800" />
                        <div className="flex items-center gap-1 text-sm text-indigo-100">
                            <Calendar className="h-4 w-4" />
                            <span>Due by {formatDate(plan.global_due_date)}</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500">Completed</p>
                                <p className="text-2xl font-bold text-green-600">{completedCount}</p>
                            </div>
                            <CheckCircle2 className="h-8 w-8 text-green-500" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500">In Progress</p>
                                <p className="text-2xl font-bold text-blue-600">
                                    {assignments.filter(a => a.status === 'in_progress').length}
                                </p>
                            </div>
                            <BookOpen className="h-8 w-8 text-blue-500" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500">Overdue</p>
                                <p className="text-2xl font-bold text-red-600">{overdue.length}</p>
                            </div>
                            <AlertCircle className="h-8 w-8 text-red-500" />
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-sm text-slate-500">Certificates</p>
                                <p className="text-2xl font-bold text-amber-600">{certificates.length}</p>
                            </div>
                            <Award className="h-8 w-8 text-amber-500" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Course List */}
            <Card>
                <CardHeader>
                    <CardTitle>Course Progress</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {assignments.length === 0 ? (
                            <p className="text-center text-slate-500 py-8">No courses assigned yet</p>
                        ) : (
                            assignments.map((assignment) => {
                                const daysUntil = getDaysUntil(assignment.due_date);
                                return (
                                    <div key={assignment.id} className="border rounded-lg p-4 hover:bg-slate-50 transition-colors">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 mb-2">
                                                    <h3 className="font-semibold text-slate-900 truncate">
                                                        {assignment.course_title}
                                                    </h3>
                                                    {getStatusBadge(assignment)}
                                                </div>
                                                <div className="flex flex-wrap gap-3 text-sm text-slate-600">
                                                    <div className="flex items-center gap-1">
                                                        <Calendar className="h-4 w-4" />
                                                        <span>Due {formatDate(assignment.due_date)}</span>
                                                        {daysUntil !== null && daysUntil > 0 && (
                                                            <span className="text-slate-500">({daysUntil}d)</span>
                                                        )}
                                                    </div>
                                                    {assignment.score_percentage !== null && (
                                                        <div className="flex items-center gap-1">
                                                            <CheckCircle2 className="h-4 w-4" />
                                                            <span>Score: {assignment.score_percentage}%</span>
                                                        </div>
                                                    )}
                                                    {assignment.latest_attempt_number > 0 && (
                                                        <div className="flex items-center gap-1">
                                                            <Clock className="h-4 w-4" />
                                                            <span>Attempts: {assignment.latest_attempt_number}</span>
                                                        </div>
                                                    )}
                                                </div>
                                                {assignment.progress_percentage > 0 && assignment.status !== 'completed' && (
                                                    <div className="mt-2">
                                                        <Progress value={assignment.progress_percentage} className="h-2" />
                                                    </div>
                                                )}
                                            </div>
                                            <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${assignment.id}`}>
                                                <Button size="sm" variant={assignment.status === 'completed' ? 'outline' : 'default'}>
                                                    {assignment.status === 'completed' ? 'Review' : assignment.status === 'in_progress' ? 'Continue' : 'Start'}
                                                </Button>
                                            </Link>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}