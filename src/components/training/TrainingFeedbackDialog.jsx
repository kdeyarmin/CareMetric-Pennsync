import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Star, ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import { toast } from "sonner";

export default function TrainingFeedbackDialog({ completion, moduleTitle, trigger }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState({
    effectiveness_rating: completion?.effectiveness_rating || 0,
    difficulty_rating: completion?.difficulty_rating || 'just_right',
    relevance_rating: completion?.relevance_rating || 0,
    would_recommend: completion?.would_recommend ?? null,
    feedback: completion?.feedback || '',
    improvement_suggestions: completion?.improvement_suggestions || ''
  });

  const queryClient = useQueryClient();

  const updateFeedbackMutation = useMutation({
    mutationFn: async (feedbackData) => {
      await base44.entities.TrainingCompletion.update(completion.id, feedbackData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['trainingCompletions']);
      queryClient.invalidateQueries(['trainingProgress']);
      toast.success('Thank you for your feedback!');
      setOpen(false);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    updateFeedbackMutation.mutate(feedback);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <MessageSquare className="w-4 h-4 mr-2" />
            Rate Training
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Training Feedback: {moduleTitle}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6 py-4">
          {/* Effectiveness Rating */}
          <div>
            <Label className="text-base mb-3 block">How effective was this training?</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setFeedback({ ...feedback, effectiveness_rating: rating })}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    feedback.effectiveness_rating >= rating
                      ? 'border-yellow-400 bg-yellow-50'
                      : 'border-gray-200 hover:border-yellow-200'
                  }`}
                >
                  <Star className={`w-6 h-6 ${
                    feedback.effectiveness_rating >= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                  }`} />
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2">
              {feedback.effectiveness_rating === 0 ? 'Click to rate' :
               feedback.effectiveness_rating <= 2 ? 'Not very effective' :
               feedback.effectiveness_rating === 3 ? 'Somewhat effective' :
               'Very effective'}
            </p>
          </div>

          {/* Relevance Rating */}
          <div>
            <Label className="text-base mb-3 block">How relevant was this to your daily work?</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(rating => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => setFeedback({ ...feedback, relevance_rating: rating })}
                  className={`flex-1 p-3 rounded-lg border-2 transition-all ${
                    feedback.relevance_rating >= rating
                      ? 'border-blue-400 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-200'
                  }`}
                >
                  <div className="text-2xl font-bold text-gray-700">{rating}</div>
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>Not relevant</span>
              <span>Very relevant</span>
            </div>
          </div>

          {/* Difficulty */}
          <div>
            <Label className="text-base mb-3 block">How was the difficulty level?</Label>
            <div className="grid grid-cols-3 gap-3">
              {[
                { value: 'too_easy', label: 'Too Easy', color: 'green' },
                { value: 'just_right', label: 'Just Right', color: 'blue' },
                { value: 'too_hard', label: 'Too Hard', color: 'red' }
              ].map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFeedback({ ...feedback, difficulty_rating: option.value })}
                  className={`p-3 rounded-lg border-2 transition-all ${
                    feedback.difficulty_rating === option.value
                      ? `border-${option.color}-400 bg-${option.color}-50`
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold">{option.label}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Would Recommend */}
          <div>
            <Label className="text-base mb-3 block">Would you recommend this to colleagues?</Label>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setFeedback({ ...feedback, would_recommend: true })}
                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                  feedback.would_recommend === true
                    ? 'border-green-400 bg-green-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <ThumbsUp className={`w-8 h-8 mx-auto mb-2 ${
                  feedback.would_recommend === true ? 'text-green-600' : 'text-gray-400'
                }`} />
                <p className="font-semibold">Yes</p>
              </button>
              <button
                type="button"
                onClick={() => setFeedback({ ...feedback, would_recommend: false })}
                className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                  feedback.would_recommend === false
                    ? 'border-red-400 bg-red-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <ThumbsDown className={`w-8 h-8 mx-auto mb-2 ${
                  feedback.would_recommend === false ? 'text-red-600' : 'text-gray-400'
                }`} />
                <p className="font-semibold">No</p>
              </button>
            </div>
          </div>

          {/* General Feedback */}
          <div>
            <Label htmlFor="feedback">What did you find most valuable?</Label>
            <Textarea
              id="feedback"
              value={feedback.feedback}
              onChange={(e) => setFeedback({ ...feedback, feedback: e.target.value })}
              rows={3}
              placeholder="Share what you learned or found helpful..."
            />
          </div>

          {/* Improvement Suggestions */}
          <div>
            <Label htmlFor="improvements">How could this training be improved?</Label>
            <Textarea
              id="improvements"
              value={feedback.improvement_suggestions}
              onChange={(e) => setFeedback({ ...feedback, improvement_suggestions: e.target.value })}
              rows={3}
              placeholder="Suggestions for making this more useful..."
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="submit" className="flex-1" disabled={updateFeedbackMutation.isPending}>
              Submit Feedback
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}