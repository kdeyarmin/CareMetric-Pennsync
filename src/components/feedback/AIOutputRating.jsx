import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { ThumbsUp, ThumbsDown, Flag, MessageSquare, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function AIOutputRating({
  outputType, // 'note_enhancement', 'training_recommendation', 'clinical_insight', etc.
  outputContent,
  outputMetadata = {},
  userEmail,
  onFeedbackSubmitted
}) {
  const [rating, setRating] = useState(null); // 'helpful', 'not_helpful', 'flagged'
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleRating = async (ratingValue) => {
    setRating(ratingValue);
    
    if (ratingValue === 'flagged') {
      setShowFeedback(true);
      return;
    }

    // Auto-submit for thumbs up/down
    await submitFeedback(ratingValue, "");
  };

  const submitFeedback = async (ratingValue, feedback) => {
    setSubmitting(true);
    try {
      await base44.entities.AIFeedback.create({
        user_email: userEmail,
        output_type: outputType,
        rating: ratingValue,
        feedback_text: feedback,
        output_content: outputContent,
        output_metadata: outputMetadata,
        timestamp: new Date().toISOString()
      });

      toast.success('Feedback submitted - helps improve AI accuracy');
      
      if (onFeedbackSubmitted) {
        onFeedbackSubmitted(ratingValue, feedback);
      }

      setShowFeedback(false);
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  };

  const handleFeedbackSubmit = () => {
    if (!feedbackText.trim()) {
      toast.warning('Please provide feedback details');
      return;
    }
    submitFeedback(rating || 'flagged', feedbackText);
  };

  return (
    <div className="space-y-2">
      {!showFeedback ? (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-600 dark:text-slate-400">
            Was this helpful?
          </span>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={rating === 'helpful' ? 'default' : 'outline'}
              onClick={() => handleRating('helpful')}
              disabled={!!rating}
              className={cn(
                "h-8 px-3",
                rating === 'helpful' && "bg-green-600 hover:bg-green-700"
              )}
            >
              <ThumbsUp className="w-3 h-3 mr-1" />
              Yes
            </Button>
            <Button
              size="sm"
              variant={rating === 'not_helpful' ? 'default' : 'outline'}
              onClick={() => handleRating('not_helpful')}
              disabled={!!rating}
              className={cn(
                "h-8 px-3",
                rating === 'not_helpful' && "bg-red-600 hover:bg-red-700"
              )}
            >
              <ThumbsDown className="w-3 h-3 mr-1" />
              No
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRating('flagged');
                setShowFeedback(true);
              }}
              className="h-8 px-3"
            >
              <Flag className="w-3 h-3 mr-1" />
              Flag Issue
            </Button>
          </div>
        </div>
      ) : (
        <Card className="border-blue-200 bg-blue-50 dark:bg-blue-950">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Please provide details
              </span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setShowFeedback(false);
                  setRating(null);
                }}
                className="h-6 w-6"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="What was wrong or could be improved?"
              className="h-20 text-sm"
            />
            <Button
              onClick={handleFeedbackSubmit}
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700"
              size="sm"
            >
              {submitting ? 'Submitting...' : 'Submit Feedback'}
            </Button>
          </CardContent>
        </Card>
      )}
      
      {rating && !showFeedback && (
        <p className="text-xs text-green-600 dark:text-green-400">
          ✓ Thank you for your feedback!
        </p>
      )}
    </div>
  );
}