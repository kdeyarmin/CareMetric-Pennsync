import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronUp,
  Eye,
  FileText
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";

export default function PendingPatientUpdates() {
  const [expandedUpdates, setExpandedUpdates] = useState({});
  const [reviewingUpdate, setReviewingUpdate] = useState(null);
  const [reviewNotes, setReviewNotes] = useState("");
  const queryClient = useQueryClient();

  const { data: pendingUpdates = [], isLoading } = useQuery({
    queryKey: ['pendingPatientUpdates'],
    queryFn: () => base44.entities.PendingPatientUpdate.filter({ status: 'pending' }, '-created_date'),
    initialData: []
  });

  const { data: patients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: () => base44.entities.Patient.list('-updated_date', 2000),
    initialData: []
  });

  const approveMutation = useMutation({
    mutationFn: async ({ updateId, patientId, updates }) => {
      // patientId is passed by the caller (it has the row) instead of re-finding
      // it in pendingUpdates — the list invalidates on every approve/reject and on
      // ['patients'] changes, so find() could return undefined between render and
      // click and crash on update.patient_id.
      await base44.entities.Patient.update(patientId, updates);
      
      // Mark as approved
      await base44.entities.PendingPatientUpdate.update(updateId, {
        status: 'approved',
        reviewed_by: (await base44.auth.me()).email,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingPatientUpdates'] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      setReviewingUpdate(null);
      setReviewNotes("");
    },
    onError: (error) => {
      // Keep the dialog open so the reviewer can retry; surface the failure.
      toast.error(`Failed to approve update: ${error?.message || 'Unknown error'}`);
    }
  });

  const rejectMutation = useMutation({
    mutationFn: async (updateId) => {
      await base44.entities.PendingPatientUpdate.update(updateId, {
        status: 'rejected',
        reviewed_by: (await base44.auth.me()).email,
        reviewed_at: new Date().toISOString(),
        review_notes: reviewNotes
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingPatientUpdates'] });
      setReviewingUpdate(null);
      setReviewNotes("");
    },
    onError: (error) => {
      // Keep the dialog open so the reviewer can retry; surface the failure.
      toast.error(`Failed to reject update: ${error?.message || 'Unknown error'}`);
    }
  });

  const getPatient = (patientId) => {
    return patients.find(p => p.id === patientId);
  };

  const getSeverityBadge = (changeType) => {
    const badges = {
      critical: { color: 'bg-red-100 text-red-800 border-red-300', icon: AlertTriangle },
      moderate: { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
      minor: { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: FileText }
    };
    const badge = badges[changeType] || badges.minor;
    const Icon = badge.icon;
    return (
      <Badge className={badge.color}>
        <Icon className="w-3 h-3 mr-1" />
        {changeType}
      </Badge>
    );
  };

  const toggleUpdate = (index) => {
    setExpandedUpdates(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const handleApprove = (update) => {
    approveMutation.mutate({
      updateId: update.id,
      patientId: update.patient_id,
      updates: update.proposed_updates
    });
  };

  const handleReject = (updateId) => {
    rejectMutation.mutate(updateId);
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-slate-500">
          Loading pending updates...
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-orange-600" />
            Pending Patient Updates
            {pendingUpdates.length > 0 && (
              <Badge className="bg-orange-100 text-orange-800">{pendingUpdates.length}</Badge>
            )}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {pendingUpdates.length === 0 ? (
          <div className="text-center py-8 text-slate-500">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3 text-green-500" />
            <p>No pending updates requiring review</p>
          </div>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-3">
              {(pendingUpdates || []).map((update, idx) => {
                const patient = getPatient(update.patient_id);
                if (!patient) return null;

                return (
                  <Collapsible key={update.id} open={expandedUpdates[idx]}>
                    <div className={`border rounded-lg p-4 ${
                      update.change_type === 'critical' ? 'border-red-300 bg-red-50' :
                      update.change_type === 'moderate' ? 'border-yellow-300 bg-yellow-50' :
                      'border-blue-300 bg-blue-50'
                    }`}>
                      <CollapsibleTrigger
                        onClick={() => toggleUpdate(idx)}
                        className="w-full flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-slate-900">
                                {patient.first_name} {patient.last_name}
                              </span>
                              {getSeverityBadge(update.change_type)}
                              {update.conflict_detected && (
                                <Badge className="bg-red-100 text-red-800">
                                  <AlertTriangle className="w-3 h-3 mr-1" />
                                  Conflict
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm text-slate-600">
                              {(update.field_changes || []).length} field{(update.field_changes || []).length > 1 ? 's' : ''} to review
                              {(update.field_changes || []).filter(c => c.is_critical).length > 0 && (
                                <span className="text-red-600 ml-2">
                                  • {(update.field_changes || []).filter(c => c.is_critical).length} critical
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              setReviewingUpdate(update);
                            }}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Review
                          </Button>
                          {expandedUpdates[idx] ? (
                            <ChevronUp className="w-5 h-5" />
                          ) : (
                            <ChevronDown className="w-5 h-5" />
                          )}
                        </div>
                      </CollapsibleTrigger>

                      <CollapsibleContent className="mt-4 space-y-2">
                        {update.conflict_detected && (
                          <Alert variant="destructive" className="mb-3">
                            <AlertTriangle className="w-4 h-4" />
                            <AlertDescription>
                              <strong>Data Conflict Detected:</strong> The uploaded file contains values that differ from existing data. Please review carefully.
                            </AlertDescription>
                          </Alert>
                        )}

                        {(update.field_changes || []).map((change, changeIdx) => (
                          <div
                            key={changeIdx}
                            className={`p-3 rounded border ${
                              change.is_critical ? 'border-red-300 bg-white' : 'border-slate-200 bg-white'
                            }`}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <span className="font-medium text-slate-900">
                                {(change.field || '').replace(/_/g, ' ')}
                              </span>
                              {change.is_critical && (
                                <Badge variant="destructive" className="text-xs">Critical</Badge>
                              )}
                            </div>
                            <div className="space-y-1 text-sm">
                              <div className="flex items-start gap-2">
                                <span className="text-red-600 font-mono">-</span>
                                <span className="text-red-600 flex-1">
                                  {typeof change.old_value === 'object'
                                    ? JSON.stringify(change.old_value)
                                    : change.old_value || '(empty)'}
                                </span>
                              </div>
                              <div className="flex items-start gap-2">
                                <span className="text-green-600 font-mono">+</span>
                                <span className="text-green-600 flex-1">
                                  {typeof change.new_value === 'object'
                                    ? JSON.stringify(change.new_value)
                                    : change.new_value}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}

                        <div className="flex gap-2 mt-4 pt-3 border-t">
                          <Button
                            onClick={() => handleApprove(update)}
                            disabled={approveMutation.isPending}
                            className="flex-1 bg-green-600 hover:bg-green-700"
                          >
                            <CheckCircle2 className="w-4 h-4 mr-2" />
                            Approve & Apply
                          </Button>
                          <Button
                            onClick={() => handleReject(update.id)}
                            disabled={rejectMutation.isPending}
                            variant="destructive"
                            className="flex-1"
                          >
                            <XCircle className="w-4 h-4 mr-2" />
                            Reject
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>
        )}

        {/* Review Dialog */}
        <Dialog open={!!reviewingUpdate} onOpenChange={() => setReviewingUpdate(null)}>
          <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Review Patient Update</DialogTitle>
              <DialogDescription>
                Review and approve or reject changes for {reviewingUpdate && getPatient(reviewingUpdate.patient_id)?.first_name} {reviewingUpdate && getPatient(reviewingUpdate.patient_id)?.last_name}
              </DialogDescription>
            </DialogHeader>

            {reviewingUpdate && (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  {getSeverityBadge(reviewingUpdate.change_type)}
                  {reviewingUpdate.conflict_detected && (
                    <Badge className="bg-red-100 text-red-800">
                      <AlertTriangle className="w-3 h-3 mr-1" />
                      Has Conflicts
                    </Badge>
                  )}
                </div>

                {reviewingUpdate.conflict_detected && (
                  <Alert variant="destructive">
                    <AlertTriangle className="w-4 h-4" />
                    <AlertDescription>
                      This update contains data conflicts. Existing values differ from uploaded data.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-3">
                  <h4 className="font-semibold">Proposed Changes:</h4>
                  {(reviewingUpdate.field_changes || []).map((change, idx) => (
                    <div key={idx} className={`p-3 rounded border ${
                      change.is_critical ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50'
                    }`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium">{(change.field || '').replace(/_/g, ' ')}</span>
                        {change.is_critical && (
                          <Badge variant="destructive" className="text-xs">Critical Field</Badge>
                        )}
                      </div>
                      <div className="space-y-1 text-sm">
                        <div className="text-red-600">
                          Old: {typeof change.old_value === 'object'
                            ? JSON.stringify(change.old_value, null, 2)
                            : change.old_value || '(empty)'}
                        </div>
                        <div className="text-green-600">
                          New: {typeof change.new_value === 'object'
                            ? JSON.stringify(change.new_value, null, 2)
                            : change.new_value}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div>
                  <label htmlFor="pending-review-notes" className="block text-sm font-medium mb-2">Review Notes (Optional)</label>
                  <Textarea
                    id="pending-review-notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Add any notes about this review..."
                    className="h-24"
                  />
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => handleApprove(reviewingUpdate)}
                    disabled={approveMutation.isPending}
                    className="flex-1 bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-2" />
                    Approve & Apply Changes
                  </Button>
                  <Button
                    onClick={() => handleReject(reviewingUpdate.id)}
                    disabled={rejectMutation.isPending}
                    variant="destructive"
                    className="flex-1"
                  >
                    <XCircle className="w-4 h-4 mr-2" />
                    Reject Changes
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}