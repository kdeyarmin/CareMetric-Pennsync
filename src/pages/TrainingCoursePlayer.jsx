import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, RotateCcw, Award, ChevronRight, ChevronLeft,
  BookOpen, Clock, Star, FileText, Send, Eye, RefreshCw, Home,
  Check, Target, AlertCircle, Timer, GraduationCap
} from "lucide-react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import LoadingState from "@/components/ui/LoadingState";
import { base44 } from "@/api/base44Client";
import { createPageUrl } from "@/utils";
import { gradeTrainingAttempt } from "@/functions/gradeTrainingAttempt";
import { startTrainingAssignment } from "@/functions/startTrainingAssignment";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import TrainingModuleViewer from "@/components/training/TrainingModuleViewer";
import TrainingQuestionRenderer from "@/components/training/TrainingQuestionRenderer";
import CertificateDownloadButton from "@/components/training/CertificateDownloadButton";
import CourseStepIndicator from "@/components/training/CourseStepIndicator";

// Fisher-Yates shuffle for unbiased randomization
const shuffle = (items) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const STEP_PROGRESS = {
  objectives: 5, content: 40, attestation: 75, test: 80, result: 100,
};

const formatElapsed = (ms) => {
  const totalMin = Math.floor(ms / 60000);
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
};

export default function TrainingCoursePlayer() {
  const navigate = useNavigate();
  const params = new URLSearchParams(window.location.search);
  const assignmentId = params.get("assignment");
  const courseId = params.get("courseId");
  const previewMode = params.get("preview") === "true";

  const [step, setStep] = useState("objectives");
  const [completedModules, setCompletedModules] = useState([]);
  const [activeModuleIndex, setActiveModuleIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [attestationAccepted, setAttestationAccepted] = useState(false);
  const [signedName, setSignedName] = useState("");
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [startTime] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [submitError, setSubmitError] = useState("");
  const topRef = useRef(null);

  const startedAt = useMemo(() => new Date().toISOString(), []);

  useEffect(() => {
    if (assignmentId && !previewMode) startTrainingAssignment({ assignmentId });
  }, [assignmentId, previewMode]);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [step]);

  // Elapsed time tracker
  useEffect(() => {
    if (step === "result") return;
    setElapsed(Date.now() - startTime);
    const interval = setInterval(() => setElapsed(Date.now() - startTime), 10000);
    return () => clearInterval(interval);
  }, [startTime, step]);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const { data: assignment, isLoading: assignmentLoading, isFetched: assignmentFetched } = useQuery({
    queryKey: ["training-assignment", assignmentId],
    queryFn: async () => (await base44.entities.TrainingAssignment.filter({ id: assignmentId }))[0],
    enabled: !!assignmentId && !previewMode,
  });
  const activeCourseId = previewMode ? courseId : assignment?.course_id;
  const { data: course, isLoading: courseLoading, isFetched: courseFetched } = useQuery({
    queryKey: ["training-course", previewMode ? courseId : assignment?.course_id],
    queryFn: async () => (await base44.entities.TrainingCourse.filter({ id: activeCourseId }))[0],
    enabled: !!activeCourseId,
  });
  const { data: rawModules = [] } = useQuery({
    queryKey: ["training-modules", previewMode ? courseId : assignment?.course_id],
    queryFn: () => base44.entities.TrainingModule.filter({ course_id: previewMode ? courseId : assignment?.course_id }, "order_index", 100),
    enabled: !!(previewMode ? courseId : assignment?.course_id),
    initialData: [],
  });
  const { data: questions = [] } = useQuery({
    queryKey: ["training-questions", previewMode ? courseId : assignment?.course_id],
    queryFn: () => base44.entities.TrainingQuestion.filter({ course_id: previewMode ? courseId : assignment?.course_id, active: true }, "order_index", 200),
    enabled: !!(previewMode ? courseId : assignment?.course_id),
    initialData: [],
  });

  const modules = useMemo(() => {
    if (rawModules.length > 0) return rawModules;
    if (!course) return [];
    return [{
      id: "fallback",
      title: course.title,
      type: "lesson",
      content_json: {
        intro: course.description,
        sections: [],
        case_scenarios: [],
        key_takeaways: [],
      },
      attachment_urls: [],
      attachment_names: [],
    }];
  }, [rawModules, course]);

  const randomizedQuestions = useMemo(
    () => shuffle(questions).map((q) => ({
      ...q,
      options_json: Array.isArray(q.options_json) ? shuffle(q.options_json) : q.options_json,
    })),
    [questions]
  );

  const passingScore = assignment?.passing_score_required || course?.passing_score || 80;
  const isAdmin = currentUser?.role === "admin";
  const answeredCount = Object.keys(answers).length;
  const totalQuestions = randomizedQuestions.length;

  const goToNextModule = () => {
    const nextIndex = activeModuleIndex + 1;
    if (nextIndex < modules.length) {
      setActiveModuleIndex(nextIndex);
      topRef.current?.scrollIntoView({ behavior: "smooth" });
    } else {
      // All modules read — advance step
      const needsAttestation = course?.requires_attestation || assignment?.attestation_required;
      setStep(needsAttestation ? "attestation" : "test");
    }
  };

  const markModuleDone = (moduleId) => {
    const next = completedModules.includes(moduleId)
      ? completedModules
      : [...completedModules, moduleId];
    setCompletedModules(next);
    goToNextModule();
  };

  const submitAttempt = async () => {
    if (previewMode) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const timeSpentMinutes = Math.round((Date.now() - startTime) / 60000);
      const response = await gradeTrainingAttempt({
        assignmentId,
        responses: randomizedQuestions.map((q) => ({ questionId: q.id, answer: answers[q.id] })),
        attestation: {
          acknowledged: attestationAccepted,
          signedName,
          statement: course?.attestation_text,
          deviceMetadata: { userAgent: navigator.userAgent },
        },
        startedAt,
        timeSpentMinutes,
        randomizedQuestionOrder: randomizedQuestions.map((q) => q.id),
      });
      setResult(response.data || response);
      setStep("result");
    } catch (err) {
      setSubmitError(err?.message || "Failed to submit quiz. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const renderUnavailable = (title, message) => (
    <PageContainer>
      <PageHeader
        icon={GraduationCap}
        eyebrow="My Learning"
        title="Course Player"
        favoritePage="TrainingCoursePlayer"
      />
      <Card className="border-amber-200 bg-amber-50">
        <CardContent className="p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-amber-600 mx-auto" />
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            <p className="text-sm text-slate-600 mt-1">{message}</p>
          </div>
          <Button onClick={() => navigate(createPageUrl("LearningCenter"))}>
            Back to Learning Center
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  );

  if (!previewMode && !assignmentId) {
    return renderUnavailable("Missing assignment", "Open this course from your Learning Center assignment list.");
  }
  if (previewMode && !courseId) {
    return renderUnavailable("Missing course", "Open preview mode from a course in Training Manager.");
  }
  if (!previewMode && assignmentLoading) {
    return <LoadingState label="Loading assignment..." className="py-24" />;
  }
  if (!previewMode && assignmentFetched && !assignment) {
    return renderUnavailable("Assignment not found", "This assignment may have been removed or is no longer available.");
  }
  if (courseLoading) {
    return <LoadingState label="Loading course..." className="py-24" />;
  }
  if (activeCourseId && courseFetched && !course) {
    return renderUnavailable("Course not found", "This course may have been removed or is no longer available.");
  }

  const progressValue = STEP_PROGRESS[step] || 0;
  const courseName = previewMode ? course.title : assignment.course_title;

  return (
    <PageContainer>
      <div ref={topRef} />
      <PageHeader
        icon={GraduationCap}
        eyebrow="My Learning"
        title="Course Player"
        favoritePage="TrainingCoursePlayer"
      />
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => navigate(createPageUrl("LearningCenter"))}
          className="text-slate-500 hover:text-blue-600 transition-colors flex items-center gap-1"
        >
          <Home className="w-3.5 h-3.5" /> Learning Center
        </button>
        <span className="text-slate-300">/</span>
        <span className="text-slate-700 font-medium truncate">{courseName}</span>
      </div>

      {/* Preview mode banner */}
      {previewMode && isAdmin && (
        <Alert className="border-indigo-200 bg-indigo-50">
          <Eye className="w-4 h-4 text-indigo-600" />
          <AlertDescription className="text-indigo-900 font-medium">
            Preview Mode — No progress will be saved and submissions are disabled.
          </AlertDescription>
        </Alert>
      )}

      {/* Course header card */}
      <div className="rounded-2xl bg-navy-900 text-white p-4 sm:p-6 shadow-lg">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <p className="text-blue-300 text-xs font-semibold uppercase tracking-wider mb-1">
              {course.category?.replace(/_/g, " ") || "Training Course"}
            </p>
            <h1 className="text-lg sm:text-2xl font-bold leading-tight">{courseName}</h1>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs sm:text-sm text-blue-200">
              {course.estimated_minutes && (
                <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {course.estimated_minutes} min</span>
              )}
              <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" /> Pass at {passingScore}%</span>
              {!previewMode && assignment?.due_date && (
                <span>Due {new Date(assignment.due_date).toLocaleDateString()}</span>
              )}
              {!previewMode && (
                <span>Attempt #{(assignment?.latest_attempt_number || 0) + 1}</span>
              )}
              {elapsed > 60000 && step !== "result" && (
                <span className="flex items-center gap-1"><Timer className="w-3.5 h-3.5" /> {formatElapsed(elapsed)}</span>
              )}
            </div>
          </div>
          {!previewMode && assignment?.pass_fail_result === "passed" && (
            <Badge variant="success" className="gap-1 flex-shrink-0"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Passed</Badge>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-blue-300">
            <span>Course progress</span>
            <span>{progressValue}%</span>
          </div>
          <Progress value={progressValue} className="h-2 bg-white/20 [&>div]:bg-blue-400" />
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
        <CourseStepIndicator step={step} />
      </div>

      {/* ─── STEP: OBJECTIVES ─────────────────────────────────────── */}
      {step === "objectives" && (
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <BookOpen className="w-5 h-5 text-blue-600" />
              Learning Objectives
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-6">
            {course.short_description && (
              <p className="text-slate-600 leading-relaxed text-base">{course.short_description}</p>
            )}
            {(course.learning_objectives || []).length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-slate-700 uppercase tracking-wide">By the end of this course, you will:</p>
                <ul className="space-y-2">
                  {course.learning_objectives.map((obj, i) => (
                    <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-100">
                      <div className="w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </div>
                      <span className="text-slate-700 leading-relaxed">{obj}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Info grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { label: "Modules", value: modules.length || 1 },
                { label: "Questions", value: questions.length || "—" },
                { label: "Passing Score", value: `${passingScore}%` },
                course.estimated_minutes && { label: "Est. Time", value: `${course.estimated_minutes} min` },
                course.ceu_hours && { label: "CEU Hours", value: course.ceu_hours },
                { label: "Certificate", value: course.enable_certificate !== false ? "Issued on pass" : "None" },
              ].filter(Boolean).map((item) => (
                <div key={item.label} className="bg-slate-50 rounded-xl p-3 text-center border border-slate-100">
                  <p className="text-xs text-slate-500 font-medium">{item.label}</p>
                  <p className="text-lg font-bold text-slate-900 mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Attachments */}
            {(course.attachment_urls || []).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-slate-500" /> Course resources
                </p>
                <div className="flex flex-wrap gap-2">
                  {course.attachment_urls.map((url, i) => (
                    <a key={i} href={url} target="_blank" rel="noreferrer"
                      className="text-sm text-blue-600 underline hover:text-blue-800">
                      {course.attachment_names?.[i] || `Resource ${i + 1}`}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Real-world relevance */}
            {course.real_world_relevance && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-4">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-1">Why This Matters Right Now</p>
                <p className="text-sm text-amber-900">{course.real_world_relevance}</p>
              </div>
            )}

            {/* Regulatory crosswalk */}
            {(course.regulatory_crosswalk_json || []).length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="font-semibold text-slate-800 mb-2 text-sm">Regulatory Requirements Addressed</p>
                <div className="space-y-2">
                  {course.regulatory_crosswalk_json.map((reg, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <Badge variant="outline" className="text-xs flex-shrink-0 mt-0.5">{reg.regulation}</Badge>
                      <span className="text-slate-600">{reg.title}{reg.how_this_course_addresses_it ? ` — ${reg.how_this_course_addresses_it}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Competency skills */}
            {(course.competency_skills_json || []).length > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="font-semibold text-emerald-800 mb-2 text-sm">Skills You Will Demonstrate</p>
                <div className="space-y-2">
                  {course.competency_skills_json.map((skill, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="text-emerald-900 font-medium">{skill.skill}</span>
                        {skill.criteria && <span className="text-emerald-700"> — {skill.criteria}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button size="lg" className="w-full sm:w-auto" onClick={() => setStep("content")}>
              Start Course <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP: CONTENT ────────────────────────────────────────── */}
      {step === "content" && (
        <div className="space-y-4">
          {/* Module nav pills */}
          {modules.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {modules.map((mod, i) => (
                <button
                  key={mod.id}
                  onClick={() => setActiveModuleIndex(i)}
                  className={`flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    i === activeModuleIndex
                      ? "bg-blue-600 text-white border-blue-600"
                      : completedModules.includes(mod.id)
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {completedModules.includes(mod.id) ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    <span className="w-5 h-5 rounded-full bg-current/10 flex items-center justify-center text-xs">{i + 1}</span>
                  )}
                  <span className="max-w-[120px] truncate">{mod.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Active module */}
          {modules[activeModuleIndex] && (
            <div className="space-y-4">
              <TrainingModuleViewer module={modules[activeModuleIndex]} />

              {/* Module attachments */}
              {(modules[activeModuleIndex].attachment_urls || []).length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="font-semibold text-slate-800 mb-2 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-slate-500" /> Module attachments
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {modules[activeModuleIndex].attachment_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer"
                        className="text-sm text-blue-600 underline hover:text-blue-800">
                        {modules[activeModuleIndex].attachment_names?.[i] || `File ${i + 1}`}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Navigation row */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <Button variant="outline" onClick={() => setActiveModuleIndex(Math.max(0, activeModuleIndex - 1))}
                  disabled={activeModuleIndex === 0}>
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </Button>

                <div className="text-sm text-slate-500">
                  {activeModuleIndex + 1} of {modules.length}
                </div>

                <Button
                  onClick={() => markModuleDone(modules[activeModuleIndex].id)}
                  className={completedModules.includes(modules[activeModuleIndex].id) ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                >
                  {completedModules.includes(modules[activeModuleIndex].id) ? (
                    <><Check className="w-4 h-4 mr-1" /> Done — Next</>
                  ) : activeModuleIndex === modules.length - 1 ? (
                    <>Continue to Quiz <ChevronRight className="w-4 h-4 ml-1" /></>
                  ) : (
                    <>Mark Complete & Next <ChevronRight className="w-4 h-4 ml-1" /></>
                  )}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── STEP: ATTESTATION ────────────────────────────────────── */}
      {step === "attestation" && (
        <Card className="border-0 shadow-md">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-slate-900">Acknowledgement & Attestation</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                {course.attestation_text || "I have reviewed and understand this training and agree to follow agency policy."}
              </AlertDescription>
            </Alert>

            <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-200 bg-slate-50">
              <Checkbox
                id="attest-check"
                checked={attestationAccepted}
                onCheckedChange={(v) => setAttestationAccepted(!!v)}
                className="mt-0.5"
              />
              <Label htmlFor="attest-check" className="font-normal leading-6 cursor-pointer">
                I confirm that I have read, reviewed, and understood the content of this course and agree to apply it in my practice.
              </Label>
            </div>

            <div className="space-y-2">
              <Label className="font-semibold">Electronic Signature — Type your full legal name</Label>
              <Input
                value={signedName}
                onChange={(e) => setSignedName(e.target.value)}
                placeholder={currentUser?.full_name || "Your full name"}
                className="text-base"
              />
              <p className="text-xs text-slate-500">By typing your name above, you are providing an electronic signature.</p>
            </div>

            <Button
              size="lg"
              disabled={!attestationAccepted || !signedName.trim()}
              onClick={() => setStep("test")}
              className="w-full sm:w-auto"
            >
              Proceed to Quiz <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── STEP: TEST ───────────────────────────────────────────── */}
      {step === "test" && (
        <div className="space-y-4">
          {/* Test header */}
          <Card className="border-0 shadow-sm bg-blue-50 border border-blue-100">
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1">
                <h2 className="font-bold text-blue-900">Competency Assessment</h2>
                <p className="text-sm text-blue-700 mt-0.5">
                  Answer all {totalQuestions} questions to submit. You need {passingScore}% to pass.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-center">
                  <p className="text-2xl font-bold text-blue-900">{answeredCount}/{totalQuestions}</p>
                  <p className="text-xs text-blue-600">Answered</p>
                </div>
                <div className="w-16 h-16">
                  <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#dbeafe" strokeWidth="3" />
                    <circle
                      cx="18" cy="18" r="15.9" fill="none"
                      stroke="#264491" strokeWidth="3"
                      strokeDasharray={`${totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0} 100`}
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          {previewMode && (
            <Alert className="border-indigo-200 bg-indigo-50">
              <Eye className="w-4 h-4 text-indigo-600" />
              <AlertDescription className="text-indigo-900">
                Preview mode — You can review questions but submissions are disabled.
              </AlertDescription>
            </Alert>
          )}

          {/* Questions */}
          <div className="space-y-4">
            {randomizedQuestions.map((question, index) => (
              <TrainingQuestionRenderer
                key={question.id}
                question={question}
                index={index}
                value={answers[question.id]}
                onChange={(answer) => setAnswers((prev) => ({ ...prev, [question.id]: answer }))}
              />
            ))}
          </div>

          {/* Submit error */}
          {submitError && (
            <Alert className="border-red-200 bg-red-50">
              <AlertCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-800">{submitError}</AlertDescription>
            </Alert>
          )}

          {/* Submit button */}
          <div className="sticky bottom-3 sm:bottom-4 z-10">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-xl p-4 flex flex-col sm:flex-row items-center gap-3">
              <div className="flex-1 text-sm text-slate-600">
                {answeredCount < totalQuestions
                  ? <span className="text-amber-600 font-medium flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" />{totalQuestions - answeredCount} question(s) unanswered</span>
                  : <span className="text-emerald-600 font-medium flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" />All questions answered — ready to submit!</span>
                }
              </div>
              <Button
                size="lg"
                disabled={previewMode || submitting || answeredCount < totalQuestions}
                onClick={submitAttempt}
                className="w-full sm:w-auto min-w-[160px]"
              >
                {submitting ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Submitting...</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" />Submit Quiz</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP: RESULT ─────────────────────────────────────────── */}
      {step === "result" && result && (
        <div className="space-y-4">
          {/* Pass/Fail hero — plain wrapper so the status background isn't
              overridden by Card's default bg-white. */}
          <div className={`rounded-xl shadow-lg p-8 text-center space-y-3 text-white ${result.passed ? "bg-emerald-600" : "bg-red-700"}`}>
            {result.passed ? (
              <CheckCircle2 className="w-16 h-16 mx-auto opacity-90" />
            ) : (
              <RotateCcw className="w-16 h-16 mx-auto opacity-90" />
            )}
            <h2 className="text-3xl font-extrabold">{result.passed ? "You Passed!" : "Not Quite Yet"}</h2>
            <p className="text-lg opacity-90">
              Score: <strong>{result.score}%</strong> &nbsp;•&nbsp; Passing: {result.passing_score}%
            </p>
          </div>

          {/* Certificate */}
          {result.passed && result.certificate && (
            <Card className="border-emerald-200 bg-emerald-50 shadow-sm">
              <CardContent className="p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <Award className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="font-bold text-emerald-900">Certificate Issued</p>
                    <p className="text-sm text-emerald-700">
                      ID: {result.certificate.certificate_id}
                      {result.certificate.expiration_date && ` · Expires ${new Date(result.certificate.expiration_date).toLocaleDateString()}`}
                    </p>
                    {result.certificate.hours && (
                      <p className="text-sm text-emerald-700">{result.certificate.hours} CEU hours awarded</p>
                    )}
                  </div>
                </div>
                <CertificateDownloadButton certificate={result.certificate} size="default" />
              </CardContent>
            </Card>
          )}

          {/* Remediation message */}
          {!result.passed && result.remediation_message && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900">{result.remediation_message}</AlertDescription>
            </Alert>
          )}

          {/* Score breakdown */}
          {result.show_correct_answers && result.graded_answers?.length > 0 && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="border-b border-slate-100">
                <CardTitle className="text-base">Answer Review</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                {result.graded_answers.map((item, i) => (
                  <div key={i} className={`rounded-xl border p-4 text-sm ${item.points_earned === item.points_possible ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <p className="font-semibold text-slate-900">{item.prompt}</p>
                      <Badge className={item.points_earned === item.points_possible ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}>
                        {item.points_earned}/{item.points_possible} pts
                      </Badge>
                    </div>
                    <p className="text-slate-600">Your answer: <span className="font-medium">{
                      Array.isArray(item.answer) ? item.answer.join(', ')
                      : typeof item.answer === 'object' && item.answer !== null ? Object.entries(item.answer).map(([k, v]) => `${k} → ${v}`).join(', ')
                      : String(item.answer ?? '—')
                    }</span></p>
                    {item.rationale && <p className="text-slate-500 mt-1">Rationale: {item.rationale}</p>}
                    {item.ai_feedback && <p className="text-slate-500 mt-1 italic">{item.ai_feedback}</p>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => navigate(createPageUrl("LearningCenter") + "?tab=courses")}>
              <Home className="w-4 h-4 mr-2" /> Back to My Courses
            </Button>
            {!result.passed && !result.locked && (
              <Button
                onClick={() => {
                  setStep("content");
                  setAnswers({});
                  setResult(null);
                  setCompletedModules([]);
                  setActiveModuleIndex(0);
                  setAttestationAccepted(false);
                  setSignedName("");
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" /> Review Content & Retake
              </Button>
            )}
            {result.passed && (
              <Button variant="outline" onClick={() => navigate(createPageUrl("LearningCenter") + "?tab=transcripts")}>
                <Star className="w-4 h-4 mr-2" /> View All Certificates
              </Button>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
