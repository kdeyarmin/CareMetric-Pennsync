import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Award, BookOpen, CheckCircle2, RefreshCcw, TriangleAlert, Search, Filter } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import CertificateDownloadButton from "./CertificateDownloadButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useIsEmbedded } from "@/components/ui/embeddedPage";
import { Input } from "@/components/ui/input";
import LoadingState from "@/components/ui/LoadingState";
import RequiredTrainingSummary from "./RequiredTrainingSummary";

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";

export default function MyTrainingDashboard({ filterByType }) {
  const embedded = useIsEmbedded();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({ queryKey: ["my-training-assignments", currentUser?.email], queryFn: () => base44.entities.TrainingAssignment.filter({ assigned_to_user_id: currentUser?.email }, '-due_date', 300), enabled: !!currentUser?.email, initialData: [] });
  const { data: courses = [] } = useQuery({ queryKey: ["my-training-courses"], queryFn: () => base44.entities.TrainingCourse.list('-updated_date', 300), initialData: [] });
  const { data: attempts = [] } = useQuery({ queryKey: ["my-training-attempts", currentUser?.email], queryFn: () => base44.entities.TrainingAttempt.filter({ user_id: currentUser?.email }, '-submitted_at', 500), enabled: !!currentUser?.email, initialData: [] });
  const { data: certificates = [] } = useQuery({ queryKey: ["my-training-certificates", currentUser?.email], queryFn: () => base44.entities.TrainingCertificate.filter({ user_id: currentUser?.email }, '-issued_at', 200), enabled: !!currentUser?.email, initialData: [] });
  const { data: enrollments = [] } = useQuery({ queryKey: ["my-plan-enrollments", currentUser?.email], queryFn: () => base44.entities.PlanEnrollment.filter({ user_id: currentUser?.email }, '-enrolled_at', 100), enabled: !!currentUser?.email, initialData: [] });

  const courseMap = useMemo(() => Object.fromEntries(courses.map((course) => [course.id, course])), [courses]);
  const latestAttempts = useMemo(() => {
    const map = {};
    attempts.forEach((attempt) => {
      if (!map[attempt.assignment_id]) map[attempt.assignment_id] = [];
      map[attempt.assignment_id].push(attempt);
    });
    return map;
  }, [attempts]);

  // Filter by training type if specified (e.g. "in_service" for compliance tab)
  const typeFilteredAssignments = useMemo(() => {
    if (!filterByType) return assignments;
    return assignments.filter(a => {
      const course = courseMap[a.course_id];
      return course?.training_type === filterByType;
    });
  }, [assignments, filterByType, courseMap]);

  // Search + status filter
  const filteredAssignments = useMemo(() => {
    let filtered = typeFilteredAssignments;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(a =>
        a.course_title?.toLowerCase().includes(q) ||
        courseMap[a.course_id]?.category?.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== "all") {
      if (statusFilter === "active") {
        filtered = filtered.filter(a => ['assigned', 'in_progress', 'overdue'].includes(a.status));
      } else if (statusFilter === "completed") {
        filtered = filtered.filter(a => a.status === 'completed' || a.pass_fail_result === 'passed');
      } else if (statusFilter === "overdue") {
        filtered = filtered.filter(a => a.status === 'overdue');
      } else if (statusFilter === "failed") {
        filtered = filtered.filter(a => a.pass_fail_result === 'failed');
      }
    }
    return filtered;
  }, [typeFilteredAssignments, searchQuery, statusFilter, courseMap]);

  // Sort: overdue first, then in_progress, then assigned, then failed, then completed
  const sortedAssignments = useMemo(() => {
    const order = { overdue: 0, in_progress: 1, assigned: 2, failed: 3, completed: 4 };
    return [...filteredAssignments].sort((a, b) => (order[a.status] ?? 5) - (order[b.status] ?? 5));
  }, [filteredAssignments]);

  const stats = {
    assigned: typeFilteredAssignments.length,
    overdue: typeFilteredAssignments.filter((a) => a.status === 'overdue').length,
    passed: typeFilteredAssignments.filter((a) => a.pass_fail_result === 'passed').length,
    failed: typeFilteredAssignments.filter((a) => a.pass_fail_result === 'failed').length,
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {!embedded && (
        <div className="rounded-3xl bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-800 text-white p-5 sm:p-6 shadow-xl">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">
            {filterByType === 'in_service' ? 'Compliance In-Services' : 'My Training'}
          </h1>
          <p className="text-sm sm:text-base text-blue-100">
            {filterByType === 'in_service'
              ? 'Required compliance training, scores, and certification status.'
              : 'Assigned in-services, due dates, scores, certificates, and learning plan progress in one place.'}
          </p>
        </div>
      )}

      <RequiredTrainingSummary assignments={assignments} courseMap={courseMap} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Assigned', value: stats.assigned, icon: BookOpen, color: 'text-indigo-600' },
          { label: 'Overdue', value: stats.overdue, icon: TriangleAlert, color: 'text-red-600' },
          { label: 'Passed', value: stats.passed, icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Needs Retake', value: stats.failed, icon: RefreshCcw, color: 'text-amber-600' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="p-4 sm:p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs sm:text-sm text-slate-500">{item.label}</p>
                  <p className={`text-2xl sm:text-3xl font-bold ${item.color}`}>{item.value}</p>
                </div>
                <Icon className={`w-7 h-7 sm:w-8 sm:h-8 ${item.color} opacity-60`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="assignments" className="space-y-6">
        <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
        <TabsList className="inline-flex min-w-full gap-1 h-auto p-1">
          <TabsTrigger value="assignments" className="min-h-[44px] px-3 sm:px-4 text-xs sm:text-sm whitespace-nowrap">Assigned In-Services</TabsTrigger>
          <TabsTrigger value="plans" className="min-h-[44px] px-3 sm:px-4 text-xs sm:text-sm whitespace-nowrap">Learning Plans</TabsTrigger>
          <TabsTrigger value="transcript" className="min-h-[44px] px-3 sm:px-4 text-xs sm:text-sm whitespace-nowrap">Transcript & Certificates</TabsTrigger>
        </TabsList>
        </div>

        <TabsContent value="assignments" className="space-y-4">
          {/* Search & Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input
                placeholder="Search courses..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active Only</option>
                <option value="overdue">Overdue</option>
                <option value="completed">Completed</option>
                <option value="failed">Needs Retake</option>
              </select>
            </div>
          </div>

          {loadingAssignments ? (
            <LoadingState />
          ) : sortedAssignments.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                {searchQuery || statusFilter !== "all" ? (
                  <>
                    <Search className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-500">No courses match your search or filter. Try adjusting your criteria.</p>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <p className="font-semibold text-slate-700">No in-services assigned yet</p>
                    <p className="text-sm text-slate-500 mt-1">Check back later or visit the Learning Center to browse available courses.</p>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <>
              {(searchQuery || statusFilter !== "all") && (
                <p className="text-sm text-slate-500">
                  Showing {sortedAssignments.length} of {typeFilteredAssignments.length} courses
                </p>
              )}
              {sortedAssignments.map((assignment) => {
                const course = courseMap[assignment.course_id] || {};
                const attemptsForAssignment = latestAttempts[assignment.id] || [];
                const isOverdue = assignment.status === 'overdue';
                const isPassed = assignment.pass_fail_result === 'passed';
                const isFailed = assignment.pass_fail_result === 'failed';
                const isInProgress = assignment.status === 'in_progress';

                return (
                  <Card key={assignment.id} className={`border shadow-sm transition-all hover:shadow-md ${
                    isOverdue ? 'border-red-200 bg-red-50/30' :
                    isPassed ? 'border-emerald-200 bg-emerald-50/20' :
                    isInProgress ? 'border-blue-200 bg-blue-50/20' :
                    'border-slate-200'
                  }`}>
                    <CardContent className="p-4 sm:p-5">
                      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                        <div className="space-y-2 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-bold text-slate-900">{assignment.course_title}</h2>
                            <Badge variant="outline" className="text-xs">{course.category?.replace(/_/g,' ') || 'course'}</Badge>
                            {isOverdue && <Badge className="bg-red-100 text-red-700 border-red-200">⚠ Overdue</Badge>}
                            {isPassed && <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">✓ Passed</Badge>}
                            {isFailed && <Badge className="bg-red-100 text-red-700">Retake Required</Badge>}
                            {isInProgress && !isPassed && !isFailed && <Badge className="bg-blue-100 text-blue-700">In Progress</Badge>}
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm text-slate-600">
                            <div><span className="text-slate-400">Due:</span> <span className="font-medium">{formatDate(assignment.due_date)}</span></div>
                            <div><span className="text-slate-400">Time:</span> <span className="font-medium">{course.estimated_minutes || '—'} min</span></div>
                            <div><span className="text-slate-400">Score:</span> <span className="font-medium">{assignment.score_percentage != null ? `${assignment.score_percentage}%` : '—'}</span></div>
                            <div><span className="text-slate-400">Attempts:</span> <span className="font-medium">{assignment.latest_attempt_number || attemptsForAssignment.length || 0}</span></div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Progress value={isPassed ? 100 : assignment.progress_percentage || 0} className={`h-1.5 flex-1 ${isPassed ? '[&>div]:bg-emerald-500' : ''}`} />
                            <span className="text-xs text-slate-400 flex-shrink-0">{isPassed ? '100' : assignment.progress_percentage || 0}%</span>
                          </div>
                        </div>

                        <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${assignment.id}`} className="lg:w-48 flex-shrink-0">
                          <Button className={`w-full ${
                            isPassed ? 'bg-slate-600 hover:bg-slate-700' :
                            isOverdue ? 'bg-red-600 hover:bg-red-700' :
                            ''
                          }`}>
                            {isPassed ? '✓ Review Course' : isInProgress ? '▶ Continue' : isFailed ? '↻ Retake' : '▶ Start Course'}
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </>
          )}
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          {enrollments.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No learning plans assigned</p>
                <p className="text-sm text-slate-500 mt-1">Learning plans will appear here when assigned by your administrator.</p>
              </CardContent>
            </Card>
          ) : (
            enrollments.map((enrollment) => {
              const overdue = enrollment.status === 'overdue' || (enrollment.due_date && new Date(enrollment.due_date) < new Date() && enrollment.status !== 'completed');
              return (
                <Card key={enrollment.id} className={`border transition-all hover:shadow-md ${overdue ? 'border-red-200 bg-red-50/20' : ''}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{enrollment.plan_name}</CardTitle>
                      <Badge className={overdue ? 'bg-red-100 text-red-800' : enrollment.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-blue-100 text-blue-800'}>
                        {overdue ? 'Overdue' : enrollment.status || 'Active'}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm text-slate-600">
                      <span>{enrollment.courses_completed || 0}/{enrollment.courses_total || 0} completed</span>
                      <span>Due {formatDate(enrollment.due_date)}</span>
                    </div>
                    <Progress value={enrollment.progress_percentage || 0} className="h-2" />
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="transcript" className="space-y-4">
          <div className="flex justify-end"><Link to={createPageUrl('EmployeeTranscript')}><Button variant="outline">Open full transcript page</Button></Link></div>
          {certificates.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <Award className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No certificates available yet</p>
                <p className="text-sm text-slate-500 mt-1">Complete courses to earn certificates that will appear here.</p>
              </CardContent>
            </Card>
          ) : (
            certificates.map((certificate) => (
              <Card key={certificate.id} className="border transition-all hover:shadow-md">
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Award className="w-5 h-5 text-amber-500 flex-shrink-0" />
                      <h3 className="font-semibold text-slate-900 truncate">{certificate.course_title}</h3>
                    </div>
                    <p className="text-sm text-slate-500">
                      Completed {formatDate(certificate.completion_date || certificate.issued_at)}
                      {certificate.score != null && <> &middot; Score {certificate.score}%</>}
                    </p>
                    {certificate.certificate_id && (
                      <p className="text-sm text-slate-500">Certificate ID: {certificate.certificate_id}</p>
                    )}
                    {certificate.expiration_date && (
                      <p className={`text-sm ${
                        new Date(certificate.expiration_date) < new Date() ? 'text-red-600 font-semibold' : 'text-slate-500'
                      }`}>
                        {new Date(certificate.expiration_date) < new Date() ? 'Expired' : 'Valid until'}: {formatDate(certificate.expiration_date)}
                      </p>
                    )}
                  </div>
                  <CertificateDownloadButton certificate={certificate} />
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
