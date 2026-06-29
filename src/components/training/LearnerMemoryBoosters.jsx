import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, CheckCircle2, XCircle, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

// Spaced-repetition "memory boosters" (Relias-style). For each in-service the
// learner has PASSED, we resurface a short 3-question review at growing
// intervals (30 / 90 / 180 days after completion) to reinforce retention.
// Each completed booster is recorded as a MicroLearningProgress row, which also
// marks that interval done so it isn't shown again.
const INTERVALS = [30, 90, 180];
const daysAgo = (d) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / (1000 * 60 * 60 * 24)) : 0);

// The booster interval that is currently due for a completed course given the
// intervals already recorded. Returns null if nothing is due yet.
const dueInterval = (completedDaysAgo, doneIntervals) => {
  for (const iv of INTERVALS) {
    if (completedDaysAgo >= iv && !doneIntervals.includes(iv)) return iv;
  }
  return null;
};

const sample = (arr, n) => {
  // Deterministic-ish pick without Math.random in module scope: rotate by length.
  const copy = [...arr];
  return copy.slice(0, n);
};

function MicroQuiz({ questions, onComplete, submitting }) {
  const [answers, setAnswers] = useState({});
  const [graded, setGraded] = useState(null);

  const isCorrect = (q, val) => {
    const correct = q.correct_answer_json?.answer;
    if (Array.isArray(correct)) {
      const set = new Set((val || []).map(String));
      return correct.length === set.size && correct.every((c) => set.has(String(c)));
    }
    return String(val) === String(correct);
  };

  const submit = () => {
    let correctCount = 0;
    questions.forEach((q) => { if (isCorrect(q, answers[q.id])) correctCount++; });
    const score = Math.round((correctCount / questions.length) * 100);
    setGraded({ score, correctCount });
    onComplete(score);
  };

  const toggleMulti = (qid, value) => {
    setAnswers((prev) => {
      const cur = new Set(prev[qid] || []);
      if (cur.has(value)) cur.delete(value); else cur.add(value);
      return { ...prev, [qid]: [...cur] };
    });
  };

  return (
    <div className="space-y-4">
      {questions.map((q, idx) => {
        const multi = q.type === "multi_select";
        const options = q.type === "true_false"
          ? [{ value: true, label: "True" }, { value: false, label: "False" }]
          : (q.options_json || []);
        const correct = graded && isCorrect(q, answers[q.id]);
        return (
          <div key={q.id} className="rounded-xl border p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium text-slate-900 text-sm">{idx + 1}. {q.prompt}</p>
              {graded && (correct ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" /> : <XCircle className="w-4 h-4 text-red-600 flex-shrink-0" />)}
            </div>
            <div className="mt-3 space-y-2">
              {options.map((opt) => {
                const val = opt.value;
                const checked = multi ? (answers[q.id] || []).map(String).includes(String(val)) : String(answers[q.id]) === String(val);
                return (
                  <label key={String(val)} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type={multi ? "checkbox" : "radio"}
                      name={`q-${q.id}`}
                      checked={checked}
                      disabled={!!graded}
                      onChange={() => multi ? toggleMulti(q.id, val) : setAnswers((p) => ({ ...p, [q.id]: val }))}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
            {graded && q.rationale && <p className="mt-2 text-xs text-slate-500">{q.rationale}</p>}
          </div>
        );
      })}
      {graded ? (
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Sparkles className="w-4 h-4 text-indigo-600" />
          You scored {graded.score}% ({graded.correctCount}/{questions.length}). Nice refresher!
        </div>
      ) : (
        <Button onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          Submit review
        </Button>
      )}
    </div>
  );
}

export default function LearnerMemoryBoosters() {
  const queryClient = useQueryClient();
  const [openCourseId, setOpenCourseId] = useState(null);
  const [boosterQuestions, setBoosterQuestions] = useState([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const email = currentUser?.email;

  const { data: assignments = [] } = useQuery({
    queryKey: ["my-assignments", email],
    queryFn: () => base44.entities.TrainingAssignment.filter({ assigned_to_user_id: email }, "-completion_date", 500),
    enabled: !!email,
    initialData: [],
  });

  const { data: progress = [] } = useQuery({
    queryKey: ["my-booster-progress", email],
    queryFn: () => base44.entities.MicroLearningProgress.filter({ nurse_email: email }, "-created_date", 1000),
    enabled: !!email,
    initialData: [],
  });

  // Booster history is recorded with skill_gap_id = `booster:<courseId>:<interval>`.
  const doneByCourse = useMemo(() => {
    const map = {};
    for (const p of progress) {
      const id = p.skill_gap_id || "";
      if (!id.startsWith("booster:")) continue;
      const [, courseId, iv] = id.split(":");
      (map[courseId] = map[courseId] || []).push(Number(iv));
    }
    return map;
  }, [progress]);

  const dueBoosters = useMemo(() => {
    const passed = assignments.filter((a) => (a.pass_fail_result === "passed" || a.status === "completed") && a.completion_date);
    // De-dupe to the most recent completion per course.
    const byCourse = {};
    for (const a of passed) {
      if (!byCourse[a.course_id] || new Date(a.completion_date) > new Date(byCourse[a.course_id].completion_date)) byCourse[a.course_id] = a;
    }
    return Object.values(byCourse)
      .map((a) => ({ assignment: a, interval: dueInterval(daysAgo(a.completion_date), doneByCourse[a.course_id] || []) }))
      .filter((x) => x.interval !== null);
  }, [assignments, doneByCourse]);

  const openBooster = async (courseId) => {
    setOpenCourseId(courseId);
    setBoosterQuestions([]);
    setLoadingQuestions(true);
    try {
      const qs = await base44.entities.TrainingQuestion.filter({ course_id: courseId, active: true }, "order_index", 50);
      setBoosterQuestions(sample(qs, 3));
    } catch (err) {
      toast.error("Could not load review questions");
      console.error(err);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const completeBooster = async (item, score) => {
    setSubmitting(true);
    try {
      await base44.entities.MicroLearningProgress.create({
        nurse_email: email,
        skill_gap_id: `booster:${item.assignment.course_id}:${item.interval}`,
        skill_area: item.assignment.course_title || "Required in-service",
        module_type: "quiz",
        status: "completed",
        score,
        attempts: 1,
        source: "manual",
        notes: `${item.interval}-day spaced retention booster.`,
      });
      toast.success("Booster recorded");
      queryClient.invalidateQueries({ queryKey: ["my-booster-progress", email] });
    } catch (err) {
      toast.error("Failed to record booster");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-indigo-200 bg-indigo-50/40">
        <CardContent className="p-5 flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Memory Boosters</h2>
            <p className="text-sm text-slate-600">
              Quick spaced-repetition reviews of in-services you&apos;ve already passed, resurfaced at 30, 90, and 180 days to keep the key points fresh — the science-backed way to retain compliance training.
            </p>
          </div>
        </CardContent>
      </Card>

      {dueBoosters.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-slate-500">No boosters due right now. Come back after you&apos;ve completed more in-services — we&apos;ll resurface them automatically.</CardContent></Card>
      ) : (
        dueBoosters.map((item) => (
          <Card key={item.assignment.course_id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-base">{item.assignment.course_title}</CardTitle>
                <Badge className="bg-indigo-100 text-indigo-800">{item.interval}-day review</Badge>
              </div>
            </CardHeader>
            <CardContent>
              {openCourseId === item.assignment.course_id ? (
                loadingQuestions ? (
                  <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-indigo-600" /></div>
                ) : boosterQuestions.length === 0 ? (
                  <p className="text-sm text-slate-500">No review questions are available for this course yet.</p>
                ) : (
                  <MicroQuiz
                    questions={boosterQuestions}
                    submitting={submitting}
                    onComplete={(score) => completeBooster(item, score)}
                  />
                )
              ) : (
                <Button variant="outline" onClick={() => openBooster(item.assignment.course_id)}>
                  <Brain className="w-4 h-4 mr-2" />Start 3-question review
                </Button>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
