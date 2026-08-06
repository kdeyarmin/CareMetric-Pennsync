import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  Award, Check, Clock, Film, GraduationCap, Loader2, Scale, Target, UserPlus,
  Users, BookOpen, Sparkles, ExternalLink,
} from "lucide-react";
import { createPageUrl } from "@/utils";
import { isSafeExternalUrl } from "@/components/utils/security";

// Course syllabus shown before a learner commits, the way a healthcare course
// catalog presents it: credit and duration up front, then audience, objectives,
// the lesson outline, the skills a supervisor can validate, and the regulations
// the course maps to. Every value comes from fields the course already carries
// (the AI course generator populates them), so nothing here is decorative.

const Section = ({ icon: Icon, title, children }) => (
  <section className="space-y-2">
    <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
      <Icon className="w-4 h-4 text-navy-600" /> {title}
    </h3>
    {children}
  </section>
);

const Stat = ({ icon: Icon, label, value }) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
    <p className="text-xs text-slate-500 flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5" /> {label}
    </p>
    <p className="text-sm font-semibold text-slate-900 mt-0.5">{value}</p>
  </div>
);

export default function CourseCatalogDetail({
  course,
  open,
  onOpenChange,
  enrolled = false,
  required = false,
  enrolling = false,
  enrollError = false,
  onEnroll,
  canPreview = false,
}) {
  const courseId = course?.id;

  // The lesson outline. Shares its query key with the course builder / video
  // studio so an admin editing lessons in another tab sees the same data.
  const { data: modules = [], isLoading: modulesLoading } = useQuery({
    queryKey: ["training-modules", courseId],
    queryFn: () => base44.entities.TrainingModule.filter({ course_id: courseId }, "order_index", 100),
    enabled: !!courseId && open,
    initialData: [],
  });

  if (!course) return null;

  const objectives = Array.isArray(course.learning_objectives) ? course.learning_objectives.filter(Boolean) : [];
  const skills = Array.isArray(course.competency_skills_json) ? course.competency_skills_json.filter(Boolean) : [];
  const crosswalk = Array.isArray(course.regulatory_crosswalk_json)
    ? course.regulatory_crosswalk_json.filter(Boolean)
    : [];
  const references = Array.isArray(course.references_json) ? course.references_json.filter(Boolean) : [];
  const roles = Array.isArray(course.role_targets) ? course.role_targets.filter(Boolean) : [];
  const videoCount = modules.filter((m) => m.video_url).length;
  const ceHours = Number(course.ceu_hours) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-1.5 mb-1">
            <Badge variant="outline" className="text-xs capitalize">
              {course.category?.replace(/_/g, " ") || "General"}
            </Badge>
            {course.business_line_scope && course.business_line_scope !== "all" && (
              <Badge variant="outline" className="text-xs">
                {course.business_line_scope === "home_health" ? "Home Health" : "Hospice"}
              </Badge>
            )}
            {course.training_type === "annual_mandatory" && (
              <Badge className="bg-indigo-100 text-indigo-700 text-xs">Annual</Badge>
            )}
            {course.training_type === "in_service" && (
              <Badge className="bg-navy-100 text-navy-700 text-xs">In-Service</Badge>
            )}
            {required && <Badge className="bg-red-100 text-red-700 text-xs">Required</Badge>}
            {ceHours > 0 && (
              <Badge className="bg-emerald-100 text-emerald-800 text-xs">
                {ceHours} CE hr{ceHours === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <DialogTitle className="text-xl leading-tight">{course.title}</DialogTitle>
          {course.short_description && (
            <DialogDescription className="text-sm text-slate-600">{course.short_description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-5 mt-2">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat
              icon={GraduationCap}
              label="CE credit"
              value={ceHours > 0 ? `${ceHours} hr${ceHours === 1 ? "" : "s"}` : "No CE credit"}
            />
            <Stat
              icon={Clock}
              label="Duration"
              value={course.estimated_minutes ? `${course.estimated_minutes} min` : "Self-paced"}
            />
            <Stat
              icon={Target}
              label="Passing score"
              value={course.passing_score ? `${course.passing_score}%` : "No test"}
            />
            <Stat
              icon={BookOpen}
              label="Lessons"
              value={modulesLoading ? "Loading…" : `${modules.length}${videoCount > 0 ? ` (${videoCount} on video)` : ""}`}
            />
            <Stat
              icon={Award}
              label="Certificate"
              value={
                course.enable_certificate === false
                  ? "Not issued"
                  : course.certificate_valid_months
                    ? `Valid ${course.certificate_valid_months} mo`
                    : "No expiration"
              }
            />
            <Stat icon={Film} label="Version" value={course.version || "1.0"} />
          </div>

          {(roles.length > 0 || course.employee_audience) && (
            <Section icon={Users} title="Who should take this">
              {roles.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((role) => (
                    <Badge key={role} variant="outline" className="text-xs">{role}</Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-600">{course.employee_audience}</p>
              )}
            </Section>
          )}

          {course.description && (
            <Section icon={BookOpen} title="About this course">
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{course.description}</p>
            </Section>
          )}

          {objectives.length > 0 && (
            <Section icon={Target} title="What you will be able to do">
              <ul className="space-y-1.5">
                {objectives.map((objective, index) => (
                  <li key={index} className="text-sm text-slate-600 flex gap-2">
                    <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                    <span>{objective}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {modules.length > 0 && (
            <Section icon={BookOpen} title="Course outline">
              <ol className="space-y-1.5">
                {modules.map((module, index) => (
                  <li key={module.id} className="text-sm text-slate-600 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                      {index + 1}
                    </span>
                    <span className="flex-1 min-w-0">{module.title}</span>
                    {module.video_url && <Film className="w-3.5 h-3.5 text-navy-500 flex-shrink-0" />}
                    {module.estimated_minutes > 0 && (
                      <span className="text-xs text-slate-400 flex-shrink-0">{module.estimated_minutes} min</span>
                    )}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {skills.length > 0 && (
            <Section icon={Check} title="Skills your supervisor can validate">
              <ul className="space-y-1.5">
                {skills.map((skill, index) => (
                  <li key={index} className="text-sm text-slate-600">
                    <span className="font-medium text-slate-800">{skill.skill}</span>
                    {skill.criteria && <span> — {skill.criteria}</span>}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {crosswalk.length > 0 && (
            <Section icon={Scale} title="Regulatory alignment">
              <ul className="space-y-2">
                {crosswalk.map((entry, index) => (
                  <li key={index} className="rounded-lg border border-slate-200 bg-white p-2.5">
                    <p className="text-sm font-medium text-slate-800">
                      {entry.regulation}
                      {entry.title ? ` — ${entry.title}` : ""}
                    </p>
                    {entry.how_this_course_addresses_it && (
                      <p className="text-xs text-slate-500 mt-0.5">{entry.how_this_course_addresses_it}</p>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {course.real_world_relevance && (
            <Section icon={Sparkles} title="Why this matters now">
              <p className="text-sm text-slate-600">{course.real_world_relevance}</p>
            </Section>
          )}

          {references.length > 0 && (
            <Section icon={ExternalLink} title="References">
              <ul className="space-y-1">
                {references.map((reference, index) => (
                  <li key={index} className="text-xs text-slate-500">
                    {reference.url && isSafeExternalUrl(reference.url) ? (
                      <a
                        href={reference.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {reference.title || reference.url}
                      </a>
                    ) : (
                      <span>{reference.title || reference.url}</span>
                    )}
                    {reference.note ? ` — ${reference.note}` : ""}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-4 border-t border-slate-200 mt-4">
          {canPreview && (
            <Button variant="outline" asChild>
              <Link to={`${createPageUrl("TrainingCoursePlayer")}?courseId=${course.id}&preview=true`}>
                Preview course
              </Link>
            </Button>
          )}
          {enrolled ? (
            <span className="inline-flex items-center justify-center gap-1.5 text-sm font-medium text-emerald-600 px-3">
              <Check className="w-4 h-4" /> Enrolled
            </span>
          ) : required ? (
            <span className="text-sm text-slate-500 px-3">Assigned by your administrator</span>
          ) : (
            <Button onClick={() => onEnroll?.(course.id)} disabled={enrolling}>
              {enrolling ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Enrolling…</>
              ) : (
                <><UserPlus className="w-4 h-4 mr-1.5" /> Enroll in this course</>
              )}
            </Button>
          )}
        </div>
        {enrollError && (
          <p className="text-xs text-red-600 text-right">Could not enroll. Please try again.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
