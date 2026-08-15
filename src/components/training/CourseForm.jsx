import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { agencyQueryKey } from '@/lib/agencyRoster';
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { linesToArray } from "@/utils";

// Details form for a course. On success it hands the SAVED course (with id) back
// to the parent so the Lessons / Quiz builders can attach modules and questions
// by course_id. Splitting objectives from a textarea keeps the entity's
// learning_objectives array in sync without a separate editor.
export default function CourseForm({ course, onSuccess }) {
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });
  const [formData, setFormData] = useState(() => ({
    title: "",
    short_description: "",
    description: "",
    category: "compliance",
    training_type: "course",
    business_line_scope: "all",
    status: "draft",
    estimated_minutes: 60,
    passing_score: 80,
    ceu_hours: "",
    certificate_valid_months: "",
    is_mandatory: false,
    enable_certificate: true,
    requires_attestation: false,
    attestation_text: "",
    role_targets: [],
    ...(course || {}),
  }));
  const [objectivesText, setObjectivesText] = useState(
    Array.isArray(course?.learning_objectives) ? course.learning_objectives.join("\n") : ""
  );

  // Role options mirror AssignmentWizard's derivation so role_targets line up with
  // what role-based assignment later filters on (job_title || credential_type || role).
  const { data: users = [] } = useQuery({
    queryKey: ["course-role-options", agencyQueryKey(currentUser)],
    queryFn: async () => {
      const _rows = await base44.entities.User.list("-created_date", 1000);
      const { filterUsersByCallerAgency } = await import('@/lib/agencyScope');
      return filterUsersByCallerAgency(_rows, currentUser);
    },
    enabled: !!currentUser,
    initialData: [],
  });
  const roleOptions = useMemo(() => {
    const set = new Set(
      users
        .filter((u) => u.email && u.role !== "admin")
        .map((u) => u.job_title || u.credential_type || u.role)
        .filter(Boolean)
    );
    // Keep any role already targeted even if no current user matches it.
    (formData.role_targets || []).forEach((r) => r && set.add(r));
    return Array.from(set).sort();
  }, [users, formData.role_targets]);

  // Coerce a numeric text field to a finite number, or null — never NaN, which
  // would otherwise be sent to the backend for a non-numeric input.
  const toFiniteOrNull = (value) => {
    if (value === "" || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  const buildPayload = () => {
    const payload = {
      ...formData,
      learning_objectives: linesToArray(objectivesText),
      ceu_hours: toFiniteOrNull(formData.ceu_hours),
      certificate_valid_months: toFiniteOrNull(formData.certificate_valid_months),
    };
    if (!payload.requires_attestation) payload.attestation_text = "";
    return payload;
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      course
        ? base44.entities.TrainingCourse.update(course.id, buildPayload())
        : base44.entities.TrainingCourse.create(buildPayload()),
    onSuccess: (saved) => {
      // create() returns the new record; update() may return the updated record.
      // Fall back to merging the payload onto the known id so callers always get
      // a course object with an id.
      const result = saved && saved.id ? saved : { ...(course || {}), ...buildPayload(), id: course?.id };
      onSuccess?.(result);
    },
    onError: (error) => {
      console.error("Course save error:", error);
    },
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    saveMutation.mutate();
  };

  const toggleRole = (role) => {
    setFormData((prev) => {
      const current = prev.role_targets || [];
      return {
        ...prev,
        role_targets: current.includes(role)
          ? current.filter((r) => r !== role)
          : [...current, role],
      };
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 animate-fade-in">
      <div>
        <Label className="text-sm font-semibold">Course Title *</Label>
        <Input
          required
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="Enter course title"
          className="h-11 mt-1"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold">Short Description</Label>
        <Input
          value={formData.short_description || ""}
          onChange={(e) => setFormData({ ...formData, short_description: e.target.value })}
          placeholder="One-line summary shown in the catalog"
          className="h-11 mt-1"
        />
      </div>

      <div>
        <Label className="text-sm font-semibold">Description</Label>
        <Textarea
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Course description / introduction"
          rows={3}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Category *</Label>
          <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
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

        <div>
          <Label className="text-sm font-semibold">Status *</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="pending_review">Pending Review</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Training Type</Label>
          <Select value={formData.training_type} onValueChange={(value) => setFormData({ ...formData, training_type: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="course">Standard Course</SelectItem>
              <SelectItem value="in_service">In-Service</SelectItem>
              <SelectItem value="annual_mandatory">Annual Mandatory</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label className="text-sm font-semibold">Business Line</Label>
          <Select value={formData.business_line_scope} onValueChange={(value) => setFormData({ ...formData, business_line_scope: value })}>
            <SelectTrigger className="h-11 mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent style={{ zIndex: 9999 }}>
              <SelectItem value="all">All Lines</SelectItem>
              <SelectItem value="home_health">Home Health</SelectItem>
              <SelectItem value="hospice">Hospice</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">Estimated Minutes *</Label>
          <Input
            type="number"
            required
            min="1"
            max="600"
            value={formData.estimated_minutes}
            onChange={(e) => setFormData({ ...formData, estimated_minutes: Math.max(1, parseInt(e.target.value) || 1) })}
            className="h-11 mt-1"
          />
        </div>

        <div>
          <Label className="text-sm font-semibold">Passing Score % *</Label>
          <Input
            type="number"
            required
            min="0"
            max="100"
            value={formData.passing_score}
            onChange={(e) => setFormData({ ...formData, passing_score: parseInt(e.target.value) })}
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <Label className="text-sm font-semibold">CEU Hours</Label>
          <Input
            type="number"
            min="0"
            step="0.25"
            value={formData.ceu_hours ?? ""}
            onChange={(e) => setFormData({ ...formData, ceu_hours: e.target.value })}
            placeholder="e.g. 1.5"
            className="h-11 mt-1"
          />
        </div>

        <div>
          <Label className="text-sm font-semibold">Certificate Valid (months)</Label>
          <Input
            type="number"
            min="0"
            value={formData.certificate_valid_months ?? ""}
            onChange={(e) => setFormData({ ...formData, certificate_valid_months: e.target.value })}
            placeholder="Blank = no expiration"
            className="h-11 mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-sm font-semibold">Learning Objectives</Label>
        <Textarea
          value={objectivesText}
          onChange={(e) => setObjectivesText(e.target.value)}
          placeholder="One objective per line"
          rows={3}
          className="mt-1"
        />
        <p className="text-xs text-slate-400 mt-1">Enter one measurable objective per line.</p>
      </div>

      <div>
        <Label className="text-sm font-semibold">Target Roles</Label>
        <p className="text-xs text-slate-400 mt-0.5 mb-2">
          Roles this course is intended for. Used to pre-fill role-based enrollment.
        </p>
        {roleOptions.length === 0 ? (
          <p className="text-sm text-slate-400">No employee roles found yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {roleOptions.map((role) => {
              const selected = (formData.role_targets || []).includes(role);
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  aria-pressed={selected}
                  className={`text-sm rounded-full px-3 py-1.5 border transition-colors ${
                    selected
                      ? "bg-navy-600 text-white border-navy-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {role}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 flex-wrap">
        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.is_mandatory}
            onChange={(e) => setFormData({ ...formData, is_mandatory: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Mandatory Course</span>
        </label>

        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.enable_certificate}
            onChange={(e) => setFormData({ ...formData, enable_certificate: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Issue Certificate</span>
        </label>

        <label className="flex items-center gap-2 min-h-[44px]">
          <input
            type="checkbox"
            checked={formData.requires_attestation}
            onChange={(e) => setFormData({ ...formData, requires_attestation: e.target.checked })}
            className="w-5 h-5"
          />
          <span className="text-sm font-medium">Require Attestation</span>
        </label>
      </div>

      {formData.requires_attestation && (
        <div>
          <Label className="text-sm font-semibold">Attestation Statement</Label>
          <Textarea
            value={formData.attestation_text || ""}
            onChange={(e) => setFormData({ ...formData, attestation_text: e.target.value })}
            placeholder="I attest that I have reviewed and understood this training..."
            rows={2}
            className="mt-1"
          />
        </div>
      )}

      {saveMutation.isError && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">
            Failed to save course. Please check your inputs and try again.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex gap-2 pt-4">
        <Button type="submit" disabled={saveMutation.isPending} className="btn-primary w-full sm:w-auto">
          {saveMutation.isPending ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            course ? "Save Details" : "Create Course"
          )}
        </Button>
      </div>
    </form>
  );
}
