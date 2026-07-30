import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Sparkles, Loader2, AlertTriangle, Film, ChevronDown, ChevronUp,
  BookOpenCheck, FileQuestion, Award, CheckCircle2,
} from "lucide-react";
import { generateTrainingCourseStepwise } from "@/functions/generateTrainingCourse";
import PresenterPicker from "@/components/training/PresenterPicker";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { isAdminView } from "@/lib/roles";
import { toast } from "sonner";

// Curated audience roles — these become the course's role_targets, so a generated
// course drops straight into the role-based Assign flow.
const AUDIENCE_ROLES = [
  "RN", "LPN", "Home Health Aide", "Physical Therapist", "Occupational Therapist",
  "Speech Therapist", "Social Worker", "Chaplain", "Administrative Staff", "DME Technician",
];

const DEFAULT_QUESTION_TYPES = ["mcq", "true_false", "scenario_based"];
const COURSE_OUTPUTS = [
  { icon: BookOpenCheck, label: "Course design & lessons" },
  { icon: Film, label: "Presenter scripts & HeyGen videos" },
  { icon: FileQuestion, label: "End-of-course quiz" },
  { icon: Award, label: "Certificate after passing" },
];

// One-topic-and-go AI course creation. The heavy lifting (course + lessons +
// quiz + optional HeyGen presenter videos) is done by the generateTrainingCourse
// backend, driven phase-by-phase via generateTrainingCourseStepwise so no single
// request outlives the platform's execution window; this dialog keeps the
// required input to just a topic and hands the new course id back so the caller
// can open it in the builder for review.
export default function AICourseGenerator({ onGenerated }) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [failedDraftId, setFailedDraftId] = useState(null);
  const [form, setForm] = useState({
    topic: "",
    training_category: "compliance",
    business_line: "all",
    audience_roles: [],
    lesson_length: 30,
    question_count: 10,
    custom_instructions: "",
    generate_videos: true,
    video_avatar_id: "",
    video_voice_id: "",
    passing_score: 80,
    certificate_valid_months: 12,
  });

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdminUser = isAdminView(currentUser);

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const toggleRole = (role) =>
    setForm((prev) => ({
      ...prev,
      audience_roles: prev.audience_roles.includes(role)
        ? prev.audience_roles.filter((r) => r !== role)
        : [...prev.audience_roles, role],
    }));

  const reset = () => {
    setError("");
    setFailedDraftId(null);
    setLoading(false);
    setProgress(null);
  };

  const handleGenerate = async () => {
    if (!form.topic.trim()) {
      setError("Please enter a training topic.");
      return;
    }
    setLoading(true);
    setError("");
    setFailedDraftId(null);
    try {
      const payload = {
        topic: form.topic.trim(),
        training_category: form.training_category,
        business_line: form.business_line,
        audience_roles: form.audience_roles,
        lesson_length: Number(form.lesson_length) || 30,
        question_count: Number(form.question_count) || 10,
        question_types: DEFAULT_QUESTION_TYPES,
        custom_instructions: form.custom_instructions.trim(),
        training_type: "course",
        status: "draft",
        generate_videos: form.generate_videos,
        video_avatar_id: form.video_avatar_id.trim(),
        video_voice_id: form.video_voice_id.trim(),
        passing_score: Number(form.passing_score) || 80,
        enable_certificate: true,
        certificate_valid_months: Number(form.certificate_valid_months) || 12,
      };
      const data = await generateTrainingCourseStepwise(payload, setProgress);
      if (!data?.success || !data?.course_id) {
        throw new Error(data?.error || "Generation did not return a course.");
      }

      if (data.video_generation_status === "generating") {
        toast.info("Course generated. Presenter videos are rendering and will appear shortly — track them in the Video Studio.");
      } else if (data.video_generation_status === "skipped_no_api_key") {
        toast.warning("Course generated, but video generation is not configured, so no videos were created.");
      } else if (data.video_generation_status === "error") {
        toast.warning("Course generated, but presenter videos could not be started. You can retry from the Video Studio.");
      } else {
        toast.success("Course generated as a draft. Review and publish when ready.");
      }

      reset();
      onGenerated?.(data.course_id);
    } catch (err) {
      const friendly = configNotReadyMessage(err);
      if (!friendly) console.error("AI course generation failed:", err);
      const base = friendly || err?.message || "Failed to generate the course. Please try again.";
      // A later phase failed after the draft was created — point the admin at
      // the partial draft (the builder offers "Resume AI generation" there)
      // instead of leaving a mystery course in the list.
      if (err?.course_id) {
        setFailedDraftId(err.course_id);
        setError(
          `${base} A draft ("${err.course_title || "Untitled"}") was created with partial content — open it to resume the AI generation, or delete it.`
        );
      } else {
        setError(base);
      }
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  return (
    <Card className="overflow-hidden border-navy-200 bg-gradient-to-br from-navy-50 via-white to-blue-50">
      <CardContent className="p-5 sm:p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold text-navy-700 mb-2">
              <Sparkles className="w-3.5 h-3.5" /> AI Course Studio
            </div>
            <h2 className="text-xl font-bold text-slate-900">What should your team learn?</h2>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Enter one topic. AI builds the complete draft course, writes every presenter script, creates the quiz, and prepares certificate issuance.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-2 text-xs text-slate-700 shrink-0">
            {COURSE_OUTPUTS.map(({ icon: Icon, label }) => (
              <span key={label} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <Icon className="w-3.5 h-3.5 text-navy-600" />
                {label}
              </span>
            ))}
          </div>
        </div>

        <Alert className="bg-amber-50/80 border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900 text-sm">
            The finished course stays in <strong>draft</strong> until an educator reviews and publishes it.
          </AlertDescription>
        </Alert>

        <div className="space-y-4">
          <div>
            <Label htmlFor="ai-course-topic" className="text-sm font-semibold">Course topic *</Label>
            <div className="flex flex-col sm:flex-row gap-2 mt-1.5">
              <Input
                id="ai-course-topic"
                value={form.topic}
                onChange={(e) => set({ topic: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && form.topic.trim() && !loading && isAdminUser) handleGenerate();
                }}
                placeholder="e.g. Preventing falls during home health visits"
                className="h-12 bg-white text-base"
                disabled={loading}
              />
              <Button
                onClick={handleGenerate}
                disabled={loading || !form.topic.trim() || !isAdminUser}
                className="h-12 px-6 whitespace-nowrap"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Building course…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-2" /> Build complete course</>
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-400 mt-1">This is the only required field — everything else has sensible defaults.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white/80 p-4">
            <div>
              <Label className="text-sm font-semibold">Category</Label>
              <Select value={form.training_category} onValueChange={(v) => set({ training_category: v })} disabled={loading}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
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
              <Label className="text-sm font-semibold">Business Line</Label>
              <Select value={form.business_line} onValueChange={(v) => set({ business_line: v })} disabled={loading}>
                <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="all">All Lines</SelectItem>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-sm font-semibold">Target Roles</Label>
            <p className="text-xs text-slate-400 mt-0.5 mb-2">Tailors the content and sets who the course can be assigned to.</p>
            <div className="flex flex-wrap gap-2">
              {AUDIENCE_ROLES.map((role) => {
                const selected = form.audience_roles.includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    disabled={loading}
                    onClick={() => toggleRole(role)}
                    aria-pressed={selected}
                    className={`text-sm rounded-full px-3 py-1.5 border transition-colors disabled:opacity-50 ${
                      selected ? "bg-navy-600 text-white border-navy-600" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    }`}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-semibold">Approx. Length (minutes)</Label>
              <Input
                type="number" min="10" max="120" step="5"
                value={form.lesson_length}
                onChange={(e) => set({ lesson_length: e.target.value })}
                className="h-11 mt-1"
                disabled={loading}
              />
            </div>
            <div>
              <Label className="text-sm font-semibold">Quiz Questions</Label>
              <Input
                type="number" min="1" max="30"
                value={form.question_count}
                onChange={(e) => set({ question_count: e.target.value })}
                className="h-11 mt-1"
                disabled={loading}
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white/80 p-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Generate presenter videos (HeyGen)"
                checked={form.generate_videos}
                onChange={(e) => set({ generate_videos: e.target.checked })}
                className="w-5 h-5 mt-0.5"
                disabled={loading}
              />
              <span>
                <span className="text-sm font-medium flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-navy-600" /> Generate presenter videos (HeyGen)
                </span>
                <span className="block text-xs text-slate-500 mt-0.5">
                  Creates a narrated avatar video for each lesson. Videos render in the background and appear on the course once ready.
                </span>
              </span>
            </label>
            {form.generate_videos && (
              <div className="mt-3 pl-8">
                <PresenterPicker
                  avatarId={form.video_avatar_id}
                  voiceId={form.video_voice_id}
                  onAvatarChange={(v) => set({ video_avatar_id: v })}
                  onVoiceChange={(v) => set({ video_voice_id: v })}
                  disabled={loading}
                  idPrefix="ai-course"
                  notConfiguredHint="The course will still generate — presenter videos will just be skipped."
                />
              </div>
            )}
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-sm text-slate-600 hover:text-slate-900 flex items-center gap-1"
              disabled={loading}
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              More course settings
            </button>
            {showAdvanced && (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white/80 p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="ai-course-passing-score" className="text-sm font-semibold">Passing score (%)</Label>
                    <Input
                      id="ai-course-passing-score"
                      type="number" min="1" max="100"
                      value={form.passing_score}
                      onChange={(e) => set({ passing_score: e.target.value })}
                      className="h-11 mt-1"
                      disabled={loading}
                    />
                  </div>
                  <div>
                    <Label htmlFor="ai-course-certificate-validity" className="text-sm font-semibold">Certificate valid for (months)</Label>
                    <Input
                      id="ai-course-certificate-validity"
                      type="number" min="1" max="120"
                      value={form.certificate_valid_months}
                      onChange={(e) => set({ certificate_valid_months: e.target.value })}
                      className="h-11 mt-1"
                      disabled={loading}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="ai-course-instructions" className="text-sm font-semibold">Extra instructions (optional)</Label>
                  <Textarea
                    id="ai-course-instructions"
                    value={form.custom_instructions}
                    onChange={(e) => set({ custom_instructions: e.target.value })}
                    placeholder="Anything specific to emphasize, cite, or avoid — e.g. 'focus on CMS CoP §484.50 and include a hand-hygiene scenario'."
                    rows={3}
                    className="mt-1"
                    disabled={loading}
                  />
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert className="border-red-200 bg-red-50">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">
                {error}
                {failedDraftId && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2 block"
                    onClick={() => onGenerated?.(failedDraftId)}
                  >
                    Open the draft
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}

          {!isAdminUser && currentUser && (
            <Alert className="border-slate-200 bg-slate-50">
              <AlertDescription className="text-slate-600 text-sm">
                Only administrators can generate courses.
              </AlertDescription>
            </Alert>
          )}

          {loading && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3" role="status">
              <p className="text-sm font-medium text-blue-900">
                {progress
                  ? `Step ${progress.step} of ${progress.totalSteps}: ${progress.label}`
                  : "Starting generation…"}
              </p>
              <p className="text-xs text-blue-700 mt-0.5">Keep this page open. HeyGen videos continue rendering in the background after the draft is ready.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
