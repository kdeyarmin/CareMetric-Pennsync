import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Award, Printer, CheckCircle2, AlertTriangle, BookOpen, RefreshCcw } from "lucide-react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { generateTrainingCertificate } from "@/functions/generateTrainingCertificate";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import LoadingState from "@/components/ui/LoadingState";
import LearningPathProgress from "./LearningPathProgress";
import { HideWhenEmbedded } from "@/components/ui/embeddedPage";

const formatDate = (value) => value ? new Date(value).toLocaleDateString() : "—";

export default function MyAnnualEducationDashboard() {
  const currentYear = new Date().getFullYear();
  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: assignments = [], isLoading: loadingAssignments } = useQuery({
    queryKey: ["my-annual-assignments", currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.TrainingAssignment.filter({ assigned_to_user_id: currentUser?.email }, '-due_date', 500);
      return all.filter((assignment) => assignment.annual_cycle_year === currentYear);
    },
    enabled: !!currentUser?.email,
    initialData: []
  });
  const { data: courses = [] } = useQuery({
    queryKey: ["annual-courses"],
    queryFn: async () => {
      const all = await base44.entities.TrainingCourse.list('-updated_date', 500);
      return all.filter((course) => course.training_type === 'annual_mandatory');
    },
    initialData: []
  });
  const { data: certificates = [] } = useQuery({
    queryKey: ["annual-certificates", currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.TrainingCertificate.filter({ user_id: currentUser?.email }, '-issued_at', 300);
      return all.filter((certificate) => certificate.annual_cycle_year === currentYear);
    },
    enabled: !!currentUser?.email,
    initialData: []
  });
  const { data: enrollments = [] } = useQuery({
    queryKey: ["annual-plan-enrollments", currentUser?.email],
    queryFn: async () => {
      const all = await base44.entities.PlanEnrollment.filter({ user_id: currentUser?.email }, '-enrolled_at', 100);
      return all.filter((enrollment) => enrollment.plan_name?.includes(String(currentYear)) || enrollment.status);
    },
    enabled: !!currentUser?.email,
    initialData: []
  });

  const courseMap = useMemo(() => Object.fromEntries(courses.map((course) => [course.id, course])), [courses]);
  const stats = {
    assigned: assignments.length,
    completed: assignments.filter((a) => a.status === 'completed').length,
    overdue: assignments.filter((a) => a.status === 'overdue').length,
    failed: assignments.filter((a) => a.pass_fail_result === 'failed').length,
  };

  const certificateBlobUrl = async (certificate) => {
    const response = await generateTrainingCertificate({
      moduleName: certificate.course_title,
      completionDate: certificate.completion_date || certificate.issued_at,
      score: certificate.score
    });
    const blob = new Blob([response.data], { type: 'application/pdf' });
    return window.URL.createObjectURL(blob);
  };

  const printCertificate = async (certificate) => {
    const url = await certificateBlobUrl(certificate);
    const printWindow = window.open(url, '_blank');
    setTimeout(() => printWindow?.print(), 600);
  };

  const downloadCertificate = async (certificate) => {
    const url = await certificateBlobUrl(certificate);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${certificate.course_title.replace(/\s+/g, '_')}_annual_certificate.pdf`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <HideWhenEmbedded>
        <div className="rounded-3xl bg-gradient-to-r from-slate-900 via-blue-800 to-indigo-700 text-white p-6 shadow-xl">
          <h1 className="text-2xl sm:text-3xl font-bold mb-2">My Annual Education — {currentYear}</h1>
          <p className="text-blue-100">Track required yearly education, annual bundles, scores, certificates, and renewal dates.</p>
        </div>
      </HideWhenEmbedded>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Assigned', value: stats.assigned, icon: BookOpen, color: 'text-indigo-600' },
          { label: 'Completed', value: stats.completed, icon: CheckCircle2, color: 'text-emerald-600' },
          { label: 'Overdue', value: stats.overdue, icon: AlertTriangle, color: 'text-red-600' },
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

      {/* Overall annual progress */}
      {assignments.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-slate-700">Annual Completion</span>
              <span className="text-sm font-bold text-indigo-600">
                {stats.completed}/{stats.assigned} ({stats.assigned > 0 ? Math.round((stats.completed / stats.assigned) * 100) : 0}%)
              </span>
            </div>
            <Progress value={stats.assigned > 0 ? (stats.completed / stats.assigned) * 100 : 0} className="h-2.5 [&>div]:bg-indigo-600" />
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="assignments" className="space-y-6">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="assignments" className="min-h-[40px]">My Annual Modules</TabsTrigger>
          <TabsTrigger value="plans" className="min-h-[40px]">Annual Learning Plans</TabsTrigger>
          <TabsTrigger value="transcript" className="min-h-[40px]">Annual Transcript</TabsTrigger>
        </TabsList>

        <TabsContent value="assignments" className="space-y-4">
          {loadingAssignments ? (
            <LoadingState />
          ) : assignments.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No annual education assigned for {currentYear}</p>
                <p className="text-sm text-slate-500 mt-1">Annual education modules will appear here when assigned.</p>
              </CardContent>
            </Card>
          ) : (
            assignments.map((assignment) => {
              const course = courseMap[assignment.course_id] || {};
              const isOverdue = assignment.status === 'overdue';
              const isCompleted = assignment.status === 'completed';
              const isFailed = assignment.pass_fail_result === 'failed';
              return (
                <Card key={assignment.id} className={`border transition-all hover:shadow-md ${
                  isOverdue ? 'border-red-200 bg-red-50/30' :
                  isCompleted ? 'border-emerald-200 bg-emerald-50/20' :
                  'border-slate-200'
                }`}>
                  <CardContent className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="space-y-2 min-w-0 flex-1">
                      <div className="flex flex-wrap gap-2 items-center">
                        <h2 className="text-base sm:text-lg font-semibold text-slate-900">{assignment.course_title}</h2>
                        <Badge variant="outline" className="text-xs">{course.business_line_scope || 'all'}</Badge>
                        <Badge className={
                          isCompleted ? 'bg-emerald-100 text-emerald-800' :
                          isOverdue ? 'bg-red-100 text-red-800' :
                          isFailed ? 'bg-red-100 text-red-700' :
                          'bg-blue-100 text-blue-800'
                        }>
                          {isFailed ? 'Retake Required' : assignment.status}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-500">{course.employee_audience || assignment.assigned_to_role || 'employee audience'}</p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm text-slate-600">
                        <div><span className="text-slate-400">Due:</span> <span className="font-medium">{formatDate(assignment.due_date)}</span></div>
                        <div><span className="text-slate-400">Time:</span> <span className="font-medium">{course.estimated_minutes || '—'} min</span></div>
                        <div><span className="text-slate-400">Score:</span> <span className="font-medium">{assignment.score_percentage != null ? `${assignment.score_percentage}%` : '—'}</span></div>
                        <div><span className="text-slate-400">Passing:</span> <span className="font-medium">{assignment.passing_score_required || 80}%</span></div>
                        <div><span className="text-slate-400">Attempts:</span> <span className="font-medium">{assignment.latest_attempt_number || 0}</span></div>
                        <div><span className="text-slate-400">Renewal:</span> <span className="font-medium">{formatDate(assignment.renewal_due_date)}</span></div>
                      </div>
                      <Progress value={isCompleted ? 100 : assignment.progress_percentage || 0} className={`h-1.5 ${isCompleted ? '[&>div]:bg-emerald-500' : ''}`} />
                    </div>
                    <div className="lg:w-48 flex-shrink-0">
                      <Link to={`${createPageUrl('TrainingCoursePlayer')}?assignment=${assignment.id}`}>
                        <Button className={`w-full ${
                          isCompleted ? 'bg-slate-600 hover:bg-slate-700' :
                          isOverdue ? 'bg-red-600 hover:bg-red-700' : ''
                        }`}>
                          {isCompleted ? 'Review' : isFailed ? 'Retake' : assignment.status === 'in_progress' ? 'Continue' : 'Start'}
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        <TabsContent value="plans" className="space-y-4">
          {enrollments.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <BookOpen className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No annual learning plans assigned</p>
                <p className="text-sm text-slate-500 mt-1">Learning plans will appear here when assigned by your administrator.</p>
              </CardContent>
            </Card>
          ) : (
            enrollments.map((enrollment) => (
              <LearningPathProgress
                key={enrollment.id}
                planId={enrollment.plan_id}
                userId={currentUser?.email}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="transcript" className="space-y-4">
          <div className="flex justify-end"><Link to={createPageUrl('AnnualEducationTranscript')}><Button variant="outline">Open full annual transcript</Button></Link></div>
          {certificates.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <Award className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">No annual certificates available yet</p>
                <p className="text-sm text-slate-500 mt-1">Complete annual education modules to earn certificates.</p>
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
                      <p className="text-xs text-slate-400">Certificate ID: {certificate.certificate_id}</p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" onClick={() => printCertificate(certificate)}><Printer className="w-4 h-4 mr-2" />Print</Button>
                    <Button variant="outline" onClick={() => downloadCertificate(certificate)}>Download PDF</Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
