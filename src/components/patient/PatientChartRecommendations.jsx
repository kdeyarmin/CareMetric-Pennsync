import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Lightbulb, CheckCircle2, XCircle, Clock, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

export default function PatientChartRecommendations({ patientId }) {
  const [selectedRec, setSelectedRec] = useState(null);
  const [implementationNotes, setImplementationNotes] = useState("");
  const queryClient = useQueryClient();

  const { data: recommendations = [], isLoading } = useQuery({
    queryKey: ['patientRecommendations', patientId],
    queryFn: () => base44.entities.PatientRecommendation.filter({ patient_id: patientId }, '-created_date', 100),
    enabled: !!patientId
  });

  const updateRecommendationMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PatientRecommendation.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patientRecommendations', patientId] });
      setSelectedRec(null);
      setImplementationNotes("");
    },
  });

  const handleAccept = async () => {
    if (!selectedRec) return;
    
    await updateRecommendationMutation.mutateAsync({
      id: selectedRec.id,
      data: {
        status: 'accepted',
        reviewed_at: new Date().toISOString()
      }
    });
  };

  const handleComplete = async () => {
    if (!selectedRec) return;
    
    await updateRecommendationMutation.mutateAsync({
      id: selectedRec.id,
      data: {
        status: 'completed',
        implemented_at: new Date().toISOString(),
        implementation_notes: implementationNotes
      }
    });
  };

  const handleReject = async () => {
    if (!selectedRec) return;
    
    await updateRecommendationMutation.mutateAsync({
      id: selectedRec.id,
      data: {
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        implementation_notes: implementationNotes || 'Not applicable'
      }
    });
  };

  const pendingRecs = recommendations.filter(r => r.status === 'pending');
  const acceptedRecs = recommendations.filter(r => r.status === 'accepted');
  const _completedRecs = recommendations.filter(r => r.status === 'completed');

  if (isLoading) {
    return <Card><CardContent className="p-6 text-center text-slate-500">Loading recommendations...</CardContent></Card>;
  }

  if (recommendations.length === 0) {
    return null;
  }

  return (
    <Card className="border-2 border-navy-200">
      <CardHeader className="bg-gradient-to-r from-navy-50 to-gold-50">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" />
          AI-Generated Recommendations ({pendingRecs.length} pending)
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-3">
          {pendingRecs.map((rec) => (
            <Card key={rec.id} className="border-l-4 border-l-navy-500 cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => setSelectedRec(rec)}
            >
              <CardContent className="p-3">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <p className="font-semibold text-slate-900">{rec.title}</p>
                    <p className="text-xs text-slate-500">{rec.description?.substring(0, 100)}...</p>
                  </div>
                  <div className="flex flex-col gap-1 items-end">
                    <Badge className={
                      rec.priority === 'critical' ? 'bg-red-600' :
                      rec.priority === 'high' ? 'bg-orange-500' :
                      'bg-yellow-500'
                    }>
                      {rec.priority}
                    </Badge>
                    <Badge variant="outline" className="text-xs">{(rec.recommendation_type || '').replace(/_/g, ' ')}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Clock className="w-3 h-3" />
                  <span>{new Date(rec.created_date).toLocaleDateString()}</span>
                  <span>•</span>
                  <span>From {(rec.source_type || '').replace(/_/g, ' ')}</span>
                </div>
              </CardContent>
            </Card>
          ))}

          {acceptedRecs.length > 0 && (
            <div className="pt-3 border-t">
              <p className="text-sm font-semibold text-slate-700 mb-2">Accepted ({acceptedRecs.length})</p>
              {acceptedRecs.slice(0, 3).map((rec) => (
                <div key={rec.id} className="p-2 bg-green-50 rounded border border-green-200 mb-2 text-sm">
                  <p className="font-medium text-green-900">{rec.title}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail Dialog */}
        <Dialog open={!!selectedRec} onOpenChange={() => setSelectedRec(null)}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Lightbulb className="w-5 h-5 text-navy-600" />
                {selectedRec?.title}
              </DialogTitle>
            </DialogHeader>
            
            {selectedRec && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-semibold text-slate-700 mb-1">Description:</p>
                  <p className="text-sm text-slate-800">{selectedRec.description}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-slate-600">Priority:</p>
                    <Badge className={getSeverityColor(selectedRec.priority)}>{selectedRec.priority}</Badge>
                  </div>
                  <div>
                    <p className="text-xs text-slate-600">Type:</p>
                    <Badge variant="outline">{(selectedRec.recommendation_type || '').replace(/_/g, ' ')}</Badge>
                  </div>
                </div>

                {selectedRec.ai_rationale && (
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <p className="text-xs text-blue-700 font-semibold mb-1">AI Rationale:</p>
                    <p className="text-sm text-blue-900">{selectedRec.ai_rationale}</p>
                  </div>
                )}

                {selectedRec.expected_impact && (
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <p className="text-xs text-green-700 font-semibold mb-1">Expected Impact:</p>
                    <p className="text-sm text-green-900">{selectedRec.expected_impact}</p>
                  </div>
                )}

                {selectedRec.implementation_steps?.length > 0 && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Implementation Steps:</p>
                    <ol className="space-y-1">
                      {selectedRec.implementation_steps.map((step, idx) => (
                        <li key={idx} className="text-sm text-slate-800 flex items-start gap-2">
                          <span className="bg-navy-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs flex-shrink-0">
                            {idx + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {selectedRec.status === 'pending' && (
                  <div>
                    <p className="text-sm font-semibold text-slate-700 mb-2">Implementation Notes (optional):</p>
                    <Textarea
                      value={implementationNotes}
                      onChange={(e) => setImplementationNotes(e.target.value)}
                      placeholder="Add notes about implementation or why rejecting..."
                      className="h-20"
                    />
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              {selectedRec?.status === 'pending' && (
                <>
                  <Button variant="outline" onClick={handleReject}>
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject
                  </Button>
                  <Button variant="outline" onClick={handleAccept} className="bg-green-50">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Accept
                  </Button>
                  <Button onClick={handleComplete} className="bg-navy-600 hover:bg-navy-700">
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Complete
                  </Button>
                </>
              )}
              {selectedRec?.status !== 'pending' && (
                <Button variant="outline" onClick={() => setSelectedRec(null)}>Close</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {pendingRecs.length > 0 && (
          <div className="flex items-center justify-between pt-3 border-t mt-4">
            <p className="text-sm text-slate-600">{recommendations.length} total recommendations</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const getSeverityColor = (priority) => {
  switch (priority) {
    case 'critical': return 'bg-red-600 text-white';
    case 'high': return 'bg-orange-500 text-white';
    case 'medium': return 'bg-yellow-500 text-white';
    case 'low': return 'bg-blue-500 text-white';
    default: return 'bg-slate-500 text-white';
  }
};