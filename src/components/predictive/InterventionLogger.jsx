import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle, Plus } from 'lucide-react';

export default function InterventionLogger({ 
  patientId, 
  predictionType, 
  originalRiskScore, 
  riskAnalysisId,
  open,
  onOpenChange 
}) {
  const [formData, setFormData] = useState({
    intervention_category: '',
    intervention_description: '',
    intervention_date: new Date().toISOString().split('T')[0],
    expected_outcome: '',
    patient_response: 'positive',
    time_spent_minutes: '',
    requires_follow_up: false,
    follow_up_date: '',
    notes: ''
  });

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const user = await base44.auth.me();
      return base44.entities.InterventionLog.create({
        patient_id: patientId,
        prediction_type: predictionType,
        risk_analysis_id: riskAnalysisId,
        original_risk_score: originalRiskScore,
        performed_by: user.email,
        performed_by_name: user.full_name,
        ...data
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['interventionLogs'] });
      toast.success('Intervention logged successfully');
      onOpenChange(false);
      setFormData({
        intervention_category: '',
        intervention_description: '',
        intervention_date: new Date().toISOString().split('T')[0],
        expected_outcome: '',
        patient_response: 'positive',
        time_spent_minutes: '',
        requires_follow_up: false,
        follow_up_date: '',
        notes: ''
      });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      time_spent_minutes: formData.time_spent_minutes ? parseInt(formData.time_spent_minutes) : undefined
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Log Intervention
          </DialogTitle>
          <DialogDescription>
            Document the intervention performed and its expected outcome
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Prediction Type</Label>
              <Input value={predictionType.replace(/_/g, ' ')} disabled className="capitalize" />
            </div>
            <div>
              <Label>Original Risk Score</Label>
              <Input value={`${originalRiskScore}%`} disabled />
            </div>
          </div>

          <div>
            <Label>Intervention Category *</Label>
            <Select
              value={formData.intervention_category}
              onValueChange={(value) => setFormData({ ...formData, intervention_category: value })}
              required
            >
              <SelectTrigger>
                <SelectValue placeholder="Select category" />
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
                <SelectItem value="emergency_intervention">Emergency Intervention</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Intervention Description *</Label>
            <Textarea
              value={formData.intervention_description}
              onChange={(e) => setFormData({ ...formData, intervention_description: e.target.value })}
              placeholder="Describe the intervention performed in detail..."
              rows={4}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Intervention Date *</Label>
              <Input
                type="date"
                value={formData.intervention_date}
                onChange={(e) => setFormData({ ...formData, intervention_date: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Time Spent (minutes)</Label>
              <Input
                type="number"
                value={formData.time_spent_minutes}
                onChange={(e) => setFormData({ ...formData, time_spent_minutes: e.target.value })}
                placeholder="e.g., 30"
              />
            </div>
          </div>

          <div>
            <Label>Expected Outcome</Label>
            <Textarea
              value={formData.expected_outcome}
              onChange={(e) => setFormData({ ...formData, expected_outcome: e.target.value })}
              placeholder="What outcome do you expect from this intervention?"
              rows={2}
            />
          </div>

          <div>
            <Label>Patient Response</Label>
            <Select
              value={formData.patient_response}
              onValueChange={(value) => setFormData({ ...formData, patient_response: value })}
            >
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

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="requires_follow_up"
              checked={formData.requires_follow_up}
              onChange={(e) => setFormData({ ...formData, requires_follow_up: e.target.checked })}
              className="rounded"
            />
            <Label htmlFor="requires_follow_up">Requires Follow-up</Label>
          </div>

          {formData.requires_follow_up && (
            <div>
              <Label>Follow-up Date</Label>
              <Input
                type="date"
                value={formData.follow_up_date}
                onChange={(e) => setFormData({ ...formData, follow_up_date: e.target.value })}
              />
            </div>
          )}

          <div>
            <Label>Additional Notes</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              placeholder="Any additional notes or observations..."
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              <CheckCircle className="h-4 w-4 mr-2" />
              Log Intervention
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}