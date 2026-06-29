import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, Target, X, Edit2, ShieldCheck, Loader2, Search, ArrowUp, ArrowDown,
  Users, Send, CalendarClock, BookOpen, CheckCircle2, AlertTriangle, Bell,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ui/confirm-dialog";
import LearningPlanForm from "./LearningPlanForm";
import AssignmentWizard from "./AssignmentWizard";
import { seedYearlyRequiredInServices } from "@/functions/seedYearlyRequiredInServices";
import { assignAnnualLearningPlan } from "@/functions/assignAnnualLearningPlan";
import { remindPlanOverdueStaff } from "@/functions/remindPlanOverdueStaff";

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "—");

export default function LearningPlanManager() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const year = new Date().getFullYear();

  const [selectedPlan, setSelectedPlan] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showCourseDialog, setShowCourseDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [courseSearch, setCourseSearch] = useState("");
  const [seeding, setSeeding] = useState(false);
  const [assignDueDate, setAssignDueDate] = useState("");
  const [pendingAssignTarget, setPendingAssignTarget] = useState(null);
  const [assigning, setAssigning] = useState(false);
  const [reminding, setReminding] = useState(false);

  const { data: plans = [] } = useQuery({
    queryKey: ["learning-plans"],
    queryFn: () => base44.entities.LearningPlan.list("-created_date", 50),
    initialData: [],
  });

  const { data: planCourses = [] } = useQuery({
    queryKey: ["plan-courses", selectedPlan?.id],
    queryFn: () =>
      selectedPlan
        ? base44.entities.LearningPlanCourse.filter({ plan_id: selectedPlan.id }, "order_index", 200)
        : Promise.resolve([]),
    initialData: [],
    enabled: !!selectedPlan,
  });

  const { data: allCourses = [] } = useQuery({
    queryKey: ["all-published-courses"],
    queryFn: () => base44.entities.TrainingCourse.filter({ status: "published" }, "-updated_date", 500),
    initialData: [],
  });

  const { data: planEnrollments = [] } = useQuery({
    queryKey: ["plan-enrollments-rollup", selectedPlan?.id],
    queryFn: () =>
      selectedPlan
        ? base44.entities.PlanEnrollment.filter({ plan_id: selectedPlan.id }, "-enrolled_at", 500)
        : Promise.resolve([]),
    initialData: [],
    enabled: !!selectedPlan,
  });

  // Overdue is derived from the plan's assignments (not enrollment status):
  // a per-course "Due by" date can lapse while the plan-level enrollment due
  // date has not, and the overdue job flags the assignment, not the enrollment.
  const { data: planAssignments = [] } = useQuery({
    queryKey: ["plan-assignments-rollup", selectedPlan?.id],
    queryFn: () =>
      selectedPlan
        ? base44.entities.TrainingAssignment.filter({ plan_id: selectedPlan.id }, "-due_date", 2000)
        : Promise.resolve([]),
    initialData: [],
    enabled: !!selectedPlan,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["plan-assign-users"],
    queryFn: () => base44.entities.User.list("-created_date", 500),
    initialData: [],
    enabled: showAssignDialog,
  });

  const courseMap = useMemo(
    () => Object.fromEntries(allCourses.map((course) => [course.id, course])),
    [allCourses]
  );

  const usedCourseIds = useMemo(() => new Set(planCourses.map((pc) => pc.course_id)), [planCourses]);
  const availableCourses = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    return allCourses
      .filter((c) => !usedCourseIds.has(c.id))
      .filter((c) =>
        !q ||
        c.title?.toLowerCase().includes(q) ||
        c.category?.toLowerCase().includes(q)
      );
  }, [allCourses, usedCourseIds, courseSearch]);

  const planStats = useMemo(() => {
    const totalMinutes = planCourses.reduce(
      (sum, pc) => sum + (courseMap[pc.course_id]?.estimated_minutes || 0),
      0
    );
    const requiredCount = planCourses.filter((pc) => pc.is_required !== false).length;
    return { totalMinutes, requiredCount };
  }, [planCourses, courseMap]);

  const enrollmentStats = useMemo(() => {
    const total = planEnrollments.length;
    const completed = planEnrollments.filter((e) => e.status === "completed").length;
    const avgProgress = total
      ? Math.round(planEnrollments.reduce((sum, e) => sum + (e.progress_percentage || 0), 0) / total)
      : 0;
    return { total, completed, avgProgress };
  }, [planEnrollments]);

  // Distinct staff with at least one overdue, still-incomplete assignment —
  // this is exactly who remindPlanOverdueStaff would notify.
  const overdueUserCount = useMemo(() => {
    const now = new Date();
    const users = new Set();
    for (const a of planAssignments) {
      const overdue =
        a.status !== "completed" &&
        a.pass_fail_result !== "passed" &&
        (a.status === "overdue" || (a.due_date && new Date(a.due_date) < now));
      if (overdue && a.assigned_to_user_id) users.add(a.assigned_to_user_id);
    }
    return users.size;
  }, [planAssignments]);

  // ─── Mutations ──────────────────────────────────────────────────────────────
  const refetchPlans = () => queryClient.invalidateQueries({ queryKey: ["learning-plans"] });
  const refetchCourses = () => queryClient.invalidateQueries({ queryKey: ["plan-courses"] });

  const deletePlanMutation = useMutation({
    mutationFn: (planId) => base44.entities.LearningPlan.delete(planId),
    onSuccess: () => {
      refetchPlans();
      setSelectedPlan(null);
      toast.success("Learning plan deleted");
    },
    onError: (e) => toast.error(`Could not delete plan: ${e.message}`),
  });

  const addCourseMutation = useMutation({
    mutationFn: (course) =>
      base44.entities.LearningPlanCourse.create({
        plan_id: selectedPlan.id,
        course_id: course.id,
        course_title: course.title,
        // One past the current max — stays unique even after a mid-list removal
        // left gaps in the index sequence (length would collide).
        order_index: planCourses.reduce((max, pc) => Math.max(max, pc.order_index ?? -1), -1) + 1,
        is_required: true,
      }),
    onSuccess: () => refetchCourses(),
    onError: (e) => toast.error(`Could not add course: ${e.message}`),
  });

  const updateCourseMutation = useMutation({
    mutationFn: ({ id, patch }) => base44.entities.LearningPlanCourse.update(id, patch),
    onSuccess: () => refetchCourses(),
    onError: (e) => toast.error(`Could not update course: ${e.message}`),
  });

  const removeCourseMutation = useMutation({
    mutationFn: (planCourseId) => base44.entities.LearningPlanCourse.delete(planCourseId),
    onSuccess: () => refetchCourses(),
    onError: (e) => toast.error(`Could not remove course: ${e.message}`),
  });

  const seedRequiredPlans = async () => {
    setSeeding(true);
    try {
      const res = await seedYearlyRequiredInServices({});
      const data = res?.data || res;
      const newCourses = data?.created_courses?.length || 0;
      const newPlans = data?.created_plans?.length || 0;
      toast.success(
        `${year} required in-services ready — ${newCourses} new course${newCourses === 1 ? "" : "s"}, ` +
          `${newPlans} new plan${newPlans === 1 ? "" : "s"} created.`
      );
      refetchPlans();
    } catch (e) {
      toast.error(`Could not build required plans: ${e.message}`);
    } finally {
      setSeeding(false);
    }
  };

  const handleDeletePlan = async (plan) => {
    const ok = await confirm({
      title: `Delete "${plan.name}"?`,
      description:
        "This removes the plan and its course list. Staff already enrolled keep their assignments. This cannot be undone.",
      confirmText: "Delete plan",
      destructive: true,
    });
    if (ok) deletePlanMutation.mutate(plan.id);
  };

  const handleRemoveCourse = async (pc) => {
    const ok = await confirm({
      title: "Remove course from plan?",
      description: `"${pc.course_title}" will no longer be part of this plan for future assignments.`,
      confirmText: "Remove",
      destructive: true,
    });
    if (ok) removeCourseMutation.mutate(pc.id);
  };

  const moveCourse = (index, direction) => {
    const target = planCourses[index + direction];
    const current = planCourses[index];
    if (!target || !current) return;
    updateCourseMutation.mutate({ id: current.id, patch: { order_index: target.order_index } });
    updateCourseMutation.mutate({ id: target.id, patch: { order_index: current.order_index } });
  };

  const remindOverdue = async () => {
    if (!selectedPlan) return;
    setReminding(true);
    try {
      const res = await remindPlanOverdueStaff({ planId: selectedPlan.id });
      const data = res?.data || res;
      if ((data?.reminded_users ?? 0) === 0) {
        toast.success("No one is overdue on this plan — nothing to send.");
      } else {
        toast.success(`Reminder sent to ${data.reminded_users} overdue staff (${data.assignments_flagged} courses flagged).`);
      }
      queryClient.invalidateQueries({ queryKey: ["plan-enrollments-rollup", selectedPlan.id] });
      queryClient.invalidateQueries({ queryKey: ["plan-assignments-rollup", selectedPlan.id] });
    } catch (e) {
      toast.error(`Could not send reminders: ${e.message}`);
    } finally {
      setReminding(false);
    }
  };

  const confirmAssignment = async () => {
    if (!selectedPlan || !assignDueDate || !pendingAssignTarget) return;
    setAssigning(true);
    try {
      const res = await assignAnnualLearningPlan({
        planId: selectedPlan.id,
        dueDate: assignDueDate,
        userEmails: pendingAssignTarget.userEmails || [],
        filters: pendingAssignTarget.filters || {},
        settings: {
          priority: "high",
          passingScoreRequired: 80,
          attestationRequired: true,
          regenerateTestOnRetake: true,
        },
      });
      const data = res?.data || res;
      toast.success(
        `Plan assigned to ${data?.enrolled_users ?? 0} staff (${data?.learning_plan_items ?? planCourses.length} courses each).`
      );
      setShowAssignDialog(false);
      setPendingAssignTarget(null);
      setAssignDueDate("");
      queryClient.invalidateQueries({ queryKey: ["plan-enrollments-rollup", selectedPlan.id] });
    } catch (e) {
      toast.error(`Could not assign plan: ${e.message}`);
    } finally {
      setAssigning(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* One-click: build this year's required in-services + role-based plans */}
      <Card className="border-indigo-200 bg-indigo-50/40">
        <CardContent className="p-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900">Build {year} required in-service plans</h2>
              <p className="text-sm text-slate-600">
                Creates the full library of yearly required in-services for Home Health and Hospice
                staff and nurses, grouped into ready-to-assign role-based annual plans. Safe to run
                again — existing {year} items are reused, not duplicated.
              </p>
            </div>
          </div>
          <Button className="flex-shrink-0" onClick={seedRequiredPlans} disabled={seeding}>
            {seeding ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Building…</>
            ) : (
              <><ShieldCheck className="w-4 h-4 mr-2" />Build required plans</>
            )}
          </Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plans list */}
        <div>
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-semibold">Learning Plans</h3>
            <Dialog
              open={showForm}
              onOpenChange={(open) => {
                setShowForm(open);
                if (!open) setEditingPlan(null);
              }}
            >
              <DialogTrigger asChild>
                <Button size="sm" onClick={() => setEditingPlan(null)}>
                  <Plus className="w-4 h-4 mr-1" /> New plan
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <div className="bg-white rounded-2xl">
                  <DialogHeader>
                    <DialogTitle>{editingPlan ? "Edit Learning Plan" : "Create Learning Plan"}</DialogTitle>
                  </DialogHeader>
                  <LearningPlanForm
                    plan={editingPlan}
                    onSuccess={() => {
                      setShowForm(false);
                      setEditingPlan(null);
                      refetchPlans();
                      toast.success(editingPlan ? "Plan updated" : "Plan created");
                    }}
                  />
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-2 max-h-[640px] overflow-y-auto pr-1">
            {plans.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-slate-500">
                  No plans yet. Build the {year} required plans above or create one.
                </CardContent>
              </Card>
            ) : (
              plans.map((plan) => (
                <Card
                  key={plan.id}
                  className={`cursor-pointer transition-all hover:shadow-md ${
                    selectedPlan?.id === plan.id ? "border-indigo-600 bg-indigo-50 border-2" : ""
                  }`}
                  onClick={() => setSelectedPlan(plan)}
                >
                  <CardContent className="p-4">
                    <p className="font-medium text-sm">{plan.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <Badge variant="outline" className="text-xs">{plan.year}</Badge>
                      {plan.plan_type && <Badge variant="outline" className="text-xs capitalize">{plan.plan_type}</Badge>}
                      {plan.business_line_scope && (
                        <Badge variant="outline" className="text-xs">{plan.business_line_scope.replace(/_/g, " ")}</Badge>
                      )}
                      {plan.active === false && <Badge className="text-xs bg-slate-100 text-slate-600">Inactive</Badge>}
                    </div>
                    <div className="flex gap-1 mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPlan(plan);
                          setShowForm(true);
                        }}
                      >
                        <Edit2 className="w-3 h-3 text-indigo-600" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeletePlan(plan);
                        }}
                      >
                        <Trash2 className="w-3 h-3 text-red-600" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>

        {/* Plan detail */}
        <div className="lg:col-span-2">
          {selectedPlan ? (
            <div className="space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <CardTitle className="text-xl">{selectedPlan.name}</CardTitle>
                      {selectedPlan.description && (
                        <p className="text-sm text-slate-600 mt-1">{selectedPlan.description}</p>
                      )}
                    </div>
                    <Button onClick={() => setShowAssignDialog(true)} disabled={planCourses.length === 0}>
                      <Users className="w-4 h-4 mr-2" /> Assign to staff
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                    {[
                      { label: "Courses", value: planCourses.length },
                      { label: "Required", value: planStats.requiredCount },
                      { label: "Est. time", value: `${planStats.totalMinutes} min` },
                      { label: "Year", value: selectedPlan.year },
                    ].map((item) => (
                      <div key={item.label} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                        <p className="text-xs text-slate-500">{item.label}</p>
                        <p className="text-lg font-bold text-slate-900 mt-0.5">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Course list */}
              <div className="flex justify-between items-center">
                <h4 className="font-semibold">Courses in plan ({planCourses.length})</h4>
                <Dialog open={showCourseDialog} onOpenChange={setShowCourseDialog}>
                  <DialogTrigger asChild>
                    <Button size="sm">
                      <Plus className="w-4 h-4 mr-1" /> Add courses
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-xl">
                    <div className="bg-white rounded-2xl">
                      <DialogHeader>
                        <DialogTitle>Add courses to plan</DialogTitle>
                      </DialogHeader>
                      <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input
                          placeholder="Search published courses…"
                          value={courseSearch}
                          onChange={(e) => setCourseSearch(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      <div className="space-y-2 max-h-[420px] overflow-y-auto">
                        {availableCourses.length === 0 ? (
                          <p className="text-sm text-slate-500 text-center py-6">
                            {usedCourseIds.size > 0 ? "All matching courses are already in this plan." : "No published courses found."}
                          </p>
                        ) : (
                          availableCourses.map((course) => (
                            <Card key={course.id} className="hover:bg-slate-50">
                              <CardContent className="p-3 flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="font-medium text-sm truncate">{course.title}</p>
                                  <div className="flex items-center gap-1.5 mt-1">
                                    {course.category && <Badge variant="outline" className="text-xs">{course.category.replace(/_/g, " ")}</Badge>}
                                    {course.estimated_minutes && <span className="text-xs text-slate-400">{course.estimated_minutes} min</span>}
                                  </div>
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => addCourseMutation.mutate(course)}
                                  disabled={addCourseMutation.isPending}
                                >
                                  Add
                                </Button>
                              </CardContent>
                            </Card>
                          ))
                        )}
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>

              <div className="space-y-2">
                {planCourses.length > 0 ? (
                  planCourses.map((pc, index) => {
                    const course = courseMap[pc.course_id];
                    return (
                      <Card key={pc.id}>
                        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <div className="flex flex-col">
                              <button
                                className="text-slate-300 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-300"
                                onClick={() => moveCourse(index, -1)}
                                disabled={index === 0}
                                aria-label="Move course up"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                className="text-slate-300 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-300"
                                onClick={() => moveCourse(index, 1)}
                                disabled={index === planCourses.length - 1}
                                aria-label="Move course down"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                              {index + 1}
                            </span>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{pc.course_title}</p>
                              <p className="text-xs text-slate-500">
                                {course?.category ? `${course.category.replace(/_/g, " ")} · ` : ""}
                                {course?.estimated_minutes ? `${course.estimated_minutes} min` : "—"}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-4 flex-shrink-0">
                            <div className="flex flex-col gap-1">
                              <Label className="text-[10px] uppercase tracking-wide text-slate-400">Due by</Label>
                              <Input
                                // Remount when the persisted value changes so the displayed
                                // date stays in sync after a refetch / server normalization.
                                key={`due-${pc.specific_due_date || "none"}`}
                                type="date"
                                className="h-8 w-[150px] text-xs"
                                defaultValue={pc.specific_due_date || ""}
                                onChange={(e) =>
                                  updateCourseMutation.mutate({
                                    id: pc.id,
                                    patch: { specific_due_date: e.target.value || null },
                                  })
                                }
                              />
                            </div>
                            <label htmlFor={`plan-course-required-${pc.id}`} className="flex flex-col items-center gap-1 cursor-pointer">
                              <span className="text-[10px] uppercase tracking-wide text-slate-400">Required</span>
                              <Switch
                                id={`plan-course-required-${pc.id}`}
                                checked={pc.is_required !== false}
                                onCheckedChange={(checked) =>
                                  updateCourseMutation.mutate({ id: pc.id, patch: { is_required: checked } })
                                }
                              />
                            </label>
                            <Button size="sm" variant="ghost" onClick={() => handleRemoveCourse(pc)} aria-label="Remove course">
                              <X className="w-4 h-4 text-red-600" />
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Card>
                    <CardContent className="py-10 text-center">
                      <BookOpen className="w-10 h-10 mx-auto mb-2 text-slate-300" />
                      <p className="text-sm text-slate-600">No courses yet. Add courses to build this plan.</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Progress rollup — everyone's progress on this plan */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-600" /> Staff progress on this plan
                    </CardTitle>
                    {overdueUserCount > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={remindOverdue}
                        disabled={reminding}
                        className="border-red-200 text-red-700 hover:bg-red-50"
                      >
                        {reminding ? (
                          <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" />Sending…</>
                        ) : (
                          <><Bell className="w-4 h-4 mr-1.5" />Remind {overdueUserCount} overdue</>
                        )}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {planEnrollments.length === 0 ? (
                    <p className="text-sm text-slate-500 text-center py-6">
                      No staff enrolled yet. Use <span className="font-medium">Assign to staff</span> to roll this plan out.
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: "Enrolled", value: enrollmentStats.total, icon: Users, color: "text-slate-700" },
                          { label: "Completed", value: enrollmentStats.completed, icon: CheckCircle2, color: "text-emerald-600" },
                          { label: "Overdue staff", value: overdueUserCount, icon: AlertTriangle, color: overdueUserCount ? "text-red-600" : "text-slate-700" },
                          { label: "Avg progress", value: `${enrollmentStats.avgProgress}%`, icon: Target, color: "text-indigo-600" },
                        ].map((m) => {
                          const Icon = m.icon;
                          return (
                            <div key={m.label} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                                <Icon className="w-3.5 h-3.5" /> {m.label}
                              </div>
                              <p className={`text-xl font-bold mt-1 ${m.color}`}>{m.value}</p>
                            </div>
                          );
                        })}
                      </div>

                      <div className="space-y-2 max-h-[320px] overflow-y-auto">
                        {planEnrollments.map((e) => {
                          const overdue =
                            e.status === "overdue" ||
                            (e.status !== "completed" && e.due_date && new Date(e.due_date) < new Date());
                          return (
                            <div key={e.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-white">
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-900 truncate">{e.user_name || e.user_id}</p>
                                <p className="text-xs text-slate-500">
                                  {e.courses_completed || 0}/{e.courses_total || 0} courses
                                  {e.due_date && (
                                    <span className="inline-flex items-center gap-1">
                                      {" "}· <CalendarClock className="w-3 h-3" /> due {formatDate(e.due_date)}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0 w-40">
                                <Progress
                                  value={e.progress_percentage || 0}
                                  className={`h-2 flex-1 ${e.status === "completed" ? "[&>div]:bg-emerald-500" : overdue ? "[&>div]:bg-red-500" : ""}`}
                                />
                                <Badge
                                  className={
                                    e.status === "completed"
                                      ? "bg-emerald-100 text-emerald-800"
                                      : overdue
                                      ? "bg-red-100 text-red-800"
                                      : "bg-blue-100 text-blue-800"
                                  }
                                >
                                  {overdue && e.status !== "completed" ? "overdue" : e.status || "active"}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Target className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                <p className="text-slate-600">Select a learning plan to manage courses, assign staff, and track progress.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Assign-to-staff dialog */}
      <Dialog open={showAssignDialog} onOpenChange={(open) => { setShowAssignDialog(open); if (!open) setPendingAssignTarget(null); }}>
        <DialogContent className="max-w-3xl">
          <div className="bg-white rounded-2xl">
            <DialogHeader>
              <DialogTitle>Assign “{selectedPlan?.name}” to staff</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="max-w-xs">
                <Label>Due date for all courses *</Label>
                <Input type="date" value={assignDueDate} onChange={(e) => setAssignDueDate(e.target.value)} />
                <p className="text-xs text-slate-500 mt-1">
                  A course&apos;s own “Due by” date, if set, overrides this for that course.
                </p>
              </div>
              <AssignmentWizard users={users} onAssign={setPendingAssignTarget} />
              <div className="flex items-center justify-between gap-4 rounded-xl border bg-slate-50 p-4">
                <p className="text-sm text-slate-600">
                  {pendingAssignTarget
                    ? `Ready to enroll ${pendingAssignTarget.userEmails?.length || "the filtered"} staff and assign ${planCourses.length} courses each.`
                    : "Choose who to assign using the wizard above, then confirm."}
                </p>
                <Button onClick={confirmAssignment} disabled={!assignDueDate || !pendingAssignTarget || assigning}>
                  {assigning ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Assigning…</> : <><Send className="w-4 h-4 mr-2" />Assign plan</>}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
