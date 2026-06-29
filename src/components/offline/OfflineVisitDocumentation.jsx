import { useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { useOfflineSync } from './OfflineSyncService';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { WifiOff, Save, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function OfflineVisitDocumentation({ patientId, visitId, existingData, onSaved }) {
  const { isOnline, saveOffline } = useOfflineSync();
  const [formData, setFormData] = useState({
    visit_id: visitId || `offline_visit_${Date.now()}`,
    patient_id: patientId,
    visit_date: new Date().toISOString().split('T')[0],
    visit_time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
    visit_type: 'routine_visit',
    nurse_notes: '',
    vital_signs: {
      temperature: '',
      blood_pressure_systolic: '',
      blood_pressure_diastolic: '',
      heart_rate: '',
      respiratory_rate: '',
      oxygen_saturation: '',
      pain_level: ''
    },
    ...existingData
  });

  const [savedOffline, setSavedOffline] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  const handleAutoSave = useCallback(() => {
    if (!isOnline && formData.nurse_notes) {
      try { localStorage.setItem(`visit_draft_${formData.visit_id}`, JSON.stringify({
        ...formData,
        lastSaved: new Date().toISOString()
      })); } catch {}
      setLastSaved(new Date());
    }
  }, [isOnline, formData]);

  // Auto-save every 30 seconds when offline
  useEffect(() => {
    if (!isOnline) {
      const interval = setInterval(() => {
        handleAutoSave();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [isOnline, formData, handleAutoSave]);

  const handleSave = () => {
    if (!formData.patient_id) {
      toast.error('Patient ID is required');
      return;
    }

    if (isOnline) {
      // Save directly online
      saveOnline();
    } else {
      // Save to offline queue
      const offlineId = saveOffline('visit', formData);
      setSavedOffline(true);
      setLastSaved(new Date());
      toast.success('Saved offline - will sync when online', {
        description: 'Your documentation is safe and will be uploaded automatically'
      });
      
      if (onSaved) {
        onSaved({ ...formData, offlineId, status: 'offline' });
      }
    }
  };

  const saveOnline = async () => {
    try {
      // Strip the local-only placeholder id; the backend assigns the real one.
      const { visit_id: _visit_id, ...rest } = formData;
      const hasVitals = rest.vital_signs &&
        Object.values(rest.vital_signs).some((v) => v !== '' && v != null);
      const payload = {
        ...rest,
        vital_signs: hasVitals ? rest.vital_signs : null,
        status: 'completed',
      };

      // Update the existing visit when editing one, otherwise create it.
      const saved = visitId
        ? await base44.entities.Visit.update(visitId, payload)
        : await base44.entities.Visit.create(payload);

      setLastSaved(new Date());
      toast.success('Visit documentation saved');
      if (onSaved) {
        onSaved(saved || formData);
      }
    } catch (error) {
      toast.error('Failed to save: ' + (error?.message || 'Unknown error'));
    }
  };

  const updateVitals = (field, value) => {
    setFormData(prev => ({
      ...prev,
      vital_signs: {
        ...prev.vital_signs,
        [field]: value
      }
    }));
  };

  return (
    <div className="space-y-4">
      {!isOnline && (
        <Card className="border-orange-300 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <WifiOff className="w-5 h-5 text-orange-600" />
              <div>
                <h3 className="font-semibold text-orange-900">Offline Mode Active</h3>
                <p className="text-sm text-orange-700">
                  Your documentation will be saved locally and synced when connection is restored
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Visit Documentation</span>
            {savedOffline && (
              <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-300">
                Saved Offline
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Visit Info */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Visit Date</Label>
              <Input
                type="date"
                value={formData.visit_date}
                onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Visit Time</Label>
              <Input
                type="time"
                value={formData.visit_time}
                onChange={(e) => setFormData({ ...formData, visit_time: e.target.value })}
              />
            </div>
          </div>

          {/* Vital Signs */}
          <div>
            <Label className="text-base font-semibold mb-3 block">Vital Signs</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Temperature (°F)</Label>
                <Input
                  type="number"
                  step="0.1"
                  placeholder="98.6"
                  value={formData.vital_signs.temperature}
                  onChange={(e) => updateVitals('temperature', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Heart Rate (bpm)</Label>
                <Input
                  type="number"
                  placeholder="72"
                  value={formData.vital_signs.heart_rate}
                  onChange={(e) => updateVitals('heart_rate', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">BP Systolic</Label>
                <Input
                  type="number"
                  placeholder="120"
                  value={formData.vital_signs.blood_pressure_systolic}
                  onChange={(e) => updateVitals('blood_pressure_systolic', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">BP Diastolic</Label>
                <Input
                  type="number"
                  placeholder="80"
                  value={formData.vital_signs.blood_pressure_diastolic}
                  onChange={(e) => updateVitals('blood_pressure_diastolic', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">O2 Saturation (%)</Label>
                <Input
                  type="number"
                  placeholder="98"
                  value={formData.vital_signs.oxygen_saturation}
                  onChange={(e) => updateVitals('oxygen_saturation', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Pain Level (0-10)</Label>
                <Input
                  type="number"
                  min="0"
                  max="10"
                  placeholder="0"
                  value={formData.vital_signs.pain_level}
                  onChange={(e) => updateVitals('pain_level', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Clinical Notes */}
          <div>
            <Label>Clinical Notes</Label>
            <Textarea
              rows={8}
              placeholder="Document patient assessment, interventions, and response to care..."
              value={formData.nurse_notes}
              onChange={(e) => setFormData({ ...formData, nurse_notes: e.target.value })}
              className="font-mono text-sm"
            />
          </div>

          {lastSaved && (
            <div className="text-xs text-slate-500 flex items-center gap-2">
              <CheckCircle2 className="w-3 h-3 text-green-600" />
              Last saved: {lastSaved.toLocaleTimeString()}
            </div>
          )}

          <Button onClick={handleSave} className="w-full">
            <Save className="w-4 h-4 mr-2" />
            {isOnline ? 'Save Documentation' : 'Save Offline'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}