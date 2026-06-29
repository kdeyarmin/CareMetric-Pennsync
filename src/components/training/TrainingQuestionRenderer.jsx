import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";

const DIFFICULTY_BADGE = {
  easy: "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  hard: "bg-red-100 text-red-700",
};

const TYPE_LABEL = {
  mcq: "Multiple Choice",
  multi_select: "Select All That Apply",
  true_false: "True / False",
  short_answer: "Short Answer",
  scenario_based: "Scenario",
  matching: "Matching",
};

export default function TrainingQuestionRenderer({ question, index, value, onChange }) {
  const answer = value === undefined
    ? (question.type === "multi_select" ? [] : question.type === "matching" ? {} : "")
    : value;
  const isAnswered = (() => {
    if (question.type === "multi_select") return Array.isArray(answer) && answer.length > 0;
    if (question.type === "matching") return typeof answer === "object" && answer !== null && Object.keys(answer).length > 0;
    if (question.type === "short_answer" || question.type === "scenario_based") return typeof answer === "string" && answer.trim().length > 0;
    if (question.type === "true_false") return answer === true || answer === false;
    return answer !== "" && answer !== undefined && answer !== null;
  })();

  const toggleMultiValue = (optionValue, checked) => {
    const current = Array.isArray(answer) ? answer : [];
    onChange(checked ? [...current, optionValue] : current.filter((i) => i !== optionValue));
  };

  const matchingPairs = Array.isArray(question.correct_answer_json?.answer?.pairs)
    ? question.correct_answer_json.answer.pairs
    : [];
  const matchingOptions = Array.isArray(question.options_json) ? question.options_json : [];

  return (
    <Card className={`border shadow-sm transition-all duration-150 ${isAnswered ? "border-blue-200 bg-blue-50/30" : "border-slate-200 bg-white"}`}>
      <CardContent className="p-5 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-100 px-2 py-0.5 rounded-md">
                Q{index + 1}
              </span>
              <span className="text-xs text-slate-500">{TYPE_LABEL[question.type] || question.type}</span>
              {question.difficulty && (
                <Badge className={DIFFICULTY_BADGE[question.difficulty] || "bg-slate-100 text-slate-600"}>
                  {question.difficulty}
                </Badge>
              )}
              {question.points > 1 && (
                <Badge variant="outline" className="text-xs">{question.points} pts</Badge>
              )}
            </div>
            <p className="font-semibold text-slate-900 leading-relaxed text-base">{question.prompt}</p>
          </div>
          {isAnswered && (
            <div className="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center flex-shrink-0 mt-1">
              <Check className="w-3.5 h-3.5" />
            </div>
          )}
        </div>

        {/* MCQ */}
        {question.type === "mcq" && (
          <div className="space-y-2">
            {(question.options_json || []).map((option, i) => {
              const selected = answer === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onChange(option.value)}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left text-sm transition-all ${
                    selected
                      ? "border-blue-500 bg-blue-600 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <span className={`w-7 h-7 rounded-full border-2 flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                    selected ? "border-white bg-white/20 text-white" : "border-slate-300 text-slate-400"
                  }`}>
                    {String.fromCharCode(65 + i)}
                  </span>
                  <span className="flex-1">{option.label}</span>
                  {selected && <Check className="w-4 h-4 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        )}

        {/* True / False */}
        {question.type === "true_false" && (
          <div className="grid grid-cols-2 gap-3">
            {[{ value: true, label: "True" }, { value: false, label: "False" }].map((option) => {
              const selected = answer === option.value;
              return (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => onChange(option.value)}
                  className={`flex items-center justify-center gap-2 py-4 rounded-xl border-2 font-semibold text-sm transition-all ${
                    selected
                      ? option.value === true
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-red-500 bg-red-500 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {selected && <Check className="w-4 h-4" />}
                  {option.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Multi-select */}
        {question.type === "multi_select" && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 italic">Select all that apply</p>
            {(question.options_json || []).map((option) => {
              const checked = Array.isArray(answer) && answer.includes(option.value);
              return (
                <div
                  key={option.value}
                  onClick={() => toggleMultiValue(option.value, !checked)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all ${
                    checked
                      ? "border-blue-400 bg-blue-50"
                      : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleMultiValue(option.value, !!v)}
                    className="flex-shrink-0"
                  />
                  <Label className="font-normal leading-6 cursor-pointer text-slate-700">{option.label}</Label>
                </div>
              );
            })}
          </div>
        )}

        {/* Short answer / Scenario */}
        {(question.type === "short_answer" || question.type === "scenario_based") && (
          <div className="space-y-1">
            <p className="text-xs text-slate-500">Write a complete response in your own words.</p>
            <Textarea
              rows={5}
              value={typeof answer === "string" ? answer : ""}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Enter your response here..."
              className="resize-y min-h-[120px]"
              aria-label={`Answer for question ${index + 1}`}
            />
            {typeof answer === "string" && (
              <p className="text-xs text-slate-400 text-right">{answer.trim().split(/\s+/).filter(Boolean).length} words</p>
            )}
          </div>
        )}

        {/* Matching */}
        {question.type === "matching" && matchingPairs.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs text-slate-500 italic">Match each item on the left to the correct option on the right.</p>
            {matchingPairs.map((pair, pairIndex) => (
              <div key={pairIndex} className="grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800">{pair.left}</div>
                <Select
                  value={answer[pair.left] || ""}
                  onValueChange={(v) => onChange({ ...answer, [pair.left]: v })}
                >
                  <SelectTrigger className={answer[pair.left] ? "border-blue-400 bg-blue-50" : ""}>
                    <SelectValue placeholder="Select a match..." />
                  </SelectTrigger>
                  <SelectContent>
                    {matchingOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {question.type === "matching" && matchingPairs.length === 0 && (
          <Input
            value={typeof answer === "string" ? answer : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter your answer"
          />
        )}
      </CardContent>
    </Card>
  );
}