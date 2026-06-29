import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Eye, CheckCircle2, RotateCcw, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";

// SME (subject-matter-expert) review queue. AI-generated courses are created as
// status:'draft' + needs_sme_review:true; this connects them to an approval
// step so a human signs off before staff are assigned the content.
export default function SMEReviewQueue() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState(null);
  const [notes, setNotes] = useState({});

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdminUser = currentUser?.role === "admin" || currentUser?.account_type === "agency_admin" || currentUser?.account_type === "super_admin";

  const { data: pendingCourses = [], isLoading } = useQuery({
    queryKey: ["sme-review-queue"],
    queryFn: () => base44.entities.TrainingCourse.filter({ needs_sme_review: true }, "-updated_date", 200),
    initialData: [],
    enabled: isAdminUser,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["sme-review-queue"] });
    queryClient.invalidateQueries({ queryKey: ["training-courses"] });
    queryClient.invalidateQueries({ queryKey: ["annual-courses"] });
  };

  const writeAudit = async (course, action, after, reason) => {
    try {
      await base44.entities.TrainingAuditLog.create({
        actor_id: currentUser?.email,
        actor_name: currentUser?.full_name,
        action,
        entity_type: "TrainingCourse",
        entity_id: course.id,
        after_json: after,
        reason,
        severity: "info",
      });
    } catch (err) {
      console.error("Audit log failed:", err);
    }
  };

  const notifyAuthor = async (course, title, message) => {
    if (!course.created_by || course.created_by === currentUser?.email) return;
    try {
      await base44.entities.Notification.create({
        user_email: course.created_by,
        title,
        message,
        type: "system_update",
        priority: "medium",
        action_url: createPageUrl("AdminTraining") + "?tab=courses",
        action_label: "Open courses",
        metadata: { course_id: course.id },
      });
    } catch (err) {
      console.error("Author notification failed:", err);
    }
  };

  const approve = async (course) => {
    setBusyId(course.id);
    try {
      await base44.entities.TrainingCourse.update(course.id, {
        status: "published",
        needs_sme_review: false,
        approved_by: currentUser?.email,
        approved_at: new Date().toISOString(),
        published_by: currentUser?.email,
        published_date: new Date().toISOString(),
      });
      await writeAudit(course, "course_published", { status: "published", approved_by: currentUser?.email }, "sme_approved");
      await notifyAuthor(course, "Course approved & published", `"${course.title}" passed SME review and is now published.`);
      toast.success(`Published "${course.title}"`);
      refresh();
    } catch (err) {
      toast.error("Failed to publish course");
      console.error(err);
    } finally {
      setBusyId(null);
    }
  };

  const requestChanges = async (course) => {
    setBusyId(course.id);
    const note = (notes[course.id] || "").trim();
    try {
      await base44.entities.TrainingCourse.update(course.id, {
        status: "draft",
        needs_sme_review: false,
      });
      await writeAudit(course, "content_rejected", { status: "draft", review_note: note }, "sme_changes_requested");
      await notifyAuthor(course, "Course changes requested", `"${course.title}" needs revisions before publishing.${note ? ` Reviewer note: ${note}` : ""}`);
      toast.success("Sent back to the author as a draft");
      setNotes((prev) => ({ ...prev, [course.id]: "" }));
      refresh();
    } catch (err) {
      toast.error("Failed to request changes");
      console.error(err);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-amber-200 bg-amber-50/40">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">SME Review Queue</h2>
            <p className="text-sm text-slate-600">
              AI-generated and draft courses flagged for subject-matter-expert review. Preview the content, then approve to publish or send back with notes. Nothing reaches staff until it is approved.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-amber-600" /></div>
      ) : pendingCourses.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">No courses are awaiting review. AI-generated drafts will appear here automatically.</CardContent></Card>
      ) : (
        pendingCourses.map((course) => (
          <Card key={course.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <CardTitle className="text-base flex items-center gap-2">
                  {course.title}
                  {course.ai_generated && <Badge className="bg-indigo-100 text-indigo-800"><Sparkles className="w-3 h-3 mr-1" />AI</Badge>}
                </CardTitle>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="capitalize">{(course.category || "compliance").replace(/_/g, " ")}</Badge>
                  <Badge variant="outline">{course.business_line_scope}</Badge>
                  <Badge className="bg-amber-100 text-amber-800">Pending review</Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">{course.short_description || course.description}</p>
              <div className="text-xs text-slate-500">
                {course.estimated_minutes ? `${course.estimated_minutes} min` : null}
                {course.ceu_hours ? ` · ${course.ceu_hours} CEU` : null}
                {course.created_by ? ` · Author: ${course.created_by}` : null}
              </div>
              <Textarea
                placeholder="Optional note to the author (sent with 'Request changes')"
                value={notes[course.id] || ""}
                onChange={(e) => setNotes((prev) => ({ ...prev, [course.id]: e.target.value }))}
              />
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link to={`${createPageUrl("TrainingCoursePlayer")}?courseId=${course.id}&preview=true`} target="_blank" rel="noopener noreferrer">
                    <Eye className="w-4 h-4 mr-2" />Preview
                  </Link>
                </Button>
                <Button onClick={() => approve(course)} disabled={busyId === course.id}>
                  {busyId === course.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Approve &amp; Publish
                </Button>
                <Button variant="outline" onClick={() => requestChanges(course)} disabled={busyId === course.id}>
                  <RotateCcw className="w-4 h-4 mr-2" />Request Changes
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
