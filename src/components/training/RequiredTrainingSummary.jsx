import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, AlertTriangle, CalendarClock, ArrowRight } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : "—");

/**
 * "Stay compliant at a glance" banner for staff. Summarizes the learner's
 * REQUIRED in-services (annual mandatory / required assignments): how many are
 * done, how many are overdue, and the single next thing to do — so a staff
 * member always knows what they must finish to stay compliant without scanning
 * the full list. Renders nothing when the learner has no required items.
 */
const isRequired = (assignment, course) => {
  // An explicit opt-out on the assignment (e.g. a plan course toggled to
  // "optional") always wins over the course-type fallback, so optional items
  // never block the all-caught-up state.
  if (assignment?.required === false) return false;
  return (
    assignment?.required === true ||
    course?.is_mandatory === true ||
    course?.training_type === "annual_mandatory" ||
    course?.training_type === "in_service"
  );
};

const isComplete = (assignment) =>
  assignment?.status === "completed" || assignment?.pass_fail_result === "passed";

export default function RequiredTrainingSummary({ assignments = [], courseMap = {} }) {
  const summary = useMemo(() => {
    const required = assignments.filter((a) => isRequired(a, courseMap[a.course_id]));
    const total = required.length;
    if (total === 0) return null;

    const completed = required.filter(isComplete);
    const outstanding = required.filter((a) => !isComplete(a));
    const now = new Date();
    const overdue = outstanding.filter(
      (a) => a.status === "overdue" || (a.due_date && new Date(a.due_date) < now)
    );

    // The single most urgent next action: soonest due date among outstanding,
    // dated items first, then any remaining outstanding item.
    const next = [...outstanding].sort((a, b) => {
      if (a.due_date && b.due_date) return new Date(a.due_date) - new Date(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return 0;
    })[0];

    return {
      total,
      completed: completed.length,
      overdue: overdue.length,
      outstanding: outstanding.length,
      pct: Math.round((completed.length / total) * 100),
      next,
    };
  }, [assignments, courseMap]);

  if (!summary) return null;

  const { total, completed, overdue, outstanding, pct, next } = summary;
  const allDone = outstanding === 0;

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 ${
        overdue > 0
          ? "border-red-200 bg-red-50/60"
          : allDone
          ? "border-emerald-200 bg-emerald-50/60"
          : "border-indigo-200 bg-indigo-50/50"
      }`}
    >
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              overdue > 0
                ? "bg-red-100 text-red-600"
                : allDone
                ? "bg-emerald-100 text-emerald-600"
                : "bg-indigo-100 text-indigo-600"
            }`}
          >
            {overdue > 0 ? <AlertTriangle className="w-5 h-5" /> : <ShieldCheck className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-900">
              {allDone
                ? "You're all caught up on required training"
                : "Required to stay compliant"}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              {completed} of {total} required in-services complete
              {overdue > 0 && (
                <span className="text-red-700 font-medium"> · {overdue} overdue</span>
              )}
              {!allDone && next?.due_date && (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  {" "}
                  · <CalendarClock className="w-3.5 h-3.5" /> next due {formatDate(next.due_date)}
                </span>
              )}
            </p>
            <div className="flex items-center gap-2 mt-2 max-w-md">
              <Progress
                value={pct}
                className={`h-2 flex-1 ${
                  overdue > 0
                    ? "[&>div]:bg-red-500"
                    : allDone
                    ? "[&>div]:bg-emerald-500"
                    : "[&>div]:bg-indigo-500"
                }`}
              />
              <span className="text-xs font-semibold text-slate-500 flex-shrink-0">{pct}%</span>
            </div>
          </div>
        </div>

        {!allDone && next && (
          <Link
            to={`${createPageUrl("TrainingCoursePlayer")}?assignment=${next.id}`}
            className="flex-shrink-0"
          >
            <Button className={overdue > 0 ? "bg-red-600 hover:bg-red-700" : ""}>
              Start next: {next.course_title?.length > 28 ? `${next.course_title.slice(0, 28)}…` : next.course_title}
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
