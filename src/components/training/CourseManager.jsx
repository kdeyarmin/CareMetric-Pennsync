import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Plus, Edit2, Trash2, BookOpen, Eye, BarChart3, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import CourseForm from "./CourseForm";
import CourseLessonBuilder from "./CourseLessonBuilder";
import CourseQuizBuilder from "./CourseQuizBuilder";
import CourseAssignDialog from "./CourseAssignDialog";
import AICourseGenerator from "./AICourseGenerator";
import { createPageUrl } from "@/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// Server-managed fields that must not be copied when duplicating an entity —
// the backend assigns fresh values (and published/approved state should reset).
const SYSTEM_FIELDS = [
  "id", "created_date", "updated_date", "created_by",
  "published_by", "published_date", "approved_by", "approved_at",
];
const stripSystem = (obj) => {
  const clone = { ...obj };
  SYSTEM_FIELDS.forEach((key) => delete clone[key]);
  return clone;
};

export default function CourseManager() {
  // builderCourse holds the course currently open in the builder. It starts null
  // for a brand-new course and is replaced with the saved record (carrying an id)
  // once the Details tab is saved — which is what unlocks the Lessons/Quiz tabs.
  const [builderCourse, setBuilderCourse] = useState(null);
  const [builderTab, setBuilderTab] = useState("details");
  const [showForm, setShowForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [businessLineFilter, setBusinessLineFilter] = useState('all');
  const queryClient = useQueryClient();

  const { data: allCourses = [] } = useQuery({
    queryKey: ['training-courses'],
    queryFn: () => base44.entities.TrainingCourse.list('-created_date', 100),
    initialData: [],
  });

  // One pass over assignments powers the per-course completion widget below,
  // instead of a query per card.
  const { data: assignments = [] } = useQuery({
    queryKey: ['course-manager-assignments'],
    queryFn: () => base44.entities.TrainingAssignment.list('-created_date', 5000),
    initialData: [],
  });

  const statsByCourse = useMemo(() => {
    const map = {};
    assignments.forEach((a) => {
      if (!a.course_id) return;
      const s = map[a.course_id] || { enrolled: 0, completed: 0, overdue: 0, passed: 0, graded: 0 };
      s.enrolled += 1;
      const isCompleted = a.status === 'completed' || a.pass_fail_result === 'passed';
      if (isCompleted) s.completed += 1;
      if (a.status === 'overdue') s.overdue += 1;
      if (a.pass_fail_result === 'passed' || a.pass_fail_result === 'failed') {
        s.graded += 1;
        if (a.pass_fail_result === 'passed') s.passed += 1;
      }
      map[a.course_id] = s;
    });
    return map;
  }, [assignments]);

  const courses = allCourses.filter(course => {
    if (categoryFilter !== 'all' && course.category !== categoryFilter) return false;
    if (statusFilter !== 'all' && course.status !== statusFilter) return false;
    if (businessLineFilter !== 'all' && course.business_line_scope !== businessLineFilter) return false;
    return true;
  });

  const deleteMutation = useMutation({
    mutationFn: (courseId) => base44.entities.TrainingCourse.delete(courseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-courses'] });
    },
  });

  // Deep-copy a course together with its lessons and quiz questions. The copy
  // lands as a draft so it never appears to learners until an admin publishes it.
  const duplicateMutation = useMutation({
    mutationFn: async (course) => {
      const newCourse = await base44.entities.TrainingCourse.create({
        ...stripSystem(course),
        title: `${course.title} (Copy)`,
        status: 'draft',
      });
      const newId = newCourse?.id;
      if (!newId) throw new Error('Failed to create the duplicated course.');

      const [modules, questions] = await Promise.all([
        base44.entities.TrainingModule.filter({ course_id: course.id }, 'order_index', 200),
        base44.entities.TrainingQuestion.filter({ course_id: course.id }, 'order_index', 500),
      ]);

      await Promise.all([
        ...modules.map((m) => base44.entities.TrainingModule.create({ ...stripSystem(m), course_id: newId })),
        ...questions.map((q) => base44.entities.TrainingQuestion.create({ ...stripSystem(q), course_id: newId })),
      ]);
      return newCourse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['training-courses'] });
      queryClient.invalidateQueries({ queryKey: ['course-manager-assignments'] });
      toast.success('Course duplicated as a draft.');
    },
    onError: (err) => {
      console.error('Course duplication error:', err);
      toast.error('Could not duplicate the course. Some content may not have copied — please review the draft.');
    },
  });

  const openBuilder = (course) => {
    setBuilderCourse(course);
    setBuilderTab("details");
    setShowForm(true);
  };

  // After AI generation, refresh the list and open the new draft in the builder
  // so the admin reviews the generated lessons/quiz before publishing.
  const handleGenerated = async (courseId) => {
    await queryClient.invalidateQueries({ queryKey: ['training-courses'] });
    queryClient.invalidateQueries({ queryKey: ['course-manager-assignments'] });
    try {
      const rows = await base44.entities.TrainingCourse.filter({ id: courseId });
      if (rows[0]) openBuilder(rows[0]);
    } catch (err) {
      // The course is already in the list; opening the builder is best-effort.
      console.error('Could not open generated course:', err);
    }
  };

  const closeBuilder = () => {
    setShowForm(false);
    setBuilderCourse(null);
    setBuilderTab("details");
  };

  const getCategoryColor = (category) => {
    const colors = {
      compliance: 'bg-blue-100 text-blue-800',
      clinical: 'bg-green-100 text-green-800',
      safety: 'bg-yellow-100 text-yellow-800',
      documentation: 'bg-navy-100 text-navy-800',
      onboarding: 'bg-indigo-100 text-indigo-800',
      leadership: 'bg-red-100 text-red-800',
    };
    return colors[category] || 'bg-slate-100 text-slate-800';
  };

  const hasCourseId = !!builderCourse?.id;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-xl font-bold">Training Courses</h2>
        <div className="flex flex-wrap gap-2">
          <AICourseGenerator onGenerated={handleGenerated} />
          <Button onClick={() => openBuilder(null)}>
            <Plus className="w-4 h-4 mr-2" />
            Add Course
          </Button>
        </div>
        <Dialog open={showForm} onOpenChange={(next) => (next ? setShowForm(true) : closeBuilder())}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="bg-white rounded-2xl">
              <DialogHeader>
                <DialogTitle>{builderCourse ? `Edit: ${builderCourse.title}` : 'Create New Course'}</DialogTitle>
              </DialogHeader>
              <Tabs value={builderTab} onValueChange={setBuilderTab} className="mt-4">
                <TabsList>
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="lessons" disabled={!hasCourseId}>Lessons</TabsTrigger>
                  <TabsTrigger value="quiz" disabled={!hasCourseId}>Quiz</TabsTrigger>
                </TabsList>

                <TabsContent value="details" className="mt-4">
                  <CourseForm
                    course={builderCourse}
                    onSuccess={(saved) => {
                      setBuilderCourse(saved);
                      queryClient.invalidateQueries({ queryKey: ['training-courses'] });
                      // Nudge the admin toward lesson authoring for a fresh course.
                      if (saved?.id && !hasCourseId) setBuilderTab("lessons");
                    }}
                  />
                  {!hasCourseId && (
                    <p className="text-xs text-slate-400 mt-3">
                      Save the details to unlock the Lessons and Quiz tabs.
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="lessons" className="mt-4">
                  <CourseLessonBuilder courseId={builderCourse?.id} courseCategory={builderCourse?.category} />
                </TabsContent>

                <TabsContent value="quiz" className="mt-4">
                  <CourseQuizBuilder courseId={builderCourse?.id} />
                </TabsContent>
              </Tabs>

              <div className="flex justify-end pt-4">
                <Button variant="outline" onClick={closeBuilder}>Done</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-category-filter" className="text-sm font-medium text-slate-700 mb-2 block">Category</label>
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger id="course-category-filter">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="clinical">Clinical</SelectItem>
                  <SelectItem value="safety">Safety</SelectItem>
                  <SelectItem value="documentation">Documentation</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="dme">DME</SelectItem>
                  <SelectItem value="onboarding">Onboarding</SelectItem>
                  <SelectItem value="leadership">Leadership</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-status-filter" className="text-sm font-medium text-slate-700 mb-2 block">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger id="course-status-filter">
                  <SelectValue placeholder="All Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="pending_review">Pending Review</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="course-business-line-filter" className="text-sm font-medium text-slate-700 mb-2 block">Business Line</label>
              <Select value={businessLineFilter} onValueChange={setBusinessLineFilter}>
                <SelectTrigger id="course-business-line-filter">
                  <SelectValue placeholder="All Business Lines" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Business Lines</SelectItem>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 text-sm text-slate-600">
            Showing {courses.length} of {allCourses.length} courses
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {courses.length > 0 ? (
          courses.map((course) => {
            const stats = statsByCourse[course.id] || { enrolled: 0, completed: 0, overdue: 0, passed: 0, graded: 0 };
            const completionRate = stats.enrolled > 0 ? Math.round((stats.completed / stats.enrolled) * 100) : 0;
            const passRate = stats.graded > 0 ? Math.round((stats.passed / stats.graded) * 100) : null;
            return (
              <Card key={course.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{course.title}</CardTitle>
                      <Badge className={`mt-2 ${getCategoryColor(course.category)}`}>
                        {course.category}
                      </Badge>
                    </div>
                    <Badge className={course.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-800'}>
                      {course.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 text-sm mb-4">
                    <p><span className="text-slate-600">Estimated Time:</span> {course.estimated_minutes} mins</p>
                    <p><span className="text-slate-600">Passing Score:</span> {course.passing_score}%</p>
                    <p><span className="text-slate-600">Required:</span> {course.is_mandatory ? 'Yes' : 'No'}</p>
                  </div>

                  {/* Per-course completion snapshot */}
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <BarChart3 className="w-3.5 h-3.5" /> Completion
                      </span>
                      <Link
                        to={`${createPageUrl('LearningReports')}?tab=roster&course=${course.id}`}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        View roster
                      </Link>
                    </div>
                    {stats.enrolled === 0 ? (
                      <p className="text-xs text-slate-400">No enrollments yet.</p>
                    ) : (
                      <>
                        <Progress value={completionRate} className="h-2" />
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
                          <span>{stats.enrolled} enrolled</span>
                          <span className="text-emerald-600">{stats.completed} completed ({completionRate}%)</span>
                          {stats.overdue > 0 && <span className="text-red-600">{stats.overdue} overdue</span>}
                          {passRate != null && <span>{passRate}% pass rate</span>}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Link to={`${createPageUrl('TrainingCoursePlayer')}?courseId=${course.id}&preview=true`}>
                      <Button variant="outline" size="sm">
                        <Eye className="w-4 h-4 mr-1" />
                        Preview
                      </Button>
                    </Link>
                    <CourseAssignDialog course={course} />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openBuilder(course)}
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Duplicate course"
                      disabled={duplicateMutation.isPending && duplicateMutation.variables?.id === course.id}
                      onClick={() => duplicateMutation.mutate(course)}
                    >
                      {duplicateMutation.isPending && duplicateMutation.variables?.id === course.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          <Trash2 className="w-4 h-4 text-red-600" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Course</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete &ldquo;{course.title}&rdquo;? This action cannot be undone and will remove all associated modules and questions.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-red-600 hover:bg-red-700"
                            onClick={() => deleteMutation.mutate(course.id)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <Card className="col-span-full">
            <CardContent className="py-12 text-center">
              <BookOpen className="w-12 h-12 mx-auto mb-3 text-slate-300" />
              <p className="text-slate-600">No courses yet. Create your first course!</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
