import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { 
  Calendar, 
  Clock, 
  User, 
  TrendingDown, 
  TrendingUp, 
  CheckCircle,
  AlertCircle,
  Edit2
} from 'lucide-react';
import { toast } from 'sonner';

export default function InterventionHistory({ patientId, predictionType }) {
  const [selectedLog, setSelectedLog] = useState(null);
  const [outcomeDialogOpen, setOutcomeDialogOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: interventions = [], isLoading } = useQuery({
    queryKey: ['interventionLogs', patientId, predictionType],
    queryFn: () => base44.entities.InterventionLog.filter({
      patient_id: patientId,
      prediction_type: predictionType
    }, '-intervention_date', 20)
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.InterventionLog.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interventionLogs'] });
      setOutcomeDialogOpen(false);
      setSelectedLog(null);
      toast.success('Outcome updated successfully');
    }
  });

  const handleUpdateOutcome = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    
    const user = base44.auth.me();
    const outcomeData = {
      outcome_status: formData.get('outcome_status'),
      outcome_description: formData.get('outcome_description'),
      outcome_assessed_date: formData.get('outcome_assessed_date'),
      outcome_assessed_by: user.email,
      follow_up_risk_score: parseFloat(formData.get('follow_up_risk_score')) || undefined,
      effectiveness_rating: parseInt(formData.get('effectiveness_rating')) || undefined,
      barriers_encountered: formData.get('barriers_encountered')?.split('\n').filter(Boolean) || []
    };

    if (outcomeData.follow_up_risk_score && selectedLog.original_risk_score) {
      outcomeData.risk_reduction_achieved = 
        ((selectedLog.original_risk_score - outcomeData.follow_up_risk_score) / selectedLog.original_risk_score) * 100;
    }

    updateMutation.mutate({ id: selectedLog.id, data: outcomeData });
  };

  const getOutcomeBadge = (status) => {
    const badges = {
      pending: { color: 'bg-yellow-100 text-yellow-800', label: 'Pending' },
      improved: { color: 'bg-green-100 text-green-800', label: 'Improved' },
      stable: { color: 'bg-blue-100 text-blue-800', label: 'Stable' },
      declined: { color: 'bg-red-100 text-red-800', label: 'Declined' },
      no_change: { color: 'bg-gray-100 text-gray-800', label: 'No Change' },
      adverse_event: { color: 'bg-red-200 text-red-900', label: 'Adverse Event' }
    };
    return badges[status] || badges.pending;
  };

  if (isLoading) {
    return <div className="text-sm text-gray-500">Loading interventions...</div>;
  }

  if (interventions.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-gray-500">
          No interventions logged yet for this prediction type
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {interventions.map((intervention) => {
          const outcomeBadge = getOutcomeBadge(intervention.outcome_status);
          return (
            <Card key={intervention.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant="outline" className="capitalize">
                        {intervention.intervention_category?.replace(/_/g, ' ')}
                      </Badge>
                      <Badge className={outcomeBadge.color}>
                        {outcomeBadge.label}
                      </Badge>
                      {intervention.risk_reduction_achieved !== undefined && (
                        <Badge className="bg-green-100 text-green-800 flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          {intervention.risk_reduction_achieved.toFixed(1)}% reduction
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm mb-2">{intervention.intervention_description}</p>
                    {intervention.outcome_description && (
                      <p className="text-sm text-gray-600 bg-gray-50 p-2 rounded mb-2">
                        <span className="font-medium">Outcome: </span>
                        {intervention.outcome_description}
                      </p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {new Date(intervention.intervention_date).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {intervention.performed_by_name || intervention.performed_by}
                      </span>
                      {intervention.time_spent_minutes && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {intervention.time_spent_minutes} min
                        </span>
                      )}
                      {intervention.original_risk_score && (
                        <span>Risk: {intervention.original_risk_score}%</span>
                      )}
                      {intervention.follow_up_risk_score && (
                        <span>→ {intervention.follow_up_risk_score}%</span>
                      )}
                    </div>
                    {intervention.requires_follow_up && intervention.follow_up_date && (
                      <div className="mt-2 text-xs text-orange-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Follow-up scheduled: {new Date(intervention.follow_up_date).toLocaleDateString()}
                      </div>
                    )}
                    {intervention.effectiveness_rating && (
                      <div className="mt-2 text-xs text-gray-600">
                        Effectiveness: {'⭐'.repeat(intervention.effectiveness_rating)}
                      </div>
                    )}
                  </div>
                  {intervention.outcome_status === 'pending' && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setSelectedLog(intervention);
                        setOutcomeDialogOpen(true);
                      }}
                    >
                      <Edit2 className="h-4 w-4 mr-1" />
                      Record Outcome
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Outcome Recording Dialog */}
      <Dialog open={outcomeDialogOpen} onOpenChange={setOutcomeDialogOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Intervention Outcome</DialogTitle>
            <DialogDescription>
              Document the observed outcome of this intervention
            </DialogDescription>
          </DialogHeader>
          {selectedLog && (
            <form onSubmit={handleUpdateOutcome} className="space-y-4">
              <div className="p-3 bg-gray-50 rounded text-sm">
                <div className="font-medium mb-1">Intervention:</div>
                <div>{selectedLog.intervention_description}</div>
                <div className="mt-2 text-xs text-gray-600">
                  Performed: {new Date(selectedLog.intervention_date).toLocaleDateString()}
                </div>
              </div>

              <div>
                <Label>Outcome Status *</Label>
                <Select name="outcome_status" defaultValue="improved" required>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="improved">Improved</SelectItem>
                    <SelectItem value="stable">Stable</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                    <SelectItem value="no_change">No Change</SelectItem>
                    <SelectItem value="adverse_event">Adverse Event</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Outcome Description *</Label>
                <Textarea
                  name="outcome_description"
                  placeholder="Describe the observed outcome in detail..."
                  rows={4}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Assessment Date *</Label>
                  <Input
                    type="date"
                    name="outcome_assessed_date"
                    defaultValue={new Date().toISOString().split('T')[0]}
                    required
                  />
                </div>
                <div>
                  <Label>Follow-up Risk Score</Label>
                  <Input
                    type="number"
                    name="follow_up_risk_score"
                    placeholder="0-100"
                    min="0"
                    max="100"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Original: {selectedLog.original_risk_score}%
                  </p>
                </div>
              </div>

              <div>
                <Label>Effectiveness Rating</Label>
                <Select name="effectiveness_rating">
                  <SelectTrigger>
                    <SelectValue placeholder="Rate effectiveness" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">⭐ Poor</SelectItem>
                    <SelectItem value="2">⭐⭐ Fair</SelectItem>
                    <SelectItem value="3">⭐⭐⭐ Good</SelectItem>
                    <SelectItem value="4">⭐⭐⭐⭐ Very Good</SelectItem>
                    <SelectItem value="5">⭐⭐⭐⭐⭐ Excellent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label>Barriers Encountered (one per line)</Label>
                <Textarea
                  name="barriers_encountered"
                  placeholder="List any barriers that affected implementation or outcome..."
                  rows={3}
                />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setOutcomeDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateMutation.isPending}>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  Save Outcome
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}