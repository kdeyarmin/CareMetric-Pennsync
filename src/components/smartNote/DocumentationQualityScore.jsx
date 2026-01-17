import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { 
  CheckCircle2, 
  AlertCircle, 
  TrendingUp, 
  Star,
  ThumbsUp,
  ThumbsDown,
  MessageSquare,
  Award
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';

export default function DocumentationQualityScore({ 
  qualityAnalysis, 
  onFeedbackSubmitted,
  noteText,
  visitType,
  providerType
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [userRating, setUserRating] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');

  if (!qualityAnalysis) return null;

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-blue-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getGradeColor = (grade) => {
    const colors = {
      'A': 'bg-green-100 text-green-800 border-green-300',
      'B': 'bg-blue-100 text-blue-800 border-blue-300',
      'C': 'bg-yellow-100 text-yellow-800 border-yellow-300',
      'D': 'bg-orange-100 text-orange-800 border-orange-300',
      'F': 'bg-red-100 text-red-800 border-red-300'
    };
    return colors[grade] || colors['C'];
  };

  const getSeverityColor = (severity) => {
    const colors = {
      high: 'bg-red-100 text-red-800',
      medium: 'bg-yellow-100 text-yellow-800',
      low: 'bg-blue-100 text-blue-800'
    };
    return colors[severity] || colors.medium;
  };

  const submitFeedback = async () => {
    if (!userRating) {
      toast.error('Please rate the quality analysis');
      return;
    }

    try {
      const user = await base44.auth.me();
      
      await base44.entities.AIFeedback.create({
        user_email: user.email,
        ai_suggestion_type: 'note_enhancement',
        suggestion_content: JSON.stringify(qualityAnalysis),
        user_action: userRating >= 4 ? 'accepted' : 'rejected',
        helpful_rating: userRating,
        accuracy_rating: userRating,
        feedback_text: feedbackText,
        context_data: {
          visit_type: visitType,
          provider_type: providerType,
          overall_score: qualityAnalysis.overall_score,
          grade: qualityAnalysis.grade
        },
        is_processed: false
      });

      toast.success('Thank you for your feedback! This helps improve our AI.');
      setFeedbackMode(false);
      if (onFeedbackSubmitted) onFeedbackSubmitted();
    } catch (error) {
      console.error('Error submitting feedback:', error);
      toast.error('Failed to submit feedback');
    }
  };

  return (
    <Card className="border-2">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Award className={`w-6 h-6 ${getScoreColor(qualityAnalysis.overall_score)}`} />
            <div>
              <CardTitle className="text-lg">Documentation Quality Score</CardTitle>
              <p className="text-sm text-gray-600 mt-1">{qualityAnalysis.summary}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`text-4xl font-bold ${getScoreColor(qualityAnalysis.overall_score)}`}>
              {qualityAnalysis.overall_score}
            </div>
            <Badge className={`text-lg px-3 py-1 border-2 ${getGradeColor(qualityAnalysis.grade)}`}>
              Grade {qualityAnalysis.grade}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Score Breakdown */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Clarity</span>
              <span className={getScoreColor(qualityAnalysis.clarity_score)}>
                {qualityAnalysis.clarity_score}%
              </span>
            </div>
            <Progress value={qualityAnalysis.clarity_score} className="h-2" />
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Completeness</span>
              <span className={getScoreColor(qualityAnalysis.completeness_score)}>
                {qualityAnalysis.completeness_score}%
              </span>
            </div>
            <Progress value={qualityAnalysis.completeness_score} className="h-2" />
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Compliance</span>
              <span className={getScoreColor(qualityAnalysis.compliance_score)}>
                {qualityAnalysis.compliance_score}%
              </span>
            </div>
            <Progress value={qualityAnalysis.compliance_score} className="h-2" />
          </div>

          <div>
            <div className="flex justify-between text-sm mb-1">
              <span>Medicare Ready</span>
              <span className={getScoreColor(qualityAnalysis.medicare_readiness_score)}>
                {qualityAnalysis.medicare_readiness_score}%
              </span>
            </div>
            <Progress value={qualityAnalysis.medicare_readiness_score} className="h-2" />
          </div>
        </div>

        {/* Strengths */}
        {qualityAnalysis.strengths?.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <span className="font-semibold text-sm text-green-800">Strengths</span>
            </div>
            <ul className="space-y-1">
              {qualityAnalysis.strengths.map((strength, idx) => (
                <li key={idx} className="text-sm text-green-700 flex items-start gap-2">
                  <span className="text-green-600 mt-0.5">•</span>
                  {strength}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Toggle Details */}
        <Button
          variant="outline"
          onClick={() => setShowDetails(!showDetails)}
          className="w-full"
        >
          {showDetails ? 'Hide' : 'Show'} Detailed Feedback
        </Button>

        {/* Detailed Feedback */}
        {showDetails && (
          <div className="space-y-4 border-t pt-4">
            {/* Areas for Improvement */}
            {qualityAnalysis.areas_for_improvement?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4" />
                  Areas for Improvement
                </h4>
                <div className="space-y-3">
                  {qualityAnalysis.areas_for_improvement.map((area, idx) => (
                    <div key={idx} className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium text-sm text-blue-900">{area.issue}</span>
                        <Badge className={getSeverityColor(area.severity)}>
                          {area.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-blue-800 mb-2">
                        <strong>Suggestion:</strong> {area.suggestion}
                      </p>
                      {area.example && (
                        <p className="text-xs text-blue-700 bg-blue-100 p-2 rounded">
                          <strong>Example:</strong> {area.example}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compliance Gaps */}
            {qualityAnalysis.compliance_gaps?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-600" />
                  Compliance Gaps
                </h4>
                <div className="space-y-2">
                  {qualityAnalysis.compliance_gaps.map((gap, idx) => (
                    <div key={idx} className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <p className="text-sm font-medium text-orange-900">{gap.requirement}</p>
                      <p className="text-sm text-orange-800 mt-1">
                        <strong>Missing:</strong> {gap.missing_element}
                      </p>
                      <p className="text-xs text-orange-700 mt-2 bg-orange-100 p-2 rounded">
                        <strong>Add:</strong> {gap.recommended_addition}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Clarity Issues */}
            {qualityAnalysis.clarity_issues?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3">Clarity Improvements</h4>
                <div className="space-y-2">
                  {qualityAnalysis.clarity_issues.map((issue, idx) => (
                    <div key={idx} className="bg-gray-50 border rounded-lg p-3">
                      <p className="text-xs text-gray-600 mb-1">Original:</p>
                      <p className="text-sm text-gray-700 italic mb-2">"{issue.excerpt}"</p>
                      <p className="text-xs text-gray-600 mb-1">Issue: {issue.issue}</p>
                      <p className="text-xs text-green-600 mb-1">Improved:</p>
                      <p className="text-sm text-green-700 font-medium">"{issue.improved_version}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Feedback Section */}
        {!feedbackMode ? (
          <Button
            onClick={() => setFeedbackMode(true)}
            variant="outline"
            className="w-full border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Provide Feedback on This Analysis
          </Button>
        ) : (
          <div className="border border-blue-200 rounded-lg p-4 bg-blue-50 space-y-3">
            <p className="text-sm font-medium">How helpful was this quality analysis?</p>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  key={rating}
                  onClick={() => setUserRating(rating)}
                  className={`p-2 rounded ${
                    userRating === rating
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border hover:bg-blue-100'
                  }`}
                >
                  <Star className="w-5 h-5" fill={userRating >= rating ? 'currentColor' : 'none'} />
                </button>
              ))}
            </div>
            <Textarea
              placeholder="Any additional feedback? (optional)"
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              className="h-20"
            />
            <div className="flex gap-2">
              <Button onClick={submitFeedback} className="bg-blue-600 hover:bg-blue-700">
                Submit Feedback
              </Button>
              <Button onClick={() => setFeedbackMode(false)} variant="outline">
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}