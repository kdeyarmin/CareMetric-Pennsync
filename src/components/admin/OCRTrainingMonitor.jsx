import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, TrendingUp, Play, Loader2, CheckCircle, XCircle, Clock, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

export default function OCRTrainingMonitor() {
  const queryClient = useQueryClient();
  const [expandedSession, setExpandedSession] = useState(null);

  const { data: trainingSessions = [] } = useQuery({
    queryKey: ['ocr-training-sessions'],
    queryFn: () => base44.entities.OCRTrainingSession.list('-created_date', 50),
    initialData: [],
    refetchInterval: 5000 // Poll every 5 seconds for active training
  });

  const { data: unappliedFeedback = [] } = useQuery({
    queryKey: ['unapplied-feedback'],
    queryFn: () => base44.entities.OCRFeedback.filter({ applied_to_training: false }),
    initialData: []
  });

  const retrainMutation = useMutation({
    mutationFn: () => base44.functions.invoke('retrainOCRModel', { min_feedback_count: 5 }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['ocr-training-sessions'] });
      queryClient.invalidateQueries({ queryKey: ['unapplied-feedback'] });
      const data = result?.data;
      if (data?.success) {
        toast.success(`Training completed! Improvement: ${data.improvement}%`);
      } else {
        toast.info(data?.message || 'Training did not run.');
      }
    },
    onError: (error) => {
      toast.error("Training failed: " + error.message);
    }
  });

  const latestSession = trainingSessions[0];
  const activeSession = trainingSessions.find(s => s.status === 'in_progress');

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed': return <CheckCircle className="w-4 h-4 text-green-600" />;
      case 'failed': return <XCircle className="w-4 h-4 text-red-600" />;
      case 'in_progress': return <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />;
      default: return <Clock className="w-4 h-4 text-slate-600" />;
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-800';
      case 'failed': return 'bg-red-100 text-red-800';
      case 'in_progress': return 'bg-blue-100 text-blue-800';
      default: return 'bg-slate-100 text-slate-800';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-navy-600" />
            OCR Model Training & Accuracy
          </div>
          <Button
            onClick={() => retrainMutation.mutate()}
            disabled={retrainMutation.isPending || activeSession || unappliedFeedback.length < 5}
            size="sm"
          >
            {retrainMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Play className="w-4 h-4 mr-2" />
            )}
            Retrain Model
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Status Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-navy-50 rounded-lg border border-navy-200">
            <p className="text-sm text-slate-600 mb-1">Available Feedback</p>
            <p className="text-3xl font-bold text-navy-600">{unappliedFeedback.length}</p>
            <p className="text-xs text-slate-500 mt-1">
              {unappliedFeedback.length >= 5 ? 'Ready for training' : 'Need 5+ for training'}
            </p>
          </div>

          {latestSession && (
            <>
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-slate-600 mb-1">Current Accuracy</p>
                <p className="text-3xl font-bold text-blue-600">
                  {latestSession.accuracy_after?.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  From latest training
                </p>
              </div>

              <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                <p className="text-sm text-slate-600 mb-1">Last Improvement</p>
                <p className="text-3xl font-bold text-green-600 flex items-center gap-1">
                  <TrendingUp className="w-6 h-6" />
                  +{latestSession.improvement_percentage?.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  {format(new Date(latestSession.created_date), 'MMM d, yyyy')}
                </p>
              </div>
            </>
          )}
        </div>

        {/* Active Training */}
        {activeSession && (
          <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg border-2 border-blue-300">
            <div className="flex items-center gap-3 mb-2">
              <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
              <h3 className="font-semibold text-blue-900">Training in Progress...</h3>
            </div>
            <p className="text-sm text-blue-800">
              Processing {activeSession.feedback_count} feedback corrections
            </p>
          </div>
        )}

        {/* Training History */}
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Training History
          </h3>

          {trainingSessions.length === 0 ? (
            <div className="text-center py-8 text-slate-500 bg-slate-50 rounded-lg">
              <Brain className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">No training sessions yet</p>
              <p className="text-xs mt-1">Collect feedback and start your first training</p>
            </div>
          ) : (
            trainingSessions.map((session) => (
              <Card key={session.id} className="border hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(session.status)}
                      <div>
                        <h4 className="font-semibold text-slate-900">{session.session_name}</h4>
                        <p className="text-xs text-slate-500">
                          {format(new Date(session.created_date), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(session.status)}>
                      {session.status}
                    </Badge>
                  </div>

                  {session.status === 'completed' && (
                    <div className="grid grid-cols-3 gap-3 mb-3">
                      <div className="text-center p-2 bg-slate-50 rounded">
                        <p className="text-xs text-slate-600">Feedback Used</p>
                        <p className="font-bold text-slate-900">{session.feedback_count}</p>
                      </div>
                      <div className="text-center p-2 bg-blue-50 rounded">
                        <p className="text-xs text-slate-600">Accuracy</p>
                        <p className="font-bold text-blue-600">
                          {session.accuracy_before?.toFixed(1)}% → {session.accuracy_after?.toFixed(1)}%
                        </p>
                      </div>
                      <div className="text-center p-2 bg-green-50 rounded">
                        <p className="text-xs text-slate-600">Improvement</p>
                        <p className="font-bold text-green-600">
                          +{session.improvement_percentage?.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  )}

                  {session.training_metrics && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedSession(
                        expandedSession === session.id ? null : session.id
                      )}
                      className="w-full"
                    >
                      {expandedSession === session.id ? 'Hide' : 'View'} Details
                    </Button>
                  )}

                  {expandedSession === session.id && session.training_metrics && (
                    <div className="mt-3 p-3 bg-slate-50 rounded-lg border space-y-2">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <span className="text-slate-600">Minor: </span>
                          <span className="font-semibold">{session.training_metrics.minor_corrections}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Moderate: </span>
                          <span className="font-semibold">{session.training_metrics.moderate_corrections}</span>
                        </div>
                        <div>
                          <span className="text-slate-600">Major: </span>
                          <span className="font-semibold">{session.training_metrics.major_corrections}</span>
                        </div>
                      </div>
                      {session.document_types_trained?.length > 0 && (
                        <div className="text-xs">
                          <span className="text-slate-600">Document Types: </span>
                          <span className="font-semibold">
                            {session.document_types_trained.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {session.error_message && (
                    <div className="mt-3 p-2 bg-red-50 rounded text-xs text-red-800">
                      <AlertCircle className="w-3 h-3 inline mr-1" />
                      {session.error_message}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}