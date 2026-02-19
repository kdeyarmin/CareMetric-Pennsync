import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ThumbsUp, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export default function AIFeedbackTrainer({
  enhancedNote,
  originalNote,
  visitType,
  outputType = 'note',
  userEmail,
  onFeedbackSubmitted
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [correction, setCorrection] = useState("");
  const [feedbackType, setFeedbackType] = useState("improvement");
  const [category, setCategory] = useState("documentation");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitFeedback = async () => {
    if (!correction.trim()) {
      toast.error("Please provide feedback");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await base44.functions.invoke('recordAIFeedback', {
        ai_output: enhancedNote,
        user_correction: correction,
        feedback_type: feedbackType,
        output_type: outputType,
        improvement_category: category,
        context: {
          visit_type: visitType,
          original_note: originalNote?.substring(0, 200)
        }
      });

      if (result?.data?.success) {
        toast.success("Feedback recorded! Thank you for improving the AI");
        setCorrection("");
        setShowFeedback(false);
        onFeedbackSubmitted?.();
      } else {
        toast.error("Failed to record feedback");
      }
    } catch (error) {
      toast.error(`Error: ${error.message}`);
      console.error(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="border-indigo-200/50">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm sm:text-base">
          <MessageSquare className="w-4 h-4 text-indigo-600" />
          Help AI Learn
        </CardTitle>
        <p className="text-xs text-slate-600 mt-2">
          Report corrections so we can improve AI accuracy over time
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!showFeedback ? (
          <Button
            onClick={() => setShowFeedback(true)}
            variant="outline"
            size="sm"
            className="w-full text-xs"
          >
            <ThumbsUp className="w-3 h-3 mr-2" />
            Report Issue or Suggestion
          </Button>
        ) : (
          <div className="space-y-3">
            {/* Feedback Type */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Feedback Type
              </label>
              <Select value={feedbackType} onValueChange={setFeedbackType}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="correction">Correction (AI got it wrong)</SelectItem>
                  <SelectItem value="improvement">Improvement (could be better)</SelectItem>
                  <SelectItem value="error">Error (breaks functionality)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Category */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Category
              </label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="documentation">Documentation Quality</SelectItem>
                  <SelectItem value="accuracy">Accuracy</SelectItem>
                  <SelectItem value="clarity">Clarity</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                  <SelectItem value="clinical_accuracy">Clinical Accuracy</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Correction Text */}
            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1.5">
                Your Correction or Suggestion
              </label>
              <Textarea
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="Describe what should be changed and why..."
                className="h-24 text-xs resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                onClick={submitFeedback}
                disabled={isSubmitting}
                size="sm"
                className="flex-1 text-xs"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Feedback"
                )}
              </Button>
              <Button
                onClick={() => {
                  setShowFeedback(false);
                  setCorrection("");
                }}
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
              >
                Cancel
              </Button>
            </div>

            <p className="text-[10px] text-slate-500 italic">
              Your feedback helps us improve AI accuracy for all users
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}