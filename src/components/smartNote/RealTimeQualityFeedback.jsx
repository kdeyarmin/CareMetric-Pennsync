import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Sparkles, AlertTriangle, CheckCircle2, Lightbulb, 
  ArrowRight, Copy, TrendingUp, Loader2, Eye
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function RealTimeQualityFeedback({ 
  noteContent, 
  visitType, 
  diagnosis,
  patientId,
  onApplySuggestion 
}) {
  const [analysis, setAnalysis] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [autoAnalyze, setAutoAnalyze] = useState(false);
  const [expandedSuggestion, setExpandedSuggestion] = useState(null);

  // Debounced auto-analysis
  useEffect(() => {
    if (!autoAnalyze || !noteContent || noteContent.length < 50) return;

    const timer = setTimeout(() => {
      analyzeQuality();
    }, 3000); // Wait 3 seconds after typing stops

    return () => clearTimeout(timer);
  }, [noteContent, autoAnalyze]);

  const analyzeQuality = async () => {
    if (!noteContent || noteContent.length < 20) return;

    setAnalyzing(true);

    try {
      const { analyzeDocumentationQuality } = await import('@/functions/analyzeDocumentationQuality');
      const response = await analyzeDocumentationQuality({
        note_content: noteContent,
        visit_type: visitType,
        diagnosis: diagnosis,
        patient_id: patientId
      });

      setAnalysis(response.data.quality_analysis);
    } catch (error) {
      console.error('Quality analysis failed:', error);
    } finally {
      setAnalyzing(false);
    }
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'clarity': return AlertTriangle;
      case 'completeness': return CheckCircle2;
      case 'best_practice': return TrendingUp;
      case 'alternative_phrasing': return Lightbulb;
      case 'additional_detail': return Eye;
      case 'ambiguity': return AlertTriangle;
      default: return Sparkles;
    }
  };

  const getCategoryColor = (category) => {
    switch (category) {
      case 'clarity': return 'text-orange-600';
      case 'completeness': return 'text-blue-600';
      case 'best_practice': return 'text-green-600';
      case 'alternative_phrasing': return 'text-purple-600';
      case 'additional_detail': return 'text-indigo-600';
      case 'ambiguity': return 'text-red-600';
      default: return 'text-gray-600';
    }
  };

  const getSeverityBadge = (severity) => {
    switch (severity) {
      case 'critical': return <Badge className="bg-red-600">Critical</Badge>;
      case 'important': return <Badge className="bg-orange-500">Important</Badge>;
      case 'minor': return <Badge className="bg-blue-500">Minor</Badge>;
      default: return <Badge variant="outline">Info</Badge>;
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-blue-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <Card className="border-l-4 border-l-purple-600">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="w-5 h-5 text-purple-600" />
            Real-Time Quality Feedback
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={autoAnalyze ? "default" : "outline"}
              onClick={() => setAutoAnalyze(!autoAnalyze)}
              className="text-xs"
            >
              {autoAnalyze ? 'Auto: ON' : 'Auto: OFF'}
            </Button>
            <Button
              size="sm"
              onClick={analyzeQuality}
              disabled={analyzing || !noteContent}
              className="bg-purple-600 hover:bg-purple-700"
            >
              {analyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                'Analyze Now'
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {analyzing && (
          <div className="text-center py-6">
            <Loader2 className="w-8 h-8 animate-spin text-purple-600 mx-auto mb-2" />
            <p className="text-sm text-gray-600">Analyzing documentation quality...</p>
          </div>
        )}

        {!analysis && !analyzing && (
          <div className="text-center py-6">
            <Sparkles className="w-12 h-12 text-purple-300 mx-auto mb-3" />
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {autoAnalyze 
                ? 'AI will analyze your note as you type...' 
                : 'Click "Analyze Now" for real-time quality feedback'}
            </p>
          </div>
        )}

        {analysis && !analyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Quality Scores */}
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center p-3 bg-purple-50 dark:bg-purple-950 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Overall</p>
                <p className={`text-2xl font-bold ${getScoreColor(analysis.overall_quality_score)}`}>
                  {analysis.overall_quality_score}
                </p>
                <Progress value={analysis.overall_quality_score} className="mt-2" />
              </div>
              <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Clarity</p>
                <p className={`text-2xl font-bold ${getScoreColor(analysis.clarity_score)}`}>
                  {analysis.clarity_score}
                </p>
                <Progress value={analysis.clarity_score} className="mt-2" />
              </div>
              <div className="text-center p-3 bg-green-50 dark:bg-green-950 rounded-lg">
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Complete</p>
                <p className={`text-2xl font-bold ${getScoreColor(analysis.completeness_score)}`}>
                  {analysis.completeness_score}
                </p>
                <Progress value={analysis.completeness_score} className="mt-2" />
              </div>
            </div>

            {/* Strengths */}
            {analysis.strengths?.length > 0 && (
              <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-3">
                <p className="text-sm font-semibold text-green-800 dark:text-green-200 mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  What's Working Well
                </p>
                <ul className="space-y-1">
                  {analysis.strengths.map((strength, idx) => (
                    <li key={idx} className="text-xs text-green-700 dark:text-green-300 flex items-start gap-2">
                      <span className="text-green-600">✓</span>
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Suggestions */}
            {analysis.suggestions?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">
                  Improvement Suggestions ({analysis.suggestions.length})
                </p>
                {analysis.suggestions.map((suggestion, idx) => {
                  const Icon = getCategoryIcon(suggestion.category);
                  const isExpanded = expandedSuggestion === idx;

                  return (
                    <motion.div
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className={`border-2 rounded-lg p-3 cursor-pointer transition-all ${
                        isExpanded ? 'border-purple-400 bg-purple-50 dark:bg-purple-950' : 'border-gray-200 dark:border-gray-700'
                      }`}
                      onClick={() => setExpandedSuggestion(isExpanded ? null : idx)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${getCategoryColor(suggestion.category)}`} />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              {getSeverityBadge(suggestion.severity)}
                              <Badge variant="outline" className="text-xs">
                                {suggestion.category.replace(/_/g, ' ')}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                              {suggestion.issue}
                            </p>
                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="space-y-2 mt-3"
                              >
                                {suggestion.excerpt && (
                                  <div className="bg-yellow-50 dark:bg-yellow-950 border-l-4 border-yellow-400 p-2 rounded">
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Current text:</p>
                                    <p className="text-sm text-gray-800 dark:text-gray-200 italic">
                                      "{suggestion.excerpt}"
                                    </p>
                                  </div>
                                )}
                                <div className="bg-blue-50 dark:bg-blue-950 border-l-4 border-blue-400 p-2 rounded">
                                  <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Recommendation:</p>
                                  <p className="text-sm text-gray-800 dark:text-gray-200">
                                    {suggestion.recommendation}
                                  </p>
                                </div>
                                {suggestion.improved_text && (
                                  <div className="bg-green-50 dark:bg-green-950 border-l-4 border-green-400 p-2 rounded">
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-1">Suggested text:</p>
                                    <p className="text-sm text-gray-800 dark:text-gray-200">
                                      "{suggestion.improved_text}"
                                    </p>
                                    <div className="flex gap-2 mt-2">
                                      <Button
                                        size="sm"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (onApplySuggestion) {
                                            onApplySuggestion(suggestion.improved_text, suggestion.excerpt);
                                          }
                                        }}
                                        className="bg-green-600 hover:bg-green-700 text-xs"
                                      >
                                        <CheckCircle2 className="w-3 h-3 mr-1" />
                                        Apply
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          navigator.clipboard.writeText(suggestion.improved_text);
                                        }}
                                        className="text-xs"
                                      >
                                        <Copy className="w-3 h-3 mr-1" />
                                        Copy
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            )}
                          </div>
                        </div>
                        <ArrowRight 
                          className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${
                            isExpanded ? 'rotate-90' : ''
                          }`} 
                        />
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}