import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  ThumbsUp, ThumbsDown, Star, MessageSquare, 
  X, CheckCircle2, Send 
} from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Badge } from "@/components/ui/badge";

export default function AIInsightFeedbackWidget({ 
  insightType,
  insightId = null,
  insightContent,
  onFeedbackSubmitted,
  compact = false 
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [rating, setRating] = useState(0);
  const [accuracyRating, setAccuracyRating] = useState("");
  const [relevanceRating, setRelevanceRating] = useState("");
  const [usefulnessRating, setUsefulnessRating] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [actionTaken, setActionTaken] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleQuickFeedback = async (isPositive) => {
    setSubmitting(true);
    try {
      const user = await base44.auth.me();
      await base44.entities.AIInsightFeedback.create({
        nurse_email: user.email,
        insight_type: insightType,
        insight_id: insightId,
        insight_content: insightContent,
        rating: isPositive ? 5 : 2,
        accuracy_rating: isPositive ? "very_accurate" : "inaccurate",
        relevance_rating: isPositive ? "very_relevant" : "not_relevant",
        usefulness_rating: isPositive ? "very_useful" : "not_useful",
        action_taken: isPositive,
        context_data: {
          feedback_method: "quick_button",
          timestamp: new Date().toISOString()
        }
      });
      setSubmitted(true);
      setTimeout(() => {
        setShowFeedback(false);
        setSubmitted(false);
        if (onFeedbackSubmitted) onFeedbackSubmitted();
      }, 2000);
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      alert("Failed to submit feedback. Please try again.");
    }
    setSubmitting(false);
  };

  const handleDetailedFeedback = async () => {
    if (rating === 0) {
      alert("Please provide a rating");
      return;
    }

    setSubmitting(true);
    try {
      const user = await base44.auth.me();
      await base44.entities.AIInsightFeedback.create({
        nurse_email: user.email,
        insight_type: insightType,
        insight_id: insightId,
        insight_content: insightContent,
        rating,
        accuracy_rating: accuracyRating,
        relevance_rating: relevanceRating,
        usefulness_rating: usefulnessRating,
        feedback_text: feedbackText,
        action_taken: actionTaken,
        context_data: {
          feedback_method: "detailed_form",
          timestamp: new Date().toISOString()
        }
      });
      setSubmitted(true);
      setTimeout(() => {
        setShowFeedback(false);
        setSubmitted(false);
        setRating(0);
        setAccuracyRating("");
        setRelevanceRating("");
        setUsefulnessRating("");
        setFeedbackText("");
        setActionTaken(null);
        if (onFeedbackSubmitted) onFeedbackSubmitted();
      }, 2000);
    } catch (error) {
      console.error("Failed to submit feedback:", error);
      alert("Failed to submit feedback. Please try again.");
    }
    setSubmitting(false);
  };

  if (submitted) {
    return (
      <Card className="bg-green-50 border-green-300">
        <CardContent className="p-3 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <p className="text-sm font-medium text-green-900">Thank you for your feedback!</p>
        </CardContent>
      </Card>
    );
  }

  if (!showFeedback) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowFeedback(true)}
          className="gap-2"
        >
          <MessageSquare className="w-4 h-4" />
          {compact ? "Feedback" : "Rate this insight"}
        </Button>
      </div>
    );
  }

  return (
    <Card className="border-2 border-indigo-200 bg-indigo-50">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-900">How helpful was this insight?</p>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowFeedback(false)}
            className="h-6 w-6"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Quick Feedback Buttons */}
        <div className="flex gap-3">
          <Button
            onClick={() => handleQuickFeedback(true)}
            disabled={submitting}
            className="flex-1 bg-green-600 hover:bg-green-700 gap-2"
          >
            <ThumbsUp className="w-4 h-4" />
            Helpful
          </Button>
          <Button
            onClick={() => handleQuickFeedback(false)}
            disabled={submitting}
            variant="outline"
            className="flex-1 gap-2"
          >
            <ThumbsDown className="w-4 h-4" />
            Not Helpful
          </Button>
        </div>

        <div className="border-t pt-3">
          <p className="text-xs text-gray-600 mb-3">Or provide detailed feedback:</p>

          {/* Star Rating */}
          <div className="mb-3">
            <Label className="text-xs">Overall Rating</Label>
            <div className="flex gap-1 mt-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="focus:outline-none"
                >
                  <Star
                    className={`w-6 h-6 ${
                      star <= rating ? "fill-yellow-400 text-yellow-400" : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Quick Ratings */}
          <div className="space-y-2 mb-3">
            <div>
              <Label className="text-xs">Accuracy</Label>
              <div className="flex gap-1 mt-1">
                {["very_accurate", "accurate", "somewhat_accurate", "inaccurate"].map((level) => (
                  <Badge
                    key={level}
                    onClick={() => setAccuracyRating(level)}
                    className={`cursor-pointer text-xs ${
                      accuracyRating === level
                        ? "bg-indigo-600"
                        : "bg-gray-300 hover:bg-gray-400"
                    }`}
                  >
                    {level.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Relevance</Label>
              <div className="flex gap-1 mt-1">
                {["very_relevant", "relevant", "somewhat_relevant", "not_relevant"].map((level) => (
                  <Badge
                    key={level}
                    onClick={() => setRelevanceRating(level)}
                    className={`cursor-pointer text-xs ${
                      relevanceRating === level
                        ? "bg-indigo-600"
                        : "bg-gray-300 hover:bg-gray-400"
                    }`}
                  >
                    {level.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <Label className="text-xs">Usefulness</Label>
              <div className="flex gap-1 mt-1">
                {["very_useful", "useful", "somewhat_useful", "not_useful"].map((level) => (
                  <Badge
                    key={level}
                    onClick={() => setUsefulnessRating(level)}
                    className={`cursor-pointer text-xs ${
                      usefulnessRating === level
                        ? "bg-indigo-600"
                        : "bg-gray-300 hover:bg-gray-400"
                    }`}
                  >
                    {level.replace("_", " ")}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Action Taken */}
          <div className="mb-3">
            <Label className="text-xs">Did you act on this insight?</Label>
            <div className="flex gap-2 mt-1">
              <Button
                size="sm"
                variant={actionTaken === true ? "default" : "outline"}
                onClick={() => setActionTaken(true)}
                className="flex-1"
              >
                Yes
              </Button>
              <Button
                size="sm"
                variant={actionTaken === false ? "default" : "outline"}
                onClick={() => setActionTaken(false)}
                className="flex-1"
              >
                No
              </Button>
            </div>
          </div>

          {/* Comments */}
          <div className="mb-3">
            <Label className="text-xs">Additional Comments (Optional)</Label>
            <Textarea
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder="Share your thoughts on how we can improve this insight..."
              className="mt-1 text-sm"
              rows={3}
            />
          </div>

          <Button
            onClick={handleDetailedFeedback}
            disabled={submitting || rating === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 gap-2"
          >
            <Send className="w-4 h-4" />
            {submitting ? "Submitting..." : "Submit Feedback"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}