import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Send } from "lucide-react";

export default function ModuleFeedbackForm({ _moduleId, onSubmit }) {
  const [rating, setRating] = useState({
    effectiveness: 0,
    difficulty: 'just_right',
    relevance: 0,
    would_recommend: true,
  });
  const [feedback, setFeedback] = useState("");
  const [suggestions, setSuggestions] = useState("");

  const handleSubmit = () => {
    onSubmit({
      effectiveness_rating: rating.effectiveness,
      difficulty_rating: rating.difficulty,
      relevance_rating: rating.relevance,
      would_recommend: rating.would_recommend,
      feedback,
      improvement_suggestions: suggestions
    });
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader>
        <CardTitle className="text-lg">How was this module?</CardTitle>
        <p className="text-sm text-slate-600">Your feedback helps us improve</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Effectiveness Rating */}
        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">
            How effective was this module? *
          </span>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((num) => (
              <button
                key={num}
                onClick={() => setRating({ ...rating, effectiveness: num })}
                className="focus:outline-none"
              >
                <Star
                  className={`w-8 h-8 ${
                    num <= rating.effectiveness
                      ? 'fill-yellow-400 text-yellow-400'
                      : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">
            Was the difficulty level appropriate? *
          </span>
          <div className="flex gap-2">
            {[
              { value: 'too_easy', label: 'Too Easy' },
              { value: 'just_right', label: 'Just Right' },
              { value: 'too_hard', label: 'Too Hard' }
            ].map((option) => (
              <Button
                key={option.value}
                variant={rating.difficulty === option.value ? 'default' : 'outline'}
                onClick={() => setRating({ ...rating, difficulty: option.value })}
                className="flex-1"
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Relevance */}
        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">
            How relevant was this to your work? *
          </span>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((num) => (
              <button
                key={num}
                onClick={() => setRating({ ...rating, relevance: num })}
                className="focus:outline-none"
              >
                <Star
                  className={`w-8 h-8 ${
                    num <= rating.relevance
                      ? 'fill-blue-400 text-blue-400'
                      : 'text-slate-300'
                  }`}
                />
              </button>
            ))}
          </div>
        </div>

        {/* Would Recommend */}
        <div>
          <span className="text-sm font-medium text-slate-700 mb-2 block">
            Would you recommend this module to colleagues?
          </span>
          <div className="flex gap-2">
            <Button
              variant={rating.would_recommend ? 'default' : 'outline'}
              onClick={() => setRating({ ...rating, would_recommend: true })}
              className="flex-1"
            >
              Yes
            </Button>
            <Button
              variant={!rating.would_recommend ? 'default' : 'outline'}
              onClick={() => setRating({ ...rating, would_recommend: false })}
              className="flex-1"
            >
              No
            </Button>
          </div>
        </div>

        {/* Feedback */}
        <div>
          <label htmlFor="module-feedback" className="text-sm font-medium text-slate-700 mb-2 block">
            Additional feedback
          </label>
          <Textarea
            id="module-feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What did you like? What could be better?"
            rows={3}
          />
        </div>

        {/* Suggestions */}
        <div>
          <label htmlFor="module-suggestions" className="text-sm font-medium text-slate-700 mb-2 block">
            Suggestions for improvement
          </label>
          <Textarea
            id="module-suggestions"
            value={suggestions}
            onChange={(e) => setSuggestions(e.target.value)}
            placeholder="How can we make this module better?"
            rows={3}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={rating.effectiveness === 0 || rating.relevance === 0}
          className="w-full"
        >
          <Send className="w-4 h-4 mr-2" />
          Submit Feedback
        </Button>
      </CardContent>
    </Card>
  );
}