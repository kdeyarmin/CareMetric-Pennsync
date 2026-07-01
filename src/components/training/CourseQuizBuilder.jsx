import { useEffect, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, CheckCircle2, AlertCircle, HelpCircle,
} from "lucide-react";

// Stable local ids (Math.random / Date.now are unavailable in some envs).
let localSeq = 0;
const nextLocalId = () => `q-${localSeq++}`;
const newOptionValue = () => `opt-${localSeq++}`;

const CHOICE_TYPES = new Set(["mcq", "multi_select"]);

const blankOption = (correct = false) => ({ _localId: nextLocalId(), value: newOptionValue(), label: "", correct });

const blankQuestion = () => ({
  _localId: nextLocalId(),
  type: "mcq",
  prompt: "",
  points: 1,
  rationale: "",
  options: [blankOption(true), blankOption(false)],
  correctBool: true,
});

// Map a persisted TrainingQuestion into the editor's working shape, deriving the
// "correct" flags from correct_answer_json so reloads round-trip faithfully.
export const questionToItem = (q) => {
  const answer = q.correct_answer_json?.answer;
  const options = (Array.isArray(q.options_json) ? q.options_json : []).map((o) => {
    const value = o.value ?? o.label ?? "";
    const correct =
      q.type === "multi_select"
        ? Array.isArray(answer) && answer.includes(value)
        : answer === value;
    return { _localId: nextLocalId(), value, label: o.label ?? String(value), correct };
  });
  return {
    _localId: nextLocalId(),
    id: q.id,
    type: q.type || "mcq",
    prompt: q.prompt || "",
    points: q.points || 1,
    rationale: q.rationale || "",
    options: options.length ? options : [blankOption(true), blankOption(false)],
    correctBool: answer === true,
  };
};

// Serialize a working question into TrainingQuestion fields the grader reads.
export const itemToPayload = (item, courseId, orderIndex) => {
  const base = {
    course_id: courseId,
    type: item.type,
    prompt: item.prompt,
    points: Number(item.points) || 1,
    rationale: item.rationale || "",
    order_index: orderIndex,
    active: true,
  };
  if (item.type === "mcq") {
    const correct = item.options.find((o) => o.correct) || item.options[0];
    return {
      ...base,
      options_json: item.options.map((o) => ({ value: o.value, label: o.label })),
      correct_answer_json: { answer: correct?.value ?? "" },
    };
  }
  if (item.type === "multi_select") {
    return {
      ...base,
      options_json: item.options.map((o) => ({ value: o.value, label: o.label })),
      correct_answer_json: { answer: item.options.filter((o) => o.correct).map((o) => o.value) },
    };
  }
  if (item.type === "true_false") {
    return {
      ...base,
      options_json: [],
      correct_answer_json: { answer: item.correctBool === true },
    };
  }
  // short_answer / scenario_based — AI graded, no fixed answer.
  return { ...base, options_json: [], correct_answer_json: {} };
};

export default function CourseQuizBuilder({ courseId }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const seededFor = useRef(null);

  const { data: questions = [], isLoading } = useQuery({
    queryKey: ["training-questions", courseId],
    queryFn: () =>
      base44.entities.TrainingQuestion.filter({ course_id: courseId, active: true }, "order_index", 200),
    enabled: !!courseId,
    initialData: [],
  });

  useEffect(() => {
    if (!courseId || seededFor.current === courseId) return;
    if (isLoading) return;
    setItems(questions.map(questionToItem));
    seededFor.current = courseId;
  }, [courseId, isLoading, questions]);

  const updateItem = (localId, patch) =>
    setItems((prev) => prev.map((it) => (it._localId === localId ? { ...it, ...patch } : it)));

  const move = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= items.length) return;
    setItems((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const changeType = (localId, type) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it._localId !== localId) return it;
        const next = { ...it, type };
        if (CHOICE_TYPES.has(type) && (!it.options || it.options.length < 2)) {
          next.options = [blankOption(true), blankOption(false)];
        }
        return next;
      })
    );
  };

  const updateOption = (itemId, optionId, patch) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? { ...it, options: it.options.map((o) => (o._localId === optionId ? { ...o, ...patch } : o)) }
          : it
      )
    );

  // Single-correct for mcq: selecting one clears the others.
  const setCorrectOption = (itemId, optionId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? {
              ...it,
              options: it.options.map((o) => ({ ...o, correct: o._localId === optionId })),
            }
          : it
      )
    );

  const toggleCorrectOption = (itemId, optionId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? {
              ...it,
              options: it.options.map((o) =>
                o._localId === optionId ? { ...o, correct: !o.correct } : o
              ),
            }
          : it
      )
    );

  const addOption = (itemId) =>
    setItems((prev) =>
      prev.map((it) => (it._localId === itemId ? { ...it, options: [...it.options, blankOption(false)] } : it))
    );

  const removeOption = (itemId, optionId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? { ...it, options: it.options.filter((o) => o._localId !== optionId) }
          : it
      )
    );

  const saveAll = async () => {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const usable = items.filter((it) => it.prompt.trim());

      // Validate choice questions have a marked correct answer.
      const invalid = usable.find(
        (it) => CHOICE_TYPES.has(it.type) && !it.options.some((o) => o.correct)
      );
      if (invalid) {
        setError("Each multiple-choice question needs at least one correct answer marked.");
        setSaving(false);
        return;
      }

      // Delete questions removed from the list.
      const keptIds = new Set(usable.filter((it) => it.id).map((it) => it.id));
      const toDelete = questions.filter((q) => !keptIds.has(q.id));
      await Promise.all(toDelete.map((q) => base44.entities.TrainingQuestion.delete(q.id)));

      await Promise.all(
        usable.map((item, index) => {
          const payload = itemToPayload(item, courseId, index);
          return item.id
            ? base44.entities.TrainingQuestion.update(item.id, payload)
            : base44.entities.TrainingQuestion.create(payload);
        })
      );

      await queryClient.invalidateQueries({ queryKey: ["training-questions", courseId] });
      seededFor.current = null;
      setSaved(true);
    } catch (err) {
      console.error("Quiz save error:", err);
      setError(err?.message || "Failed to save quiz. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  if (!courseId) {
    return (
      <Alert className="border-slate-200 bg-slate-50">
        <AlertCircle className="w-4 h-4 text-slate-500" />
        <AlertDescription className="text-slate-600">
          Save the course details first, then add quiz questions.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Questions are graded automatically (multiple choice) or by AI (short answer).
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => setItems((prev) => [...prev, blankQuestion()])}>
          <Plus className="w-4 h-4 mr-1" /> Add Question
        </Button>
      </div>

      {items.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center">
            <HelpCircle className="w-10 h-10 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500">No questions yet. Add your first question.</p>
          </CardContent>
        </Card>
      )}

      {items.map((item, index) => (
        <Card key={item._localId} className="border-slate-200">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Question {index + 1}
              </span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)}>
                  <ChevronUp className="w-4 h-4" />
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={index === items.length - 1} onClick={() => move(index, 1)}>
                  <ChevronDown className="w-4 h-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((prev) => prev.filter((it) => it._localId !== item._localId))}
                >
                  <Trash2 className="w-4 h-4 text-red-600" />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
              <div>
                <Label className="text-sm font-semibold">Type</Label>
                <Select value={item.type} onValueChange={(v) => changeType(item._localId, v)}>
                  <SelectTrigger className="h-10 mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ zIndex: 9999 }}>
                    <SelectItem value="mcq">Multiple Choice</SelectItem>
                    <SelectItem value="multi_select">Select All That Apply</SelectItem>
                    <SelectItem value="true_false">True / False</SelectItem>
                    <SelectItem value="short_answer">Short Answer (AI graded)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm font-semibold">Points</Label>
                <Input
                  type="number"
                  min="1"
                  value={item.points}
                  onChange={(e) => updateItem(item._localId, { points: e.target.value })}
                  className="h-10 mt-1"
                />
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold">Question Prompt</Label>
              <Textarea
                value={item.prompt}
                onChange={(e) => updateItem(item._localId, { prompt: e.target.value })}
                placeholder="Enter the question"
                rows={2}
                className="mt-1"
              />
            </div>

            {/* Choice options */}
            {CHOICE_TYPES.has(item.type) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Answer Options{" "}
                    <span className="font-normal text-slate-400">
                      ({item.type === "mcq" ? "select one correct" : "check all correct"})
                    </span>
                  </Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => addOption(item._localId)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Option
                  </Button>
                </div>
                {item.options.map((option) => (
                  <div key={option._localId} className="flex items-center gap-2">
                    <input
                      type={item.type === "mcq" ? "radio" : "checkbox"}
                      name={`correct-${item._localId}`}
                      checked={!!option.correct}
                      onChange={() =>
                        item.type === "mcq"
                          ? setCorrectOption(item._localId, option._localId)
                          : toggleCorrectOption(item._localId, option._localId)
                      }
                      className="w-5 h-5 flex-shrink-0"
                      aria-label="Mark correct"
                    />
                    <Input
                      value={option.label}
                      onChange={(e) => updateOption(item._localId, option._localId, { label: e.target.value })}
                      placeholder="Option text"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={item.options.length <= 2}
                      onClick={() => removeOption(item._localId, option._localId)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {/* True / False */}
            {item.type === "true_false" && (
              <div>
                <Label className="text-sm font-semibold">Correct Answer</Label>
                <Select
                  value={item.correctBool ? "true" : "false"}
                  onValueChange={(v) => updateItem(item._localId, { correctBool: v === "true" })}
                >
                  <SelectTrigger className="h-10 mt-1 w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent style={{ zIndex: 9999 }}>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {item.type === "short_answer" && (
              <p className="text-xs text-slate-500 italic">
                Short-answer responses are evaluated by AI against the prompt and rationale.
              </p>
            )}

            <div>
              <Label className="text-sm font-semibold">Rationale / Explanation (optional)</Label>
              <Textarea
                value={item.rationale}
                onChange={(e) => updateItem(item._localId, { rationale: e.target.value })}
                placeholder="Why the correct answer is correct"
                rows={2}
                className="mt-1"
              />
            </div>
          </CardContent>
        </Card>
      ))}

      {error && (
        <Alert className="border-red-200 bg-red-50">
          <AlertCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center gap-3 pt-2">
        <Button type="button" onClick={saveAll} disabled={saving}>
          {saving ? (
            <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Saving...</>
          ) : (
            "Save Quiz"
          )}
        </Button>
        {saved && !saving && (
          <span className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="w-4 h-4" /> Quiz saved
          </span>
        )}
      </div>
    </div>
  );
}
