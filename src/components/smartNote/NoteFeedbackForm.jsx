import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Star, Send, X } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

const FEEDBACK_TYPES = [
  { id: "excellent", label: "Excellent - Ready to use", icon: "⭐⭐⭐⭐⭐" },
  { id: "good_coverage", label: "Good coverage - Minor edits needed", icon: "⭐⭐⭐⭐" },
  { id: "incomplete", label: "Incomplete - Missing key elements", icon: "⭐⭐⭐" },
  { id: "too_generic", label: "Too generic - Needs patient-specific details", icon: "⭐⭐" },
  { id: "inaccurate", label: "Inaccurate - Contains errors", icon: "⭐" },
  { id: "other", label: "Other feedback", icon: "❓" }
];

const MISSED_ELEMENTS_OPTIONS = [
  "Homebound status verification",
  "Skilled nursing need justification",
  "Patient response to interventions",
  "Vital signs interpretation",
  "Care plan alignment",
  "Patient education details",
  "Safety/fall risk assessment",
  "Medication review/updates",
  "Functional status changes",
  "Psychosocial factors",
  "Compliance/adherence",
  "Pain management details"
];

export default function NoteFeedbackForm({
  generatedNote,
  roughNote,
  patientId,
  providerType = "RN",
  visitType = "routine_visit",
  diagnosis = "",
  onFeedbackSubmitted = null,
  onClose = null
}) {
  const [feedbackType, setFeedbackType] = useState("");
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [missedElements, setMissedElements] = useState([]);
  const [strongPoints, setStrongPoints] = useState([]);
  const [improvements, setImprovements] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: async () => {
      try {
        return await base44.auth.me();
      } catch (error) {
        return null;
      }
    }
  });

  const handleToggleMissedElement = (element) => {
    setMissedElements(prev =>
      prev.includes(element)
        ? prev.filter(e => e !== element)
        : [...prev, element]
    );
  };

  const handleToggleStrengthPoint = (point) => {
    setStrongPoints(prev =>
      prev.includes(point)
        ? prev.filter(p => p !== point)
        : [...prev, point]
    );
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackType || !feedbackText.trim()) {
      toast.error("Please select feedback type and add comments");
      return;
    }

    setIsSubmitting(true);
    try {
      const improvementArray = improvements
        .split("\n")
        .map(s => s.trim())
        .filter(s => s.length > 0);

      await base44.entities.NoteFeedback.create({
        patient_id: patientId,
        provider_type: providerType,
        visit_type: visitType,
        diagnosis: diagnosis,
        feedback_type: feedbackType,
        feedback_text: feedbackText,
        missed_elements: missedElements,
        strong_points: strongPoints,
        improvement_suggestions: improvementArray,
        generated_note: generatedNote,
        rough_note: roughNote,
        rating: rating || null,
        would_use_again: feedbackType === "excellent" || feedbackType === "good_coverage"
      });

      toast.success("Feedback saved! This will help improve future note generation.");
      onFeedbackSubmitted?.();
      
      // Reset form
      setFeedbackType("");
      setRating(0);
      setFeedbackText("");
      setMissedElements([]);
      setStrongPoints([]);
      setImprovements("");
      
      onClose?.();
    } catch (error) {
      toast.error("Failed to save feedback: " + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card className="w-full border-blue-200 bg-blue-50">
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base">How can we improve?</CardTitle>
        {onClose && (
          <Button
            size="icon"
            variant="ghost"
            onClick={onClose}
            className="h-8 w-8 text-gray-500"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Feedback Type Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Overall Assessment</Label>
          <RadioGroup value={feedbackType} onValueChange={setFeedbackType}>
            <div className="space-y-2">
              {FEEDBACK_TYPES.map(ft => (
                <div key={ft.id} className="flex items-center space-x-2 bg-white p-2 rounded border">
                  <RadioGroupItem value={ft.id} id={ft.id} />
                  <Label htmlFor={ft.id} className="text-xs cursor-pointer flex-1 m-0">
                    <span className="mr-2">{ft.icon}</span>
                    {ft.label}
                  </Label>
                </div>
              ))}
            </div>
          </RadioGroup>
        </div>

        {/* Star Rating */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold">Quality Rating</Label>
          <div className="flex gap-1 bg-white p-2 rounded border">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                onClick={() => setRating(rating === star ? 0 : star)}
                className="text-2xl transition-transform hover:scale-110"
              >
                <Star
                  className={`w-6 h-6 ${
                    star <= rating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-gray-300"
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Missed Elements */}
        {(feedbackType === "incomplete" || feedbackType === "too_generic") && (
          <div className="space-y-2 bg-white p-3 rounded border">
            <Label className="text-sm font-semibold">What was missing?</Label>
            <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto">
              {MISSED_ELEMENTS_OPTIONS.map(element => (
                <div key={element} className="flex items-center gap-2">
                  <Checkbox
                    checked={missedElements.includes(element)}
                    onCheckedChange={() => handleToggleMissedElement(element)}
                    id={`missed-${element}`}
                  />
                  <Label
                    htmlFor={`missed-${element}`}
                    className="text-xs cursor-pointer m-0"
                  >
                    {element}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Strong Points */}
        {(feedbackType === "excellent" || feedbackType === "good_coverage") && (
          <div className="space-y-2 bg-white p-3 rounded border border-green-200">
            <Label className="text-sm font-semibold text-green-900">What did we do well?</Label>
            <div className="space-y-2">
              {[
                "Accurate clinical details",
                "Good patient-specific language",
                "Complete assessment",
                "Clear interventions documented",
                "Proper formatting",
                "Good compliance focus"
              ].map(point => (
                <div key={point} className="flex items-center gap-2">
                  <Checkbox
                    checked={strongPoints.includes(point)}
                    onCheckedChange={() => handleToggleStrengthPoint(point)}
                    id={`strength-${point}`}
                  />
                  <Label
                    htmlFor={`strength-${point}`}
                    className="text-xs cursor-pointer m-0"
                  >
                    {point}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Feedback Comments */}
        <div className="space-y-2">
          <Label htmlFor="feedback" className="text-sm font-semibold">
            Your Feedback
          </Label>
          <Textarea
            id="feedback"
            placeholder="Describe your feedback in detail. Be specific about what needs improvement..."
            value={feedbackText}
            onChange={(e) => setFeedbackText(e.target.value)}
            className="min-h-20 text-sm"
          />
        </div>

        {/* Improvement Suggestions */}
        <div className="space-y-2">
          <Label htmlFor="improvements" className="text-sm font-semibold">
            Suggestions for Improvement (Optional)
          </Label>
          <Textarea
            id="improvements"
            placeholder="List suggestions, one per line. Example:&#10;- Add more specific vital sign interpretation&#10;- Include medication side effects discussion"
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            className="min-h-16 text-sm"
          />
        </div>

        <Alert className="bg-blue-100 border-blue-300">
          <AlertDescription className="text-xs text-blue-800">
            Your feedback helps train the AI to generate better notes for you and your patients. This information is used to refine future note generation.
          </AlertDescription>
        </Alert>

        <div className="flex gap-2">
          <Button
            onClick={handleSubmitFeedback}
            disabled={isSubmitting || !feedbackType || !feedbackText.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? (
              <>
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white mr-2" />
                Saving...
              </>
            ) : (
              <>
                <Send className="w-4 h-4 mr-2" />
                Submit Feedback
              </>
            )}
          </Button>
          {onClose && (
            <Button
              onClick={onClose}
              variant="outline"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}