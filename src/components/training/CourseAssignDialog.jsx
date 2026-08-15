import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { UserPlus, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import AssignmentWizard from "./AssignmentWizard";
import { assignInService } from "@/functions/assignInService";

// Per-course role-based enrollment. Reuses AssignmentWizard for candidate
// targeting and the existing assignInService backend (dedup + notifications +
// audit), which already accepts any published course.
export default function CourseAssignDialog({ course }) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState("");
  const [priority, setPriority] = useState("high");
  const [required, setRequired] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const { data: users = [] } = useQuery({
    queryKey: ["assign-users", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list("-created_date", 5000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    initialData: [],
    enabled: open && !!currentUser,
  });

  // Pre-fill the role filter when the course targets a single role.
  const initialFilters =
    Array.isArray(course?.role_targets) && course.role_targets.length === 1
      ? { role: course.role_targets[0] }
      : undefined;

  const isPublished = course?.status === "published";

  const handleAssign = async ({ userEmails, filters }) => {
    setError("");
    setResult(null);
    // Never assign an unpublished course — learners would be notified and could
    // open it (the player loads by assignment, not by publish status) before it
    // has been reviewed and published.
    if (!isPublished) {
      setError("Publish this course before assigning it to employees.");
      return;
    }
    if (!dueDate) {
      setError("Please choose a due date before assigning.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await assignInService({
        courseId: course.id,
        dueDate,
        userEmails,
        filters,
        settings: { priority, required },
      });
      const data = res?.data || res;
      if (data?.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err) {
      console.error("Assign error:", err);
      setError(err?.message || "Failed to assign course. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setResult(null);
          setError("");
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={!isPublished}
          title={isPublished ? "Assign this course to employees" : "Publish this course before assigning it"}
        >
          <UserPlus className="w-4 h-4 mr-1" />
          Assign
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign &ldquo;{course?.title}&rdquo;</DialogTitle>
        </DialogHeader>

        {course?.status !== "published" && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-800">
              This course is <strong>{course?.status}</strong>. Learners can only open it once it is published.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <Label className="text-sm font-semibold">Due Date *</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10 mt-1" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="h-10 mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent style={{ zIndex: 9999 }}>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 min-h-[40px]">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
                className="w-5 h-5"
              />
              <span className="text-sm font-medium">Required</span>
            </label>
          </div>
        </div>

        {Array.isArray(course?.role_targets) && course.role_targets.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap text-sm text-slate-600">
            <span>Target roles:</span>
            {course.role_targets.map((r) => (
              <Badge key={r} variant="outline">{r}</Badge>
            ))}
          </div>
        )}

        {result ? (
          <Alert className="border-emerald-200 bg-emerald-50">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800">
              Assigned to {result.assigned_count} employee{result.assigned_count === 1 ? "" : "s"}
              {result.skipped_existing ? ` (${result.skipped_existing} already assigned)` : ""}.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}
            {submitting && (
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Loader2 className="w-4 h-4 animate-spin" /> Assigning...
              </div>
            )}
            <AssignmentWizard users={users} onAssign={handleAssign} initialFilters={initialFilters} />
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
