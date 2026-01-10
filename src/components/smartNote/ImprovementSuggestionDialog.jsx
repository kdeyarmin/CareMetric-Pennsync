import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const IMPROVEMENT_CATEGORIES = [
  { id: "clarity", label: "Clarity - Make text clearer/more understandable" },
  { id: "completeness", label: "Completeness - Add missing information" },
  { id: "accuracy", label: "Accuracy - Correct factual or clinical errors" },
  { id: "compliance", label: "Compliance - Better meet regulatory requirements" },
  { id: "tone", label: "Tone - Adjust professionalism or empathy level" },
  { id: "specificity", label: "Specificity - More detail or data-driven" },
  { id: "conciseness", label: "Conciseness - Remove unnecessary words" },
  { id: "terminology", label: "Terminology - Use better medical/nursing terms" }
];

export default function ImprovementSuggestionDialog({
  selectedText = "",
  patientId = "",
  providerType = "RN",
  visitType = "routine_visit",
  diagnosis = "",
  fullNote = "",
  onClose = null,
  onSuggestionSubmitted = null
}) {
  const [improvementText, setImprovementText] = useState("");
  const [category, setCategory] = useState("clarity");
  const [reason, setReason] = useState("");
  const [saveForFutureTuning, setSaveForFutureTuning] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null);

  const handleSubmit = async () => {
    if (!improvementText.trim()) {
      toast.error("Please provide an improvement suggestion");
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // Create feedback record with improvement metadata
      await base44.entities.NoteFeedback.create({
        patient_id: patientId || null,
        provider_type: providerType,
        visit_type: visitType,
        diagnosis: diagnosis,
        feedback_type: "improvement_suggestion",
        feedback_text: improvementText,
        generated_note: fullNote,
        rough_note: selectedText,
        improvement_category: category,
        improvement_reason: reason,
        save_for_tuning: saveForFutureTuning,
        metadata: {
          selected_section_length: selectedText.length,
          suggestion_length: improvementText.length,
          improvement_ratio: Math.round(
            (improvementText.length / selectedText.length) * 100
          ),
          timestamp: new Date().toISOString()
        }
      });

      setSubmitStatus("success");
      toast.success("Improvement suggestion saved!");

      // Reset form
      setTimeout(() => {
        if (onSuggestionSubmitted) onSuggestionSubmitted();
        if (onClose) onClose();
      }, 1500);
    } catch (error) {
      console.error("Failed to save suggestion:", error);
      setSubmitStatus("error");
      toast.error("Failed to save suggestion");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Suggest Improvement</DialogTitle>
          <DialogDescription>
            Help us improve AI note generation with your feedback
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Original Text */}
          <div>
            <Label className="text-xs font-semibold text-slate-700">Original Text</Label>
            <div className="mt-1 bg-slate-100 dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-700">
              <p className="text-sm text-slate-700 dark:text-slate-300 italic">
                "{selectedText}"
              </p>
            </div>
          </div>

          {/* Improvement Category */}
          <div>
            <Label htmlFor="category" className="text-xs font-semibold text-slate-700">
              Type of Improvement *
            </Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="category" className="h-9 text-sm mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMPROVEMENT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id} className="text-sm">
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Suggested Improvement */}
          <div>
            <Label htmlFor="improvement" className="text-xs font-semibold text-slate-700">
              Your Suggested Improvement *
            </Label>
            <Textarea
              id="improvement"
              placeholder="Provide the improved version or explain what should be changed..."
              value={improvementText}
              onChange={(e) => setImprovementText(e.target.value)}
              className="mt-1 min-h-24 text-sm resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              {improvementText.length} characters
            </p>
          </div>

          {/* Reason for Change */}
          <div>
            <Label htmlFor="reason" className="text-xs font-semibold text-slate-700">
              Why This Improvement? (Optional)
            </Label>
            <Textarea
              id="reason"
              placeholder="Explain the clinical, compliance, or clarity reason for this change..."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-16 text-sm resize-none"
            />
          </div>

          {/* Provider & Visit Context */}
          <div className="grid grid-cols-2 gap-3 bg-slate-50 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800">
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Provider Type</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{providerType}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600 dark:text-slate-400">Visit Type</p>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{visitType.replace(/_/g, " ")}</p>
            </div>
            {diagnosis && (
              <div className="col-span-2">
                <p className="text-xs text-slate-600 dark:text-slate-400">Diagnosis</p>
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{diagnosis}</p>
              </div>
            )}
          </div>

          {/* Save for Tuning */}
          <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-950 p-3 rounded border border-blue-200 dark:border-blue-800">
            <Checkbox
              id="tuning"
              checked={saveForFutureTuning}
              onCheckedChange={setSaveForFutureTuning}
            />
            <Label htmlFor="tuning" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer flex-1">
              Save this feedback to fine-tune AI for future notes (helps personalize to your preferences)
            </Label>
          </div>

          {/* Status Messages */}
          {submitStatus === "success" && (
            <div className="bg-green-50 dark:bg-green-950 p-3 rounded border border-green-200 dark:border-green-800 flex gap-2">
              <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-green-900 dark:text-green-100">Suggestion Saved!</p>
                <p className="text-xs text-green-800 dark:text-green-200">
                  This feedback will help improve AI note generation
                </p>
              </div>
            </div>
          )}

          {submitStatus === "error" && (
            <div className="bg-red-50 dark:bg-red-950 p-3 rounded border border-red-200 dark:border-red-800 flex gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-900 dark:text-red-100">Failed to Save</p>
                <p className="text-xs text-red-800 dark:text-red-200">
                  Please try again or contact support
                </p>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="text-sm h-9"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || !improvementText.trim()}
              className="text-sm h-9 bg-blue-600 hover:bg-blue-700 gap-2"
            >
              {isSubmitting && <Loader className="w-3 h-3 animate-spin" />}
              {isSubmitting ? "Saving..." : "Save Suggestion"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}