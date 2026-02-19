import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { base44 } from '@/api/base44Client';
import { AlertCircle, CheckCircle2, Clock, Lightbulb, Loader2, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

export default function RealTimeOASISCompletenessPrompt({ 
  noteContent, 
  visitType, 
  patientDiagnoses,
  onItemClick 
}) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [autoCheckEnabled, setAutoCheckEnabled] = useState(true);

  useEffect(() => {
    if (!autoCheckEnabled || !noteContent || noteContent.length < 50) return;

    const debounceTimer = setTimeout(() => {
      checkCompleteness();
    }, 3000); // Check 3 seconds after user stops typing

    return () => clearTimeout(debounceTimer);
  }, [noteContent, autoCheckEnabled]);

  const checkCompleteness = async () => {
    if (!noteContent) return;

    setLoading(true);
    try {
      const response = await base44.functions.invoke('realtimeOASISCompleteness', {
        note_content: noteContent,
        visit_type: visitType,
        patient_diagnoses: patientDiagnoses
      });

      if (response.data.success) {
        setAnalysis(response.data);
      }
    } catch (error) {
      console.error('OASIS completeness check failed:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-300';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default: return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getScoreColor = (score) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    return 'text-red-600';
  };

  if (!analysis && !loading) {
    return (
      <Card className="border-blue-200">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-blue-600" />
            OASIS Completeness Assistant
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-slate-600 mb-3">
            Auto-checking your note for missing OASIS data points...
          </p>
          <Button 
            size="sm" 
            variant="outline" 
            onClick={checkCompleteness}
            className="w-full"
          >
            Check Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-blue-600" />
            OASIS Documentation Status
          </CardTitle>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-blue-600" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {analysis && (
          <>
            {/* Completeness Score */}
            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <span className="text-xs font-medium text-slate-700">Completeness Score</span>
              <span className={`text-xl font-bold ${getScoreColor(analysis.completeness_score)}`}>
                {analysis.completeness_score}%
              </span>
            </div>

            {/* Next Best Action */}
            {analysis.next_best_action && (
              <Alert className="border-blue-200 bg-blue-50">
                <Lightbulb className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-xs text-blue-900">
                  <strong>Next:</strong> {analysis.next_best_action}
                </AlertDescription>
              </Alert>
            )}

            {/* Missing Items */}
            {analysis.missing_items && analysis.missing_items.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-700">Missing OASIS Items:</p>
                {analysis.missing_items.map((item, idx) => (
                  <div 
                    key={idx} 
                    className={`p-3 rounded-lg border ${getSeverityColor(item.severity)} cursor-pointer hover:shadow-sm transition-shadow`}
                    onClick={() => onItemClick && onItemClick(item)}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="h-3 w-3 flex-shrink-0 mt-0.5" />
                        <span className="text-xs font-semibold">{item.oasis_item}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {item.severity}
                      </Badge>
                    </div>
                    <p className="text-xs mb-1">{item.prompt}</p>
                    <p className="text-[10px] opacity-75">{item.why_needed}</p>
                    {item.location_in_note && (
                      <p className="text-[10px] mt-1 opacity-60">
                        📍 {item.location_in_note}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-xs text-green-800 font-medium">
                  All critical OASIS items documented!
                </span>
              </div>
            )}

            {/* Documentation Quality */}
            {analysis.documentation_quality && (
              <div className="p-2 bg-slate-50 rounded text-xs text-slate-600 border border-slate-200">
                <strong>Quality:</strong> {analysis.documentation_quality}
              </div>
            )}

            {/* Auto-check toggle */}
            <div className="flex items-center justify-between pt-2 border-t">
              <span className="text-xs text-slate-600">Auto-check enabled</span>
              <Button
                size="sm"
                variant={autoCheckEnabled ? "default" : "outline"}
                onClick={() => setAutoCheckEnabled(!autoCheckEnabled)}
                className="h-6 text-xs"
              >
                {autoCheckEnabled ? 'On' : 'Off'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}