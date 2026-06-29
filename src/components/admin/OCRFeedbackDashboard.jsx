import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, TrendingUp, AlertCircle, CheckCircle } from "lucide-react";
import { format } from "date-fns";

export default function OCRFeedbackDashboard() {
  const { data: feedbacks = [] } = useQuery({
    queryKey: ['ocr-feedback'],
    queryFn: () => base44.entities.OCRFeedback.list('-created_date', 100),
    initialData: []
  });

  const stats = {
    total: feedbacks.length,
    minor: feedbacks.filter(f => f.correction_type === 'minor').length,
    moderate: feedbacks.filter(f => f.correction_type === 'moderate').length,
    major: feedbacks.filter(f => f.correction_type === 'major').length,
    applied: feedbacks.filter(f => f.applied_to_training).length
  };

  const accuracyRate = stats.total > 0 
    ? ((stats.minor / stats.total) * 100).toFixed(1)
    : 100;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="w-5 h-5 text-navy-600" />
          OCR Quality & Feedback Analytics
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg">
            <p className="text-sm text-slate-600">Total Corrections</p>
            <p className="text-2xl font-bold text-blue-600">{stats.total}</p>
          </div>
          <div className="p-4 bg-green-50 rounded-lg">
            <p className="text-sm text-slate-600">Minor Issues</p>
            <p className="text-2xl font-bold text-green-600">{stats.minor}</p>
          </div>
          <div className="p-4 bg-yellow-50 rounded-lg">
            <p className="text-sm text-slate-600">Moderate Issues</p>
            <p className="text-2xl font-bold text-yellow-600">{stats.moderate}</p>
          </div>
          <div className="p-4 bg-red-50 rounded-lg">
            <p className="text-sm text-slate-600">Major Issues</p>
            <p className="text-2xl font-bold text-red-600">{stats.major}</p>
          </div>
        </div>

        <div className="p-4 bg-gradient-to-r from-navy-50 to-indigo-50 rounded-lg border border-navy-200 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-600 mb-1">Estimated Accuracy Rate</p>
              <p className="text-3xl font-bold text-navy-600">{accuracyRate}%</p>
            </div>
            <TrendingUp className="w-8 h-8 text-navy-600" />
          </div>
        </div>

        {feedbacks.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900">Recent Corrections</h3>
            {feedbacks.slice(0, 5).map((feedback) => (
              <div key={feedback.id} className="p-3 bg-slate-50 rounded-lg border">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {feedback.correction_type === 'minor' ? (
                      <CheckCircle className="w-4 h-4 text-green-600" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                    )}
                    <span className="text-sm font-semibold capitalize">
                      {feedback.correction_type} Correction
                    </span>
                  </div>
                  <span className="text-xs text-slate-500">
                    {format(new Date(feedback.created_date), 'MMM d, yyyy')}
                  </span>
                </div>
                {feedback.document_type && (
                  <p className="text-xs text-slate-600 mb-1">
                    Document: {feedback.document_type}
                  </p>
                )}
                {feedback.feedback_notes && (
                  <p className="text-sm text-slate-700 mt-2 italic">
                    "{feedback.feedback_notes}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {feedbacks.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No OCR corrections yet</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}