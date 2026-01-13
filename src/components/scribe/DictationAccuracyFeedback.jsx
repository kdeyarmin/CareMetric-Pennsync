import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Zap, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function DictationAccuracyFeedback({ rawTranscription, refinedNote, selectedLanguage = 'en' }) {
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(false);
  const [analyzed, setAnalyzed] = useState(false);

  useEffect(() => {
    if (rawTranscription && refinedNote && rawTranscription.length > 50) {
      analyzeDictation();
    }
  }, [rawTranscription, refinedNote]);

  const analyzeDictation = async () => {
    if (!rawTranscription || !refinedNote) return;

    setLoading(true);
    try {
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical transcription quality expert. Analyze the dictation accuracy by comparing the raw transcription with the refined clinical note.

Language: ${selectedLanguage}

Raw Transcription:
${rawTranscription}

Refined Note:
${refinedNote}

Provide feedback on:
1. Transcription accuracy (percentage estimate)
2. Common transcription errors detected (medical terms, abbreviations, numbers)
3. Clarity issues in original dictation
4. Areas needing improved enunciation
5. Suggested corrections for future dictation

Return as JSON:
{
  "accuracy_score": number (0-100),
  "transcription_errors": [
    {
      "original": string,
      "corrected": string,
      "type": string,
      "tip": string
    }
  ],
  "clarity_issues": [string],
  "improvement_tips": [string],
  "overall_feedback": string
}`,
        response_json_schema: {
          type: 'object',
          properties: {
            accuracy_score: { type: 'number' },
            transcription_errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  original: { type: 'string' },
                  corrected: { type: 'string' },
                  type: { type: 'string' },
                  tip: { type: 'string' }
                }
              }
            },
            clarity_issues: { type: 'array', items: { type: 'string' } },
            improvement_tips: { type: 'array', items: { type: 'string' } },
            overall_feedback: { type: 'string' }
          }
        }
      });

      setFeedback(response);
      setAnalyzed(true);
    } catch (error) {
      console.error('Dictation analysis error:', error);
      toast.error('Failed to analyze dictation accuracy');
    } finally {
      setLoading(false);
    }
  };

  if (!rawTranscription || !refinedNote) {
    return null;
  }

  const getScoreColor = (score) => {
    if (score >= 90) return 'bg-green-100 text-green-800';
    if (score >= 75) return 'bg-yellow-100 text-yellow-800';
    return 'bg-red-100 text-red-800';
  };

  const getScoreIcon = (score) => {
    if (score >= 90) return <CheckCircle2 className="w-4 h-4" />;
    if (score >= 75) return <AlertCircle className="w-4 h-4" />;
    return <AlertCircle className="w-4 h-4" />;
  };

  return (
    <Card className="border-purple-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm md:text-base flex items-center gap-2">
            <Zap className="w-4 h-4 text-purple-600" />
            Dictation Quality
          </CardTitle>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-purple-600" />}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {feedback ? (
          <>
            {/* Accuracy Score */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Transcription Accuracy</span>
              <div className="flex items-center gap-2">
                {getScoreIcon(feedback.accuracy_score)}
                <Badge className={getScoreColor(feedback.accuracy_score)}>
                  {feedback.accuracy_score}%
                </Badge>
              </div>
            </div>

            {/* Overall Feedback */}
            {feedback.overall_feedback && (
              <Alert className="bg-purple-50 border-purple-200">
                <AlertDescription className="text-xs text-purple-800">
                  {feedback.overall_feedback}
                </AlertDescription>
              </Alert>
            )}

            {/* Transcription Errors */}
            {feedback.transcription_errors && feedback.transcription_errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Common Errors Detected</p>
                {feedback.transcription_errors.slice(0, 3).map((error, idx) => (
                  <div key={idx} className="bg-slate-50 p-2 rounded text-xs">
                    <p className="text-slate-600">
                      <span className="line-through text-red-600">{error.original}</span>
                      {' → '}
                      <span className="text-green-600 font-medium">{error.corrected}</span>
                    </p>
                    <p className="text-slate-500 mt-1">💡 {error.tip}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Clarity Issues */}
            {feedback.clarity_issues && feedback.clarity_issues.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Areas for Improvement</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {feedback.clarity_issues.map((issue, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span>•</span> {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Improvement Tips */}
            {feedback.improvement_tips && feedback.improvement_tips.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Tips for Better Dictation</p>
                <ul className="space-y-1 text-xs text-slate-600">
                  {feedback.improvement_tips.slice(0, 3).map((tip, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span>✓</span> {tip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="text-xs text-slate-600">
            {loading ? 'Analyzing dictation quality...' : 'Dictation analysis will appear here after transcription'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}