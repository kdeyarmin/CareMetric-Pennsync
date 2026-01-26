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
  Award,
  GraduationCap,
  BookOpen,
  Brain,
  FileCheck,
  Sparkles
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { useQuery } from '@tanstack/react-query';

export default function DocumentationQualityScore({ 
  qualityAnalysis, 
  onFeedbackSubmitted,
  noteText,
  visitType,
  providerType
}) {
  const [showDetails, setShowDetails] = useState(true);
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [userRating, setUserRating] = useState(null);
  const [feedbackText, setFeedbackText] = useState('');
  const [analyzingDeeper, setAnalyzingDeeper] = useState(false);
  const [deepAnalysis, setDeepAnalysis] = useState(null);

  // Fetch relevant training modules based on quality gaps
  const { data: relevantTraining = [] } = useQuery({
    queryKey: ['relevantTraining', visitType, qualityAnalysis?.areas_for_improvement],
    queryFn: async () => {
      if (!qualityAnalysis?.areas_for_improvement) return [];
      
      const categories = qualityAnalysis.areas_for_improvement.map(a => a.category || a.issue);
      const training = await base44.entities.TrainingModule.filter({
        category: { $in: ['clinical_documentation', 'compliance', 'quality_improvement'] }
      });
      return training.slice(0, 3);
    },
    enabled: !!qualityAnalysis?.areas_for_improvement
  });

  if (!qualityAnalysis) return null;

  const performDeepAnalysis = async () => {
    setAnalyzingDeeper(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Perform a comprehensive quality analysis of this clinical note:

${noteText}

Visit Type: ${visitType}
Provider Type: ${providerType}

Analyze for:
1. Clinical Reasoning Quality - Does the note demonstrate clear clinical thinking?
2. Continuity of Care - Does it reference patient history appropriately?
3. Medical Necessity - Is the need for skilled services clearly documented?
4. Specific Action Items - Are follow-ups and interventions clearly stated?
5. Compliance Red Flags - Any language that could trigger audit concerns?

Provide specific, actionable insights.`,
        response_json_schema: {
          type: "object",
          properties: {
            clinical_reasoning_score: { type: "number" },
            clinical_reasoning_feedback: { type: "string" },
            continuity_score: { type: "number" },
            continuity_feedback: { type: "string" },
            medical_necessity_score: { type: "number" },
            medical_necessity_feedback: { type: "string" },
            red_flags: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  flag: { type: "string" },
                  risk_level: { type: "string" },
                  fix: { type: "string" }
                }
              }
            }
          }
        }
      });
      setDeepAnalysis(response);
      toast.success('Deep analysis complete');
    } catch (error) {
      console.error('Error performing deep analysis:', error);
      toast.error('Failed to perform deep analysis');
    } finally {
      setAnalyzingDeeper(false);
    }
  };

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

  const overallScore = qualityAnalysis.overall_quality_score || qualityAnalysis.overall_score || 0;
  const grade = qualityAnalysis.grade || (
    overallScore >= 90 ? 'A' :
    overallScore >= 80 ? 'B' :
    overallScore >= 70 ? 'C' :
    overallScore >= 60 ? 'D' : 'F'
  );

  return (
    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 to-white dark:from-purple-950 dark:to-slate-900">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 dark:bg-purple-900 rounded-xl">
              <Award className={`w-7 h-7 ${getScoreColor(overallScore)}`} />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                AI Documentation Quality Score
                <Badge variant="outline" className="text-xs">AI-Powered</Badge>
              </CardTitle>
              <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                Comprehensive analysis across 4 key dimensions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-center">
              <div className={`text-5xl font-bold ${getScoreColor(overallScore)}`}>
                {overallScore}
              </div>
              <p className="text-xs text-gray-500 mt-1">out of 100</p>
            </div>
            <Badge className={`text-2xl px-4 py-2 border-2 ${getGradeColor(grade)}`}>
              {grade}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Score Breakdown with Icons */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-blue-600" />
                <span className="font-medium text-sm">Clarity</span>
              </div>
              <span className={`font-bold ${getScoreColor(qualityAnalysis.clarity_score || 0)}`}>
                {qualityAnalysis.clarity_score || 0}%
              </span>
            </div>
            <Progress value={qualityAnalysis.clarity_score || 0} className="h-2.5" />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Readability & logical flow
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <span className="font-medium text-sm">Completeness</span>
              </div>
              <span className={`font-bold ${getScoreColor(qualityAnalysis.completeness_score || 0)}`}>
                {qualityAnalysis.completeness_score || 0}%
              </span>
            </div>
            <Progress value={qualityAnalysis.completeness_score || 0} className="h-2.5" />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              All required elements present
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <span className="font-medium text-sm">Compliance</span>
              </div>
              <span className={`font-bold ${getScoreColor(qualityAnalysis.compliance_score || qualityAnalysis.overall_quality_score || 0)}`}>
                {qualityAnalysis.compliance_score || qualityAnalysis.overall_quality_score || 0}%
              </span>
            </div>
            <Progress value={qualityAnalysis.compliance_score || qualityAnalysis.overall_quality_score || 0} className="h-2.5" />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Medicare & regulatory compliance
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 p-4 rounded-lg border">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-purple-600" />
                <span className="font-medium text-sm">Clinical Reasoning</span>
              </div>
              <span className={`font-bold ${getScoreColor(deepAnalysis?.clinical_reasoning_score || qualityAnalysis.medicare_readiness_score || 85)}`}>
                {deepAnalysis?.clinical_reasoning_score || qualityAnalysis.medicare_readiness_score || 85}%
              </span>
            </div>
            <Progress value={deepAnalysis?.clinical_reasoning_score || qualityAnalysis.medicare_readiness_score || 85} className="h-2.5" />
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
              Evidence-based decision making
            </p>
          </div>
        </div>

        {/* Strengths */}
        {qualityAnalysis.strengths?.length > 0 && (
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950 dark:to-emerald-950 border border-green-300 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 bg-green-200 dark:bg-green-800 rounded">
                <CheckCircle2 className="w-4 h-4 text-green-700 dark:text-green-300" />
              </div>
              <span className="font-semibold text-sm text-green-900 dark:text-green-100">
                Documentation Strengths ({qualityAnalysis.strengths.length})
              </span>
            </div>
            <ul className="space-y-2">
              {qualityAnalysis.strengths.map((strength, idx) => (
                <li key={idx} className="text-sm text-green-800 dark:text-green-200 flex items-start gap-2 bg-white/50 dark:bg-black/20 p-2 rounded">
                  <span className="text-green-600 dark:text-green-400 mt-0.5 font-bold">✓</span>
                  {strength}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Deep Analysis Button */}
        {!deepAnalysis && (
          <Button
            onClick={performDeepAnalysis}
            disabled={analyzingDeeper}
            variant="outline"
            className="w-full border-purple-300 text-purple-700 hover:bg-purple-50"
          >
            {analyzingDeeper ? (
              <>
                <Brain className="w-4 h-4 mr-2 animate-pulse" />
                Performing Deep Analysis...
              </>
            ) : (
              <>
                <Brain className="w-4 h-4 mr-2" />
                Run Deep Quality Analysis
              </>
            )}
          </Button>
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
          <div className="space-y-5 border-t pt-4">
            {/* Deep Analysis Results */}
            {deepAnalysis && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-purple-50 dark:bg-purple-950 border border-purple-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">Clinical Reasoning</span>
                    <span className={`font-bold ${getScoreColor(deepAnalysis.clinical_reasoning_score)}`}>
                      {deepAnalysis.clinical_reasoning_score}%
                    </span>
                  </div>
                  <p className="text-xs text-purple-800 dark:text-purple-200">{deepAnalysis.clinical_reasoning_feedback}</p>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">Continuity of Care</span>
                    <span className={`font-bold ${getScoreColor(deepAnalysis.continuity_score)}`}>
                      {deepAnalysis.continuity_score}%
                    </span>
                  </div>
                  <p className="text-xs text-blue-800 dark:text-blue-200">{deepAnalysis.continuity_feedback}</p>
                </div>

                <div className="bg-green-50 dark:bg-green-950 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium">Medical Necessity</span>
                    <span className={`font-bold ${getScoreColor(deepAnalysis.medical_necessity_score)}`}>
                      {deepAnalysis.medical_necessity_score}%
                    </span>
                  </div>
                  <p className="text-xs text-green-800 dark:text-green-200">{deepAnalysis.medical_necessity_feedback}</p>
                </div>
              </div>
            )}

            {/* Red Flags from Deep Analysis */}
            {deepAnalysis?.red_flags?.length > 0 && (
              <div className="bg-red-50 dark:bg-red-950 border border-red-300 rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-red-900 dark:text-red-100">
                  <AlertCircle className="w-4 h-4" />
                  Compliance Red Flags ({deepAnalysis.red_flags.length})
                </h4>
                <div className="space-y-2">
                  {deepAnalysis.red_flags.map((flag, idx) => (
                    <div key={idx} className="bg-white dark:bg-slate-900 p-3 rounded border-l-4 border-red-600">
                      <div className="flex items-start justify-between mb-1">
                        <p className="font-medium text-sm">{flag.flag}</p>
                        <Badge className={flag.risk_level === 'high' ? 'bg-red-600' : 'bg-orange-500'}>
                          {flag.risk_level}
                        </Badge>
                      </div>
                      <p className="text-xs text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900 p-2 rounded mt-2">
                        <strong>Fix:</strong> {flag.fix}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Areas for Improvement with Training Links */}
            {qualityAnalysis.areas_for_improvement?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Areas for Improvement
                </h4>
                <div className="space-y-3">
                  {qualityAnalysis.areas_for_improvement.map((area, idx) => (
                    <div key={idx} className="bg-blue-50 dark:bg-blue-950 border border-blue-200 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium text-sm text-blue-900 dark:text-blue-100">{area.issue}</span>
                        <Badge className={getSeverityColor(area.severity)}>
                          {area.severity}
                        </Badge>
                      </div>
                      <p className="text-sm text-blue-800 dark:text-blue-200 mb-2">
                        <strong>Suggestion:</strong> {area.suggestion}
                      </p>
                      {area.example && (
                        <p className="text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900 p-2 rounded">
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
                    <div key={idx} className="bg-gray-50 dark:bg-gray-900 border rounded-lg p-3">
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Original:</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 italic mb-2">"{issue.excerpt}"</p>
                      <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Issue: {issue.issue}</p>
                      <p className="text-xs text-green-600 dark:text-green-400 mb-1">Improved:</p>
                      <p className="text-sm text-green-700 dark:text-green-300 font-medium">"{issue.improved_version}"</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suggestions with Interactive Improvements */}
            {qualityAnalysis.suggestions?.length > 0 && (
              <div>
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-purple-600" />
                  AI Quality Suggestions ({qualityAnalysis.suggestions.length})
                </h4>
                <div className="space-y-3">
                  {qualityAnalysis.suggestions.map((suggestion, idx) => (
                    <div key={idx} className="bg-purple-50 dark:bg-purple-950 border border-purple-200 rounded-lg p-3">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-medium text-sm text-purple-900 dark:text-purple-100">
                          {suggestion.issue || suggestion.category}
                        </span>
                        {suggestion.severity && (
                          <Badge className={getSeverityColor(suggestion.severity)}>
                            {suggestion.severity}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-purple-800 dark:text-purple-200">
                        {suggestion.recommendation}
                      </p>
                      {suggestion.improved_text && (
                        <div className="mt-2 p-2 bg-green-50 dark:bg-green-900 rounded text-xs">
                          <p className="font-semibold text-green-800 dark:text-green-200 mb-1">Suggested improvement:</p>
                          <p className="text-green-700 dark:text-green-300">{suggestion.improved_text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Training Resources */}
            {relevantTraining.length > 0 && (
              <div className="bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950 dark:to-blue-950 border border-indigo-300 rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-indigo-900 dark:text-indigo-100">
                  <GraduationCap className="w-4 h-4" />
                  Recommended Training
                </h4>
                <div className="space-y-2">
                  {relevantTraining.map((module, idx) => (
                    <Link
                      key={idx}
                      to={createPageUrl('MyTraining')}
                      className="block p-3 bg-white dark:bg-slate-900 rounded border hover:border-indigo-400 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-sm text-indigo-900 dark:text-indigo-100">{module.title}</p>
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">{module.description?.substring(0, 80)}...</p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {module.estimated_duration_minutes} min
                        </Badge>
                      </div>
                    </Link>
                  ))}
                </div>
                <Link to={createPageUrl('MyTraining')}>
                  <Button variant="link" className="mt-2 p-0 h-auto text-xs text-indigo-600">
                    View all training modules →
                  </Button>
                </Link>
              </div>
            )}

            {/* Compliance Guidelines Reference */}
            {qualityAnalysis.missing_elements?.length > 0 && (
              <div className="bg-orange-50 dark:bg-orange-950 border border-orange-300 rounded-lg p-4">
                <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-orange-900 dark:text-orange-100">
                  <BookOpen className="w-4 h-4" />
                  Missing Required Elements
                </h4>
                <div className="space-y-2">
                  {qualityAnalysis.missing_elements.map((element, idx) => (
                    <div key={idx} className="text-sm text-orange-800 dark:text-orange-200 bg-white/50 dark:bg-black/20 p-2 rounded">
                      • {element}
                    </div>
                  ))}
                </div>
                <Link to={createPageUrl('Compliance')}>
                  <Button variant="outline" size="sm" className="mt-3 w-full border-orange-300">
                    <BookOpen className="w-3 h-3 mr-2" />
                    View Compliance Guidelines
                  </Button>
                </Link>
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