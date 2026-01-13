import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { 
  ThumbsUp, 
  ThumbsDown, 
  Star, 
  MessageSquare, 
  Send,
  CheckCircle2,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";

/**
 * Universal AI Feedback Collector
 * Can be used for any AI-generated content (notes, codes, suggestions, etc.)
 */
export default function AIFeedbackCollector({
  aiOutput,
  featureType, // "note_enhancement", "code_suggestion", "clinical_recommendation", etc.
  context, // Additional context (patient_id, visit_type, diagnosis, etc.)
  onFeedbackSubmitted,
  compact = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [feedbackText, setFeedbackText] = useState("");
  const [selectedIssues, setSelectedIssues] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const feedbackOptions = {
    note_enhancement: [
      { value: "too_generic", label: "Too generic" },
      { value: "missed_elements", label: "Missed key elements" },
      { value: "inaccurate", label: "Inaccurate information" },
      { value: "too_verbose", label: "Too wordy" },
      { value: "excellent", label: "Excellent quality" }
    ],
    code_suggestion: [
      { value: "wrong_code", label: "Wrong code suggested" },
      { value: "missing_codes", label: "Missing relevant codes" },
      { value: "helpful", label: "Very helpful" }
    ],
    clinical_recommendation: [
      { value: "not_relevant", label: "Not relevant" },
      { value: "unsafe", label: "Unsafe recommendation" },
      { value: "very_helpful", label: "Very helpful" }
    ]
  };

  const currentOptions = feedbackOptions[featureType] || feedbackOptions.note_enhancement;

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error("Please provide a rating");
      return;
    }

    setIsSubmitting(true);
    try {
      // Save to NoteFeedback entity
      await base44.entities.NoteFeedback.create({
        patient_id: context?.patient_id || null,
        provider_type: context?.provider_type || 'RN',
        visit_type: context?.visit_type || null,
        diagnosis: context?.diagnosis || null,
        feedback_type: selectedIssues[0] || (rating >= 4 ? "excellent" : "other"),
        feedback_text: feedbackText,
        missed_elements: selectedIssues.includes("missed_elements") ? 
          feedbackText.split(',').map(s => s.trim()).filter(Boolean) : [],
        generated_note: aiOutput,
        rough_note: context?.rough_note || null,
        rating: rating,
        would_use_again: rating >= 3,
        improvement_suggestions: feedbackText ? [feedbackText] : [],
        strong_points: rating >= 4 ? ["AI output quality"] : []
      });

      // Update provider preferences learning profile
      const currentUser = await base44.auth.me();
      if (currentUser?.email) {
        const preferences = await base44.entities.ProviderPreferences.filter({ 
          provider_email: currentUser.email 
        });
        
        if (preferences[0]) {
          const pref = preferences[0];
          const learningProfile = pref.ai_personalization?.learning_profile || {};
          
          await base44.entities.ProviderPreferences.update(pref.id, {
            ai_personalization: {
              ...(pref.ai_personalization || {}),
              learning_profile: {
                total_notes_generated: (learningProfile.total_notes_generated || 0) + 1,
                feedback_count: (learningProfile.feedback_count || 0) + 1,
                improvement_suggestions_count: feedbackText ? 
                  (learningProfile.improvement_suggestions_count || 0) + 1 : 
                  learningProfile.improvement_suggestions_count || 0,
                last_feedback_date: new Date().toISOString(),
                preferred_improvements: selectedIssues.length > 0 ? 
                  [...new Set([...(learningProfile.preferred_improvements || []), ...selectedIssues])] :
                  learningProfile.preferred_improvements || []
              }
            }
          });
        }
      }

      setSubmitted(true);
      toast.success("Thank you! Your feedback helps improve AI quality");
      
      setTimeout(() => {
        setIsOpen(false);
        setSubmitted(false);
        setRating(0);
        setFeedbackText("");
        setSelectedIssues([]);
      }, 2000);

      onFeedbackSubmitted?.({ rating, feedbackText, selectedIssues });
    } catch (error) {
      toast.error("Failed to submit feedback");
    }
    setIsSubmitting(false);
  };

  const toggleIssue = (issue) => {
    setSelectedIssues(prev => 
      prev.includes(issue) ? prev.filter(i => i !== issue) : [...prev, issue]
    );
  };

  if (compact && !isOpen) {
    return (
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="gap-2"
      >
        <MessageSquare className="w-3 h-3" />
        Feedback
      </Button>
    );
  }

  if (!isOpen) {
    return (
      <Alert className="bg-blue-50 border-blue-200 cursor-pointer hover:bg-blue-100 transition-colors" onClick={() => setIsOpen(true)}>
        <MessageSquare className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-sm text-blue-900">
          Help us improve! Share feedback on this AI output
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: "auto" }}
        exit={{ opacity: 0, height: 0 }}
      >
        <Card className="border-2 border-blue-400 bg-gradient-to-br from-blue-50 to-indigo-50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-blue-600" />
                Rate This AI Output
              </CardTitle>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setIsOpen(false)}
                className="h-8 w-8"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {submitted ? (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center py-6"
              >
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
                <p className="text-lg font-semibold text-green-900">Thank you!</p>
                <p className="text-sm text-green-700">Your feedback helps us improve</p>
              </motion.div>
            ) : (
              <>
                {/* Star Rating */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Overall Quality</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        onClick={() => setRating(star)}
                        className="transition-transform hover:scale-110"
                      >
                        <Star
                          className={`w-8 h-8 ${
                            star <= rating 
                              ? "fill-yellow-400 text-yellow-400" 
                              : "text-gray-300"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  {rating > 0 && (
                    <p className="text-xs text-gray-600 mt-1">
                      {rating === 5 && "Excellent!"}
                      {rating === 4 && "Good quality"}
                      {rating === 3 && "Acceptable"}
                      {rating === 2 && "Needs improvement"}
                      {rating === 1 && "Poor quality"}
                    </p>
                  )}
                </div>

                {/* Quick Issue Tags */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Quick Feedback (optional)</label>
                  <div className="flex flex-wrap gap-2">
                    {currentOptions.map((option) => (
                      <Badge
                        key={option.value}
                        variant={selectedIssues.includes(option.value) ? "default" : "outline"}
                        className={`cursor-pointer transition-all ${
                          selectedIssues.includes(option.value) 
                            ? "bg-blue-600 text-white" 
                            : "hover:bg-blue-100"
                        }`}
                        onClick={() => toggleIssue(option.value)}
                      >
                        {option.label}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Detailed Feedback */}
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    Additional Comments (optional)
                  </label>
                  <Textarea
                    placeholder="What could be improved? What did the AI do well?"
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    className="h-24 text-sm"
                  />
                </div>

                {/* Submit */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || rating === 0}
                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                  >
                    {isSubmitting ? (
                      <><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" /> Submitting...</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" /> Submit Feedback</>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsOpen(false)}
                  >
                    Skip
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}