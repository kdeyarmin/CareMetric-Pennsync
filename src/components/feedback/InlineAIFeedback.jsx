import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { ThumbsUp, ThumbsDown, MessageSquare, X, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function InlineAIFeedback({ 
  suggestionType = "note_enhancement", 
  suggestionContent = "", 
  userEmail = "",
  contextData = {},
  compact = false
}) {
  const [rating, setRating] = useState(null); // "up" or "down"
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const submitFeedback = async (thumbRating, feedbackText = "") => {
    setSaving(true);
    try {
      await base44.entities.AIFeedback.create({
        user_email: userEmail,
        ai_suggestion_type: suggestionType,
        suggestion_content: suggestionContent?.substring(0, 500),
        user_action: thumbRating === "up" ? "accepted" : "rejected",
        helpful_rating: thumbRating === "up" ? 5 : 1,
        feedback_text: feedbackText,
        context_data: contextData,
      });
      setSubmitted(true);
      toast.success("Thanks for your feedback!");
    } catch (e) {
      console.error("Feedback error:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleThumb = (direction) => {
    setRating(direction);
    if (direction === "up") {
      submitFeedback("up");
    } else {
      setShowComment(true);
    }
  };

  const handleSubmitComment = () => {
    submitFeedback("down", comment);
    setShowComment(false);
  };

  if (submitted) {
    return (
      <div className="flex items-center gap-2 text-xs text-green-600 py-1">
        <ThumbsUp className="h-3 w-3" />
        <span>Feedback recorded — this helps improve AI accuracy</span>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-slate-500 mr-1">AI helpful?</span>
        <button
          onClick={() => handleThumb("up")}
          disabled={saving}
          className={`p-1 rounded hover:bg-green-100 ${rating === "up" ? "bg-green-100 text-green-700" : "text-slate-400"}`}
        >
          <ThumbsUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => handleThumb("down")}
          disabled={saving}
          className={`p-1 rounded hover:bg-red-100 ${rating === "down" ? "bg-red-100 text-red-700" : "text-slate-400"}`}
        >
          <ThumbsDown className="h-3 w-3" />
        </button>
        {showComment && (
          <div className="flex items-center gap-1 ml-2">
            <input
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What could be better?"
              className="text-xs border rounded px-2 py-1 w-40"
            />
            <button onClick={handleSubmitComment} className="text-blue-600 hover:text-blue-800">
              <Send className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 bg-slate-50 dark:bg-slate-800/50 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600 dark:text-slate-400">Was this AI output helpful?</p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={rating === "up" ? "default" : "outline"}
            onClick={() => handleThumb("up")}
            disabled={saving}
            className={`h-7 px-3 text-xs ${rating === "up" ? "bg-green-600 hover:bg-green-700" : ""}`}
          >
            <ThumbsUp className="h-3 w-3 mr-1" /> Helpful
          </Button>
          <Button
            size="sm"
            variant={rating === "down" ? "default" : "outline"}
            onClick={() => handleThumb("down")}
            disabled={saving}
            className={`h-7 px-3 text-xs ${rating === "down" ? "bg-red-600 hover:bg-red-700" : ""}`}
          >
            <ThumbsDown className="h-3 w-3 mr-1" /> Not helpful
          </Button>
        </div>
      </div>

      {showComment && (
        <div className="space-y-2">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="What could be improved? (optional)"
            className="text-xs h-16"
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSubmitComment} disabled={saving} className="h-7 text-xs">
              {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Send className="h-3 w-3 mr-1" />}
              Submit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowComment(false)} className="h-7 text-xs">
              <X className="h-3 w-3 mr-1" /> Skip
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}