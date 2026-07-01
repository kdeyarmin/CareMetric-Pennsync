import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useCourseContentBuilder } from "./useCourseContentBuilder";
import { generateCourseQuiz } from "@/functions/generateCourseQuiz";
import { configNotReadyMessage } from "@/lib/aiFeatureError";
import { toast } from "sonner";
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
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, CheckCircle2, AlertCircle, HelpCircle, GripVertical, Sparkles,
} from "lucide-react";
import { DragDropContext, Droppable, Draggable } from "@hello-pangea/dnd";

// Stable local ids (Math.random / Date.now are unavailable in some envs).
let localSeq = 0;
const nextLocalId = () => `q-${localSeq++}`;
const newOptionValue = () => `opt-${localSeq++}`;

const CHOICE_TYPES = new Set(["mcq", "multi_select"]);

const blankOption = (correct = false) => ({ _localId: nextLocalId(), value: newOptionValue(), label: "", correct });

const blankPair = () => ({ _localId: nextLocalId(), left: "", rightText: "" });

const blankQuestion = () => ({
  _localId: nextLocalId(),
  type: "mcq",
  prompt: "",
  points: 1,
  rationale: "",
  rubric: "",
  options: [blankOption(true), blankOption(false)],
  correctBool: true,
  pairs: [blankPair(), blankPair()],
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
  // Reconstruct matching pairs by mapping each stored right-value back to its label.
  const labelByValue = Object.fromEntries(
    (Array.isArray(q.options_json) ? q.options_json : []).map((o) => [o.value ?? o.label, o.label])
  );
  const pairs = (Array.isArray(answer?.pairs) ? answer.pairs : []).map((p) => ({
    _localId: nextLocalId(),
    left: p.left || "",
    rightText: labelByValue[p.right] ?? String(p.right ?? ""),
  }));

  return {
    _localId: nextLocalId(),
    id: q.id,
    type: q.type || "mcq",
    prompt: q.prompt || "",
    points: q.points || 1,
    rationale: q.rationale || "",
    rubric: q.rubric || "",
    options: options.length ? options : [blankOption(true), blankOption(false)],
    correctBool: answer === true,
    pairs: pairs.length ? pairs : [blankPair(), blankPair()],
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
    // rubric drives AI grading of short_answer/scenario responses; harmless on
    // objective types.
    rubric: item.rubric || "",
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
  if (item.type === "matching") {
    // Each left is matched to a right. Build the option pool from the distinct
    // right texts so every correct answer is selectable, and store pairs as
    // { left, right: optionValue } — the shape the renderer and grader expect.
    const pairs = (item.pairs || []).filter((p) => p.left.trim() && p.rightText.trim());
    const rightLabels = [...new Set(pairs.map((p) => p.rightText.trim()))];
    const valueByLabel = {};
    const options_json = rightLabels.map((label, i) => {
      const value = `m-${i}`;
      valueByLabel[label] = value;
      return { value, label };
    });
    return {
      ...base,
      options_json,
      correct_answer_json: {
        answer: { pairs: pairs.map((p) => ({ left: p.left.trim(), right: valueByLabel[p.rightText.trim()] })) },
      },
    };
  }
  // short_answer / scenario_based — AI graded, no fixed answer.
  return { ...base, options_json: [], correct_answer_json: {} };
};

// Returns an error message if the persisted questions are invalid, else null.
const validateQuestions = (usable) => {
  // Choice questions need at least two real (non-blank) options, else the learner
  // UI renders an unusable question.
  const tooFewOptions = usable.find(
    (it) => CHOICE_TYPES.has(it.type) && it.options.filter((o) => (o.label || "").trim()).length < 2
  );
  if (tooFewOptions) return "Multiple-choice questions need at least two answer options with text.";

  const invalid = usable.find(
    (it) => CHOICE_TYPES.has(it.type) && !it.options.some((o) => o.correct && (o.label || "").trim())
  );
  if (invalid) return "Each multiple-choice question needs at least one correct answer marked.";

  const badMatching = usable.find(
    (it) => it.type === "matching" && !(it.pairs || []).some((p) => p.left.trim() && p.rightText.trim())
  );
  if (badMatching) return "Each matching question needs at least one complete left/right pair.";

  // The learner's answer is keyed by left-prompt text, so duplicate left prompts
  // within one matching question collide and can never all be graded correct.
  const dupLeft = usable.find((it) => {
    if (it.type !== "matching") return false;
    const lefts = (it.pairs || []).map((p) => p.left.trim().toLowerCase()).filter(Boolean);
    return new Set(lefts).size !== lefts.length;
  });
  if (dupLeft) return "Matching questions can't reuse the same left prompt twice — make each left unique.";

  return null;
};

export default function CourseQuizBuilder({ courseId }) {
  const { items, setItems, saving, saved, error, setError, move, onDragEnd, saveAll } = useCourseContentBuilder({
    courseId,
    queryKey: ["training-questions", courseId],
    queryFn: () =>
      base44.entities.TrainingQuestion.filter({ course_id: courseId, active: true }, "order_index", 200),
    entity: base44.entities.TrainingQuestion,
    toItem: questionToItem,
    toPayload: (item, index) => itemToPayload(item, courseId, index),
    // Only questions with a prompt are persisted; a blanked-out existing question
    // is therefore treated as removed and deleted.
    shouldPersist: (it) => it.prompt.trim(),
    validate: validateQuestions,
    notReadyMessage: "Questions are still loading. Please try again in a moment.",
    saveErrorMessage: "Failed to save quiz. Please try again.",
  });

  // AI: draft questions from the course's lessons. The generated questions are
  // appended to the local list (not persisted) so the admin reviews and edits
  // them before hitting Save Quiz.
  const [aiCount, setAiCount] = useState(5);
  const [aiLoading, setAiLoading] = useState(false);
  const draftWithAI = async () => {
    setAiLoading(true);
    setError("");
    try {
      const res = await generateCourseQuiz({ course_id: courseId, question_count: Number(aiCount) || 5 });
      const data = res?.data || res;
      if (!data?.success || !Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error(data?.error || "No questions were generated.");
      }
      setItems((prev) => [...prev, ...data.questions.map(questionToItem)]);
      toast.success(`Added ${data.questions.length} AI-drafted question${data.questions.length === 1 ? "" : "s"} — review and Save Quiz.`);
    } catch (err) {
      const friendly = configNotReadyMessage(err);
      if (!friendly) console.error("AI quiz generation failed:", err);
      setError(friendly || err?.message || "Failed to generate questions. Please try again.");
    } finally {
      setAiLoading(false);
    }
  };

  const updateItem = (localId, patch) =>
    setItems((prev) => prev.map((it) => (it._localId === localId ? { ...it, ...patch } : it)));

  const changeType = (localId, type) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it._localId !== localId) return it;
        const next = { ...it, type };
        if (CHOICE_TYPES.has(type) && (!it.options || it.options.length < 2)) {
          next.options = [blankOption(true), blankOption(false)];
        }
        if (type === "matching" && (!it.pairs || it.pairs.length < 2)) {
          next.pairs = [blankPair(), blankPair()];
        }
        return next;
      })
    );
  };

  const updatePair = (itemId, pairId, patch) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId
          ? { ...it, pairs: it.pairs.map((p) => (p._localId === pairId ? { ...p, ...patch } : p)) }
          : it
      )
    );

  const addPair = (itemId) =>
    setItems((prev) =>
      prev.map((it) => (it._localId === itemId ? { ...it, pairs: [...(it.pairs || []), blankPair()] } : it))
    );

  const removePair = (itemId, pairId) =>
    setItems((prev) =>
      prev.map((it) =>
        it._localId === itemId ? { ...it, pairs: it.pairs.filter((p) => p._localId !== pairId) } : it
      )
    );

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
      {/* AI: draft the end-of-course test from the lessons */}
      <div className="rounded-xl border border-navy-200 bg-navy-50/40 p-3 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Sparkles className="w-4 h-4 text-navy-600 flex-shrink-0" />
          <span className="text-sm text-slate-700">Draft questions from this course&rsquo;s lessons with AI.</span>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="ai-quiz-count" className="text-xs text-slate-500">How many</Label>
          <Input
            id="ai-quiz-count"
            type="number"
            min="1"
            max="20"
            value={aiCount}
            onChange={(e) => setAiCount(e.target.value)}
            className="h-9 w-16"
            disabled={aiLoading}
          />
          <Button type="button" variant="outline" size="sm" onClick={draftWithAI} disabled={aiLoading}>
            {aiLoading ? (
              <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Drafting…</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-1" /> Draft with AI</>
            )}
          </Button>
        </div>
      </div>

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

      <DragDropContext onDragEnd={onDragEnd}>
        <Droppable droppableId="questions">
          {(dropProvided) => (
            <div ref={dropProvided.innerRef} {...dropProvided.droppableProps} className="space-y-4">
              {items.map((item, index) => (
                <Draggable key={item._localId} draggableId={item._localId} index={index}>
                  {(dragProvided, dragSnapshot) => (
                    <div ref={dragProvided.innerRef} {...dragProvided.draggableProps}>
                      <Card className={`border-slate-200 ${dragSnapshot.isDragging ? "shadow-lg ring-2 ring-blue-200" : ""}`}>
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 flex items-center gap-1.5">
                              <span
                                {...dragProvided.dragHandleProps}
                                className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500"
                                aria-label="Drag to reorder question"
                              >
                                <GripVertical className="w-4 h-4" />
                              </span>
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
                    <SelectItem value="matching">Matching</SelectItem>
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

            {/* Matching pairs */}
            {item.type === "matching" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">
                    Pairs <span className="font-normal text-slate-400">(left prompt → correct match)</span>
                  </Label>
                  <Button type="button" variant="outline" size="sm" onClick={() => addPair(item._localId)}>
                    <Plus className="w-3.5 h-3.5 mr-1" /> Add Pair
                  </Button>
                </div>
                {(item.pairs || []).map((pair) => (
                  <div key={pair._localId} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-center">
                    <Input
                      value={pair.left}
                      onChange={(e) => updatePair(item._localId, pair._localId, { left: e.target.value })}
                      placeholder="Left (prompt)"
                      className="h-10"
                    />
                    <Input
                      value={pair.rightText}
                      onChange={(e) => updatePair(item._localId, pair._localId, { rightText: e.target.value })}
                      placeholder="Right (correct match)"
                      className="h-10"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={(item.pairs || []).length <= 2}
                      onClick={() => removePair(item._localId, pair._localId)}
                    >
                      <Trash2 className="w-4 h-4 text-red-500" />
                    </Button>
                  </div>
                ))}
                <p className="text-xs text-slate-400">
                  Learners see the left prompts and pick from all the right values shuffled together.
                </p>
              </div>
            )}

            {item.type === "short_answer" && (
              <div className="space-y-1">
                <Label className="text-sm font-semibold">Grading Rubric</Label>
                <Textarea
                  value={item.rubric}
                  onChange={(e) => updateItem(item._localId, { rubric: e.target.value })}
                  placeholder="Criteria for full / partial / no credit — the AI grader uses this to score responses."
                  rows={2}
                  className="mt-1"
                />
                <p className="text-xs text-slate-500 italic">
                  Short-answer responses are graded by AI against this rubric (falls back to the prompt if blank).
                </p>
              </div>
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
                    </div>
                  )}
                </Draggable>
              ))}
              {dropProvided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

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
