import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Lightbulb, AlertTriangle, Zap } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

const getSeverityColor = (severity) => {
  switch (severity?.toLowerCase()) {
    case 'critical':
      return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800';
    case 'high':
      return 'text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-950 border-orange-200 dark:border-orange-800';
    case 'medium':
      return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-950 border-yellow-200 dark:border-yellow-800';
    default:
      return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800';
  }
};

const getScoreColor = (score) => {
  if (score >= 90) return 'text-green-600 dark:text-green-400';
  if (score >= 75) return 'text-blue-600 dark:text-blue-400';
  if (score >= 60) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
};

const getScoreBgColor = (score) => {
  if (score >= 90) return 'bg-green-100 dark:bg-green-950';
  if (score >= 75) return 'bg-blue-100 dark:bg-blue-950';
  if (score >= 60) return 'bg-yellow-100 dark:bg-yellow-950';
  return 'bg-red-100 dark:bg-red-950';
};

export default function DocumentAIReview({ review, loading }) {
  if (loading) {
    return (
      <Card className="border-slate-300 dark:border-slate-600">
        <CardHeader>
          <CardTitle>AI Document Review</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-slate-500">
            Analyzing document quality...
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!review) return null;

  const assessment = review.overall_assessment || {};
  const hasIssues = [
    review.clarity_issues,
    review.completeness_issues,
    review.potential_errors,
    review.best_practice_gaps
  ].some(arr => arr?.length > 0);

  return (
    <div className="space-y-4">
      {/* Overall Assessment */}
      <Card className="border-slate-300 dark:border-slate-600">
        <CardHeader>
          <CardTitle>Quality Assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {assessment.critical_issues && (
            <div className="p-4 rounded-lg border-2 border-red-300 bg-red-50 dark:bg-red-950 dark:border-red-700">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-red-900 dark:text-red-100">Critical Issues Found</p>
                  <p className="text-sm text-red-800 dark:text-red-200">{assessment.critical_issues}</p>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Clarity', score: assessment.clarity_score },
              { label: 'Completeness', score: assessment.completeness_score },
              { label: 'Accuracy', score: assessment.accuracy_score },
              { label: 'Overall Quality', score: assessment.overall_quality_score }
            ].map(({ label, score }) => (
              <div key={label} className={`p-3 rounded-lg ${getScoreBgColor(score)}`}>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{label}</p>
                <p className={`text-2xl font-bold ${getScoreColor(score)}`}>{score || '—'}%</p>
                <Progress value={score || 0} className="mt-2 h-1.5" />
              </div>
            ))}
          </div>

          <p className="text-sm text-slate-600 dark:text-slate-400 italic">
            {assessment.summary}
          </p>
        </CardContent>
      </Card>

      {/* Clarity Issues */}
      {review.clarity_issues?.length > 0 && (
        <Card className="border-blue-300 dark:border-blue-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <CardTitle className="text-base">Clarity Issues ({review.clarity_issues.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {review.clarity_issues.map((issue, idx) => (
              <div key={idx} className="p-3 border-l-4 border-blue-300 dark:border-blue-600 bg-blue-50 dark:bg-slate-800 rounded">
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">{issue.location}</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">{issue.issue}</p>
                <div className="flex gap-2">
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Suggestion:</span>
                  <span className="text-xs text-slate-700 dark:text-slate-300 italic">"{issue.suggestion}"</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Language Improvements */}
      {review.language_improvements?.length > 0 && (
        <Card className="border-purple-300 dark:border-purple-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              <CardTitle className="text-base">Patient-Friendly Language ({review.language_improvements.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {review.language_improvements.map((improvement, idx) => (
              <div key={idx} className="p-3 border-l-4 border-purple-300 dark:border-purple-600 bg-purple-50 dark:bg-slate-800 rounded">
                <div className="flex gap-3 text-sm">
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Current:</p>
                    <p className="text-slate-600 dark:text-slate-400 line-through">"{improvement.current}"</p>
                  </div>
                  <div className="hidden sm:block">→</div>
                  <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">Better:</p>
                    <p className="text-green-600 dark:text-green-400">"{improvement.suggested}"</p>
                  </div>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">{improvement.reason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Potential Errors */}
      {review.potential_errors?.length > 0 && (
        <Card className="border-red-300 dark:border-red-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400" />
              <CardTitle className="text-base">Potential Errors ({review.potential_errors.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {review.potential_errors.map((error, idx) => (
              <div key={idx} className="p-3 border-l-4 border-red-300 dark:border-red-600 bg-red-50 dark:bg-slate-800 rounded">
                <div className="flex items-start gap-2">
                  <Badge className="mt-0.5 flex-shrink-0 bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200">
                    {error.type}
                  </Badge>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">{error.location}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">{error.issue}</p>
                    <p className="text-sm font-medium text-green-600 dark:text-green-400">Fix: {error.correction}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Best Practice Gaps */}
      {review.best_practice_gaps?.length > 0 && (
        <Card className="border-orange-300 dark:border-orange-700">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-orange-600 dark:text-orange-400" />
              <CardTitle className="text-base">Best Practice Recommendations ({review.best_practice_gaps.length})</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {review.best_practice_gaps.map((gap, idx) => (
              <div key={idx} className="p-3 border-l-4 border-orange-300 dark:border-orange-600 bg-orange-50 dark:bg-slate-800 rounded">
                <p className="text-xs font-semibold text-orange-700 dark:text-orange-300 mb-1">{gap.standard}</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 mb-2">{gap.gap}</p>
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400">→ {gap.recommendation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* No Issues */}
      {!hasIssues && assessment.overall_quality_score >= 80 && (
        <Card className="border-green-300 dark:border-green-700 bg-green-50 dark:bg-slate-900">
          <CardContent className="flex items-center gap-3 py-6">
            <CheckCircle2 className="w-6 h-6 text-green-600 dark:text-green-400 flex-shrink-0" />
            <div>
              <p className="font-semibold text-green-900 dark:text-green-100">Excellent Quality</p>
              <p className="text-sm text-green-700 dark:text-green-300">This document meets all quality standards and is ready for patient distribution.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}