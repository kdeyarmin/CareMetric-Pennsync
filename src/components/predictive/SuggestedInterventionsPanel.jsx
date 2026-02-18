import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CheckCircle, X, Edit2, Sparkles, Clock, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function SuggestedInterventionsPanel({ patientId }) {
  const [editingSuggestion, setEditingSuggestion] = useState(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: suggestions = [], isLoading } = useQuery({
    queryKey: ['suggestedInterventions', patientId],
    queryFn: () => base44.entities.SuggestedIntervention.filter({
      patient_id: patientId,
      status: 'pending_review'
    }, '-created_date', 10)
  });

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const confirmMutation = useMutation({
    mutationFn: async ({ suggestion, customData }) => {
      // Create intervention log
      const interventionData = {
        patient_id: suggestion.patient_id,
        prediction_type: suggestion.prediction_type,
        risk_analysis_id: suggestion.risk_analysis_id,
        original_risk_score: suggestion.risk_score,
        intervention_category: customData?.intervention_category || suggestion.suggested_intervention_category,
        intervention_description: customData?.intervention_description || suggestion.suggested_intervention_description,
        intervention_date: customData?.intervention_date || new Date().toISOString().split('T')[0],
        performed_by: user.email,
        performed_by_name: user.full_name,
        expected_outcome: customData?.expected_outcome || suggestion.suggested_expected_outcome,
        patient_response: customData?.patient_response || 'positive',
        time_spent_minutes: customData?.time_spent_minutes,
        notes: customData?.notes
      };

      const log = await base44.entities.InterventionLog.create(interventionData);

      // Update suggestion status
      await base44.entities.SuggestedIntervention.update(suggestion.id, {
        status: customData ? 'modified' : 'confirmed',
        intervention_log_id: log.id
      });

      return log;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestedInterventions'] });
      queryClient.invalidateQueries({ queryKey: ['interventionLogs'] });
      toast.success('Intervention confirmed and logged');
      setEditDialogOpen(false);
      setEditingSuggestion(null);
    }
  });

  const dismissMutation = useMutation({
    mutationFn: async ({ suggestionId, reason }) => {
      await base44.entities.SuggestedIntervention.update(suggestionId, {
        status: 'dismissed',
        dismissed_reason: reason,
        dismissed_by: user.email,
        dismissed_at: new Date().toISOString()
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suggestedInterventions'] });
      toast.success('Suggestion dismissed');
    }
  });

  const handleQuickConfirm = (suggestion) => {
    confirmMutation.mutate({ suggestion, customData: null });
  };

  const handleEditAndConfirm = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const customData = {
      intervention_category: formData.get('intervention_category'),
      intervention_description: formData.get('intervention_description'),
      intervention_date: formData.get('intervention_date'),
      expected_outcome: formData.get('expected_outcome'),
      patient_response: formData.get('patient_response'),
      time_spent_minutes: formData.get('time_spent_minutes') ? parseInt(formData.get('time_spent_minutes')) : undefined,
      notes: formData.get('notes')
    };

    confirmMutation.mutate({ suggestion: editingSuggestion, customData });
  };

  const getPriorityBadge = (priority) => {
    const badges = {
      immediate: { color: 'bg-red-100 text-red-800', label: 'Immediate' },
      high: { color: 'bg-orange-100 text-orange-800', label: 'High Priority' },
      moderate: { color: 'bg-yellow-100 text-yellow-800', label: 'Moderate' },
      low: { color: 'bg-blue-100 text-blue-800', label: 'Low Priority' }
    };
    return badges[priority] || badges.moderate;
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading suggestions...</div>;
  }

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <>
      <Card className="border-2 border-blue-200 bg-blue-50/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-blue-900">
            <Sparkles className="h-5 w-5" />
            AI-Suggested Interventions ({suggestions.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              High-risk predictions detected. Review and confirm suggested interventions below.
            </AlertDescription>
          </Alert>

          {suggestions.map((suggestion) => {
            const priorityBadge = getPriorityBadge(suggestion.priority);
            const daysUntilExpiry = suggestion.expires_at 
              ? Math.ceil((new Date(suggestion.expires_at) - new Date()) / (1000 * 60 * 60 * 24))
              : null;

            return (
              <Card key={suggestion.id} className="border-2 bg-white">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge className={priorityBadge.color}>
                          {priorityBadge.label}
                        </Badge>
                        <Badge variant="outline" className="capitalize">
                          {suggestion.prediction_type.replace(/_/g, ' ')}
                        </Badge>
                        <Badge className="bg-red-100 text-red-800">
                          Risk: {suggestion.risk_score}%
                        </Badge>
                        {daysUntilExpiry !== null && daysUntilExpiry <= 3 && (
                          <Badge variant="outline" className="text-orange-600">
                            <Clock className="h-3 w-3 mr-1" />
                            {daysUntilExpiry}d left
                          </Badge>
                        )}
                      </div>
                      <p className="font-medium mb-2">{suggestion.suggested_intervention_description}</p>
                      {suggestion.suggested_expected_outcome && (
                        <p className="text-sm text-gray-600 mb-2">
                          <span className="font-medium">Expected Outcome:</span> {suggestion.suggested_expected_outcome}
                        </p>
                      )}
                      {suggestion.suggested_actions?.length > 0 && (
                        <div className="text-sm">
                          <div className="font-medium mb-1">Implementation Steps:</div>
                          <ul className="list-disc list-inside space-y-1 text-gray-600">
                            {suggestion.suggested_actions.slice(0, 3).map((action, idx) => (
                              <li key={idx}>{action}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-3 border-t">
                    <Button
                      size="sm"
                      onClick={() => handleQuickConfirm(suggestion)}
                      disabled={confirmMutation.isPending}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <CheckCircle className="h-4 w-4 mr-1" />
                      Quick Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingSuggestion(suggestion);
                        setEditDialogOpen(true);
                      }}
                    >
                      <Edit2 className="h-4 w-4 mr-1" />
                      Edit & Confirm
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        if (confirm('Dismiss this suggestion?')) {
                          dismissMutation.mutate({
                            suggestionId: suggestion.id,
                            reason: 'Not applicable'
                          });
                        }
                      }}
                      disabled={dismissMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Dismiss
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </CardContent>
      </Card>

      {/* Edit & Confirm Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit & Confirm Intervention</DialogTitle>
            <DialogDescription>
              Review and modify the suggested intervention before confirming
            </DialogDescription>
          </DialogHeader>
          {editingSuggestion && (
            <form onSubmit={handleEditAndConfirm} className="space-y-4">
              <div className="p-3 bg-blue-50 rounded text-sm">
                <div className="font-medium mb-1">Original Suggestion:</div>
                <div>{editingSuggestion.suggested_intervention_description}</div>
                <div className="mt-2 text-xs text-gray-600">
                  Risk Score: {editingSuggestion.risk_score}% | Type: {editingSuggestion.prediction_type.replace(/_/g, ' ')}
                </div>
              </div>

              <div>
                <Label>Intervention Category</Label>
                <Select name="intervention_category" defaultValue={editingSuggestion.suggested_intervention_category}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="medication_adjustment">Medication Adjustment</SelectItem>
                    <SelectItem value="therapy_referral">Therapy Referral</SelectItem>
                    <SelectItem value="care_plan_update">Care Plan Update</SelectItem>
                    <SelectItem value="monitoring_increase">Monitoring Increase</SelectItem>
                    <SelectItem value="equipment_provision">Equipment Provision</SelectItem>
                    <SelectItem value="education_provided">Education Provided</SelectItem>
                    <SelectItem value="physician_consult">Physician Consult</SelectItem>
                    <SelectItem value="environmental_modification">Environmental Modification</SelectItem>
                    <SelectItem value="caregiver_support">Caregiver Support</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Intervention Description</Label>
                <Textarea
                  name="intervention_description"
                  defaultValue={editingSuggestion.suggested_intervention_description}
                  rows={4}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Intervention Date</Label>
                  <Input
                    type="date"
                    name="intervention_date"
                    defaultValue={new Date().toISOString().split('T')[0]}
                    required
                  />
                </div>
                <div>
                  <Label>Time Spent (minutes)</Label>
                  <Input
                    type="number"
                    name="time_spent_minutes"
                    placeholder="e.g., 30"
                  />
                </div>
              </div>

              <div>
                <Label>Expected Outcome</Label>
                <Textarea
                  name="expected_outcome"
                  defaultValue={editingSuggestion.suggested_expected_outcome}
                  rows={2}
                />
              </div>

              <div>
                <Label>Patient Response</Label>
                <Select name="patient_response" defaultValue="positive">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="very_positive">Very Positive</SelectItem>
                    <SelectItem value="positive">Positive</SelectItem>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="resistant">Resistant</SelectItem>
                    <SelectItem value="refused">Refused</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Additional Notes</Label>
                <Textarea
                  name="notes"
                  placeholder="Any modifications or additional observations..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={confirmMutation.isPending}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Confirm Intervention
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}