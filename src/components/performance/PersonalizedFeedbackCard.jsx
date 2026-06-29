import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageSquare, ThumbsUp, ThumbsDown, TrendingUp } from "lucide-react";

export default function PersonalizedFeedbackCard({ feedback, onAcknowledge }) {
  if (!feedback) return null;

  const priorityColor = {
    high: 'bg-red-500',
    medium: 'bg-yellow-500',
    low: 'bg-blue-500'
  };

  return (
    <Card className="border-indigo-200">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-navy-50">
        <CardTitle className="flex items-center gap-2 text-indigo-900">
          <MessageSquare className="w-5 h-5" />
          AI Coach Feedback
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start gap-3">
          <TrendingUp className="w-6 h-6 text-indigo-600 mt-1 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-slate-900 font-medium mb-2">{feedback.message}</p>
            <p className="text-sm text-slate-600">{feedback.details}</p>
          </div>
          <Badge className={priorityColor[feedback.priority] + ' text-white'}>
            {feedback.priority}
          </Badge>
        </div>

        {feedback.actionable_steps && (
          <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
            <p className="font-semibold text-blue-900 mb-2">Recommended Actions:</p>
            <ul className="space-y-1 text-sm text-blue-800">
              {feedback.actionable_steps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="text-blue-600">•</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {onAcknowledge && (
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={() => onAcknowledge(feedback.id, 'helpful')}
              variant="outline"
              className="flex-1"
            >
              <ThumbsUp className="w-3 h-3 mr-1" />
              Helpful
            </Button>
            <Button
              size="sm"
              onClick={() => onAcknowledge(feedback.id, 'not_helpful')}
              variant="outline"
              className="flex-1"
            >
              <ThumbsDown className="w-3 h-3 mr-1" />
              Not Helpful
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}