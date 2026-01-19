import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ThumbsUp, ThumbsDown, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";

export default function AISuggestionFeedback({
  suggestionType,
  suggestionContent,
  userAction,
  userEdit,
  contextData,
  compact = false
}) {
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [rating, setRating] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const submitFeedback = async (helpful) => {
    setSubmitting(true);
    try {
      const user = await base44.auth.me();
      
      await base44.entities.AIFeedback.create({
        user_email: user.email,
        ai_suggestion_type: suggestionType,
        suggestion_content: suggestionContent?.substring(0, 500) || "N/A",
        user_action: userAction || 'accepted',
        user_edit: userEdit,
        helpful_rating: helpful ? 5 : 1,
        feedback_text: feedbackText || null,
        context_data: contextData || {},
        is_processed: false
      });

      toast.success("Thank you for your feedback!");
      setFeedbackOpen(false);
      setFeedbackText("");
      setRating(null);
    } catch (error) {
      toast.error("Failed to submit feedback");
      console.error(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleThumbsUp = () => {
    setRating('positive');
    submitFeedback(true);
  };

  const handleThumbsDown = () => {
    setRating('negative');
    setFeedbackOpen(true);
  };

  if (compact) {
    return (
      <>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={handleThumbsUp}
            className="h-7 w-7 hover:bg-green-100 dark:hover:bg-green-950"
            title="Helpful"
          >
            <ThumbsUp className={`w-3 h-3 ${rating === 'positive' ? 'text-green-600 fill-current' : 'text-gray-400'}`} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={handleThumbsDown}
            className="h-7 w-7 hover:bg-red-100 dark:hover:bg-red-950"
            title="Not helpful"
          >
            <ThumbsDown className={`w-3 h-3 ${rating === 'negative' ? 'text-red-600 fill-current' : 'text-gray-400'}`} />
          </Button>
        </div>

        <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Help Us Improve</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-gray-600">
                What could we improve about this suggestion?
              </p>
              <Textarea
                placeholder="Optional: Tell us what went wrong or how we can improve..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                rows={4}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setFeedbackOpen(false);
                    setFeedbackText("");
                  }}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => submitFeedback(false)}
                  disabled={submitting}
                  className="flex-1"
                >
                  Submit Feedback
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
      <span className="text-xs text-gray-600 dark:text-gray-400">Was this helpful?</span>
      <Button
        size="sm"
        variant={rating === 'positive' ? 'default' : 'outline'}
        onClick={handleThumbsUp}
        disabled={submitting}
        className="h-8"
      >
        <ThumbsUp className="w-3 h-3 mr-1" />
        Yes
      </Button>
      <Button
        size="sm"
        variant={rating === 'negative' ? 'default' : 'outline'}
        onClick={handleThumbsDown}
        disabled={submitting}
        className="h-8"
      >
        <ThumbsDown className="w-3 h-3 mr-1" />
        No
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setFeedbackOpen(true)}
        className="h-8 ml-auto"
      >
        <MessageSquare className="w-3 h-3 mr-1" />
        Comment
      </Button>

      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Provide Feedback</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Tell us more about your experience with this suggestion..."
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              rows={4}
            />
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setFeedbackOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={() => submitFeedback(rating === 'positive')}
                disabled={submitting}
                className="flex-1"
              >
                Submit
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}