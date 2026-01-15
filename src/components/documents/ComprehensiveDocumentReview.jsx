import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, Lightbulb, AlertTriangle, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

const getSeverityColor = (severity) => {
  switch (severity) {
    case 'high':
      return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
    case 'low':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

const ScoreGauge = ({ score, label, size = 'md' }) => {
  const isLow = score < 60;
  const isMedium = score >= 60 && score < 80;
  const isHigh = score >= 80;

  const sizeClasses = {
    sm: 'w-16 h-16',
    md: 'w-24 h-24',
    lg: 'w-32 h-32'
  };

  const textSizes = {
    sm: 'text-lg',
    md: 'text-2xl',
    lg: 'text-4xl'
  };

  const labelSizes = {
    sm: 'text-xs',
    md: 'text-sm',
    lg: 'text-base'
  };

  return (
    <div className="flex flex-col items-center">
      <div className={`${sizeClasses[size]} rounded-full flex items-center justify-center relative ${
        isLow ? 'bg-red-100 dark:bg-red-900' : isMedium ? 'bg-yellow-100 dark:bg-yellow-900' : 'bg-green-100 dark:bg-green-900'
      }`}>
        <div className={`${textSizes[size]} font-bold ${
          isLow ? 'text-red-700 dark:text-red-200' : isMedium ? 'text-yellow-700 dark:text-yellow-200' : 'text-green-700 dark:text-green-200'
        }`}>
          {score}
        </div>
      </div>
      <p className={`${labelSizes[size]} text-slate-600 dark:text-slate-400 mt-2 text-center font-medium`}>
        {label}
      </p>
    </div>
  );
};

export default function ComprehensiveDocumentReview({ documentContent, documentType, patientName, onApplyFix }) {
  const [review, setReview] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    concerns: true,
    phrasing: false,
    missing: false
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      const response = await base44.functions.invoke('comprehensiveDocumentReview', {
        document_content: documentContent,
        document_type: documentType,
        patient_name: patientName
      });
      return response.data || response;
    },
    onSuccess: (data) => {
      setReview(data.review);
    }
  });

  useEffect(() => {
    if (documentContent) {
      reviewMutation.mutate();
    }
  }, [documentContent]);

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  if (reviewMutation.isPending) {
    return (
      <Card className="border-purple-300 dark:border-purple-700">
        <CardContent className="p-6 text-center">
          <div className="animate-spin inline-block">
            <Sparkles className="w-6 h-6 text-purple-500" />
          </div>
          <p className="text-slate-600 dark:text-slate-400 mt-3">Reviewing document quality...</p>
        </CardContent>
      </Card>
    );
  }

  if (!review) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Overall Score Card */}
      <Card className="border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-slate-800 dark:to-slate-900">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              AI Document Quality Review
            </CardTitle>
            <Badge className={`${
              review.overall_score >= 80 ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
              review.overall_score >= 60 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200' :
              'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
            }`}>
              {review.overall_score >= 80 ? 'Excellent' : review.overall_score >= 60 ? 'Good' : 'Needs Improvement'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Summary */}
            <p className="text-slate-700 dark:text-slate-300 italic">{review.summary}</p>

            {/* Score Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <ScoreGauge score={review.overall_score} label="Overall" size="md" />
              <ScoreGauge score={review.clarity_score} label="Clarity" size="sm" />
              <ScoreGauge score={review.completeness_score} label="Completeness" size="sm" />
              <ScoreGauge score={review.accuracy_score} label="Accuracy" size="sm" />
              <ScoreGauge score={review.safety_score} label="Safety" size="sm" />
              <ScoreGauge score={review.compliance_score} label="Compliance" size="sm" />
              <ScoreGauge score={review.readability_score} label="Readability" size="sm" />
            </div>

            {/* Strengths */}
            {review.strengths && review.strengths.length > 0 && (
              <div className="space-y-2">
                <h4 className="font-semibold flex items-center gap-2 text-green-700 dark:text-green-300">
                  <CheckCircle2 className="w-5 h-5" />
                  Strengths
                </h4>
                <div className="space-y-1">
                  {review.strengths.map((strength, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <span className="text-green-600 dark:text-green-400 mt-1">✓</span>
                      <span>{strength}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Concerns Section */}
      {review.concerns && review.concerns.length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            onClick={() => toggleSection('concerns')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="w-5 h-5 text-orange-600" />
                Issues & Concerns ({review.concerns.length})
              </CardTitle>
              {expandedSections.concerns ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedSections.concerns && (
            <CardContent className="space-y-4">
              {review.concerns.map((concern, i) => (
                <div key={i} className="border-l-4 border-orange-400 pl-4 py-2 bg-slate-50 dark:bg-slate-800 rounded">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <h5 className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        {concern.section}
                      </h5>
                      <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">{concern.issue}</p>
                    </div>
                    <Badge className={getSeverityColor(concern.severity)}>
                      {concern.severity}
                    </Badge>
                  </div>
                  <div className="bg-blue-50 dark:bg-blue-900/30 rounded p-2 mt-2">
                    <p className="text-sm text-blue-900 dark:text-blue-200 font-medium">💡 Suggestion:</p>
                    <p className="text-sm text-blue-800 dark:text-blue-300 mt-1">{concern.suggestion}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Phrasing Suggestions */}
      {review.phrasing_suggestions && review.phrasing_suggestions.length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            onClick={() => toggleSection('phrasing')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="w-5 h-5 text-blue-600" />
                Phrasing Improvements ({review.phrasing_suggestions.length})
              </CardTitle>
              {expandedSections.phrasing ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedSections.phrasing && (
            <CardContent className="space-y-3">
              {review.phrasing_suggestions.map((suggestion, i) => (
                <div key={i} className="border-l-4 border-blue-400 pl-4 py-3 bg-blue-50 dark:bg-blue-900/20 rounded">
                  <div className="space-y-2">
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">ORIGINAL:</p>
                      <p className="text-sm italic text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-800 p-2 rounded border border-slate-200 dark:border-slate-700">
                        "{suggestion.original}"
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold mb-1">SUGGESTED:</p>
                      <p className="text-sm text-blue-700 dark:text-blue-300 bg-white dark:bg-slate-800 p-2 rounded border border-blue-200 dark:border-blue-700 font-medium">
                        "{suggestion.suggested}"
                      </p>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-semibold">Why:</span> {suggestion.reason}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      {/* Missing Elements */}
      {review.missing_elements && review.missing_elements.length > 0 && (
        <Card>
          <CardHeader
            className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            onClick={() => toggleSection('missing')}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertCircle className="w-5 h-5 text-red-600" />
                Missing Elements ({review.missing_elements.length})
              </CardTitle>
              {expandedSections.missing ? <ChevronUp /> : <ChevronDown />}
            </div>
          </CardHeader>
          {expandedSections.missing && (
            <CardContent>
              <ul className="space-y-2">
                {review.missing_elements.map((element, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <span className="text-red-600 dark:text-red-400 mt-1 font-bold">•</span>
                    <span>{element}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      )}

      {/* Action Items */}
      {review.action_items && review.action_items.length > 0 && (
        <Card className="border-green-300 dark:border-green-700 bg-green-50 dark:bg-slate-800">
          <CardHeader>
            <CardTitle className="text-base">Recommended Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {review.action_items.map((action, i) => (
                <li key={i} className="flex gap-3 text-sm text-slate-700 dark:text-slate-300">
                  <span className="flex-shrink-0 font-bold text-green-700 dark:text-green-300 bg-green-200 dark:bg-green-900 w-6 h-6 rounded-full flex items-center justify-center text-xs">
                    {i + 1}
                  </span>
                  <span>{action}</span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}