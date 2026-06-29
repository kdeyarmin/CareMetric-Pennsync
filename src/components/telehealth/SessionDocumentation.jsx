import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Save, FileText } from 'lucide-react';
import { toast } from 'sonner';

export default function SessionDocumentation({ _sessionId, onSave, initialData = {} }) {
  const [formData, setFormData] = useState({
    chief_complaint: initialData.chief_complaint || '',
    vitals_captured: initialData.vitals_captured || {
      temperature: '',
      blood_pressure_systolic: '',
      blood_pressure_diastolic: '',
      heart_rate: '',
      oxygen_saturation: '',
      pain_level: ''
    },
    medications_reviewed: initialData.medications_reviewed || [],
    assessment: initialData.assessment || '',
    plan: initialData.plan || '',
    follow_up_needed: initialData.follow_up_needed || false,
    follow_up_timeframe: initialData.follow_up_timeframe || '',
    prescriptions_sent: initialData.prescriptions_sent || [],
    notes: initialData.notes || ''
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleVitalChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      vitals_captured: {
        ...prev.vitals_captured,
        [field]: value
      }
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(formData);
      toast.success('Documentation saved');
    } catch (error) {
      toast.error('Failed to save: ' + error.message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="w-5 h-5" />
            Session Documentation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Chief Complaint */}
          <div>
            <Label>Chief Complaint</Label>
            <Input
              placeholder="Patient's primary concern..."
              value={formData.chief_complaint}
              onChange={(e) => setFormData({ ...formData, chief_complaint: e.target.value })}
            />
          </div>

          {/* Vital Signs */}
          <div>
            <Label className="text-base font-semibold mb-3 block">Vital Signs Captured</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Temperature (°F)</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="98.6"
                  value={formData.vitals_captured.temperature}
                  onChange={(e) => handleVitalChange('temperature', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Heart Rate (bpm)</Label>
                <Input
                  type="number"
                  placeholder="72"
                  value={formData.vitals_captured.heart_rate}
                  onChange={(e) => handleVitalChange('heart_rate', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">BP Systolic</Label>
                <Input
                  type="number"
                  placeholder="120"
                  value={formData.vitals_captured.blood_pressure_systolic}
                  onChange={(e) => handleVitalChange('blood_pressure_systolic', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">BP Diastolic</Label>
                <Input
                  type="number"
                  placeholder="80"
                  value={formData.vitals_captured.blood_pressure_diastolic}
                  onChange={(e) => handleVitalChange('blood_pressure_diastolic', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">O2 Saturation (%)</Label>
                <Input
                  type="number"
                  placeholder="98"
                  value={formData.vitals_captured.oxygen_saturation}
                  onChange={(e) => handleVitalChange('oxygen_saturation', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Pain Level (0-10)</Label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  placeholder="0"
                  value={formData.vitals_captured.pain_level}
                  onChange={(e) => handleVitalChange('pain_level', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Assessment */}
          <div>
            <Label>Clinical Assessment</Label>
            <Textarea
              rows={4}
              placeholder="Clinical findings and assessment..."
              value={formData.assessment}
              onChange={(e) => setFormData({ ...formData, assessment: e.target.value })}
            />
          </div>

          {/* Plan */}
          <div>
            <Label>Treatment Plan</Label>
            <Textarea
              rows={4}
              placeholder="Treatment plan and interventions..."
              value={formData.plan}
              onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
            />
          </div>

          {/* Follow-up */}
          <div className="flex items-center space-x-2">
            <Checkbox
              id="follow-up"
              checked={formData.follow_up_needed}
              onCheckedChange={(checked) => 
                setFormData({ ...formData, follow_up_needed: checked })
              }
            />
            <Label htmlFor="follow-up" className="cursor-pointer">
              Follow-up visit needed
            </Label>
          </div>

          {formData.follow_up_needed && (
            <div>
              <Label>Follow-up Timeframe</Label>
              <Input
                placeholder="e.g., 1 week, 2 weeks, 1 month"
                value={formData.follow_up_timeframe}
                onChange={(e) => setFormData({ ...formData, follow_up_timeframe: e.target.value })}
              />
            </div>
          )}

          {/* Additional Notes */}
          <div>
            <Label>Additional Clinical Notes</Label>
            <Textarea
              rows={3}
              placeholder="Any additional observations or notes..."
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            />
          </div>

          <Button onClick={handleSave} disabled={isSaving} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Documentation'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}