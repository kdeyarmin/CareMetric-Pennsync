import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileText,
  AlertCircle,
  CheckCircle,
  Clock,
  WifiOff,
  Save
} from "lucide-react";
import offlineStorage from "./OfflineStorage";
import { toast } from 'sonner';

export default function OfflineTaskManager({ patientId, patientName }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [taskType, setTaskType] = useState('note');
  const [formData, setFormData] = useState({
    visit_date: new Date().toISOString().split('T')[0],
    visit_type: 'routine_visit',
    incident_type: 'fall',
    severity: 'medium',
    notes: '',
    vital_signs: {
      blood_pressure_systolic: '',
      blood_pressure_diastolic: '',
      heart_rate: '',
      temperature: '',
      oxygen_saturation: ''
    }
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleSaveVisitNote = async () => {
    if (!formData.notes.trim()) {
      toast.error('Please enter visit notes');
      return;
    }
    if (!patientId) {
      toast.error('No patient selected for this visit.');
      return;
    }

    setSaving(true);
    try {
      const hasVitals = !!formData.vital_signs.blood_pressure_systolic;
      const visitData = {
        patient_id: patientId,
        visit_date: formData.visit_date,
        visit_type: formData.visit_type,
        status: 'completed',
        nurse_notes: formData.notes.trim(),
        vital_signs: hasVitals ? formData.vital_signs : null,
      };

      if (isOnline) {
        // Persist directly to the backend when connected.
        await base44.entities.Visit.create(visitData);
      } else {
        // Queue for offline sync; the sync service replays it when back online.
        offlineStorage.addPendingChange('visit_create', { ...visitData, created_offline: true });
      }

      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        // Reset form
        setFormData({
          visit_date: new Date().toISOString().split('T')[0],
          visit_type: 'routine_visit',
          incident_type: 'fall',
          severity: 'medium',
          notes: '',
          vital_signs: {
            blood_pressure_systolic: '',
            blood_pressure_diastolic: '',
            heart_rate: '',
            temperature: '',
            oxygen_saturation: ''
          }
        });
      }, 2000);
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save visit note');
    }
    setSaving(false);
  };

  const handleSaveIncident = async () => {
    if (!formData.notes.trim()) {
      toast.error('Please describe the incident');
      return;
    }
    if (!patientId) {
      toast.error('No patient selected for this incident.');
      return;
    }

    setSaving(true);
    try {
      const incidentData = {
        patient_id: patientId,
        patient_name: patientName || undefined,
        incident_type: formData.incident_type,
        incident_date: formData.visit_date,
        severity: formData.severity,
        report: formData.notes.trim(),
        details: { description: formData.notes.trim() },
      };

      if (isOnline) {
        await base44.entities.Incident.create(incidentData);
      } else {
        offlineStorage.addPendingChange('incident_create', { ...incidentData, created_offline: true });
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to report incident');
    }
    setSaving(false);
  };

  return (
    <Card className="border-2 border-blue-300">
      <CardHeader className="bg-blue-50">
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Offline Documentation
          {!isOnline && (
            <Badge className="bg-orange-600 ml-auto">
              <WifiOff className="w-3 h-3 mr-1" />
              Offline Mode
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!isOnline && (
          <Alert className="bg-orange-50 border-orange-300">
            <AlertCircle className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-sm">
              You're offline. Data will sync automatically when connection is restored.
            </AlertDescription>
          </Alert>
        )}

        {saved && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-sm">
              {isOnline ? 'Saved successfully!' : 'Saved locally. Will sync when online.'}
            </AlertDescription>
          </Alert>
        )}

        {/* Patient Info */}
        <div className="p-3 bg-slate-50 rounded-lg">
          <p className="text-sm font-semibold">{patientName}</p>
          <p className="text-xs text-slate-600">Patient ID: {patientId}</p>
        </div>

        {/* Task Type Selector */}
        <div className="flex gap-2">
          <Button
            variant={taskType === 'note' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('note')}
            className="flex-1"
          >
            <FileText className="w-4 h-4 mr-1" />
            Visit Note
          </Button>
          <Button
            variant={taskType === 'incident' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('incident')}
            className="flex-1"
          >
            <AlertCircle className="w-4 h-4 mr-1" />
            Incident
          </Button>
        </div>

        {/* Visit Note Form */}
        {taskType === 'note' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="visit_date">Visit Date</Label>
              <Input
                id="visit_date"
                type="date"
                value={formData.visit_date}
                onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
              />
            </div>

            <div>
              <Label htmlFor="visit_type">Visit Type</Label>
              <select
                id="visit_type"
                value={formData.visit_type}
                onChange={(e) => setFormData({ ...formData, visit_type: e.target.value })}
                className="w-full h-10 px-3 rounded-md border border-slate-300"
              >
                <option value="routine_visit">Routine Visit</option>
                <option value="skilled_nursing">Skilled Nursing</option>
                <option value="admission">Admission</option>
                <option value="recertification">Recertification</option>
              </select>
            </div>

            <div>
              <Label htmlFor="notes">Visit Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Document visit observations, interventions, and patient response..."
                rows={6}
              />
            </div>

            {/* Vital Signs (Optional) */}
            <details className="border rounded-lg p-3">
              <summary className="cursor-pointer font-medium text-sm">
                Add Vital Signs (Optional)
              </summary>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div>
                  <Label className="text-xs">BP Systolic</Label>
                  <Input
                    type="number"
                    value={formData.vital_signs.blood_pressure_systolic}
                    onChange={(e) => setFormData({
                      ...formData,
                      vital_signs: { ...formData.vital_signs, blood_pressure_systolic: e.target.value }
                    })}
                    placeholder="120"
                  />
                </div>
                <div>
                  <Label className="text-xs">BP Diastolic</Label>
                  <Input
                    type="number"
                    value={formData.vital_signs.blood_pressure_diastolic}
                    onChange={(e) => setFormData({
                      ...formData,
                      vital_signs: { ...formData.vital_signs, blood_pressure_diastolic: e.target.value }
                    })}
                    placeholder="80"
                  />
                </div>
                <div>
                  <Label className="text-xs">Heart Rate</Label>
                  <Input
                    type="number"
                    value={formData.vital_signs.heart_rate}
                    onChange={(e) => setFormData({
                      ...formData,
                      vital_signs: { ...formData.vital_signs, heart_rate: e.target.value }
                    })}
                    placeholder="72"
                  />
                </div>
                <div>
                  <Label className="text-xs">O2 Saturation %</Label>
                  <Input
                    type="number"
                    value={formData.vital_signs.oxygen_saturation}
                    onChange={(e) => setFormData({
                      ...formData,
                      vital_signs: { ...formData.vital_signs, oxygen_saturation: e.target.value }
                    })}
                    placeholder="98"
                  />
                </div>
              </div>
            </details>

            <Button
              onClick={handleSaveVisitNote}
              disabled={saving}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isOnline ? 'Save Visit Note' : 'Save Offline'}
            </Button>
          </div>
        )}

        {/* Incident Form */}
        {taskType === 'incident' && (
          <div className="space-y-3">
            <div>
              <Label htmlFor="incident_date">Incident Date</Label>
              <Input
                id="incident_date"
                type="date"
                value={formData.visit_date}
                onChange={(e) => setFormData({ ...formData, visit_date: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="incident_type">Incident Type</Label>
                <select
                  id="incident_type"
                  value={formData.incident_type}
                  onChange={(e) => setFormData({ ...formData, incident_type: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-slate-300"
                >
                  <option value="fall">Fall</option>
                  <option value="hospitalized">Hospitalized</option>
                  <option value="medication_error">Medication Error</option>
                  <option value="behavioral_change">Behavioral Change</option>
                  <option value="infection_suspected">Infection Suspected</option>
                  <option value="refusal_of_care">Refusal of Care</option>
                  <option value="pressure_injury">Pressure Injury</option>
                  <option value="emergency_visit">Emergency Visit</option>
                  <option value="safety_event">Safety Event</option>
                  <option value="wound_concern">Wound Concern</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <Label htmlFor="incident_severity">Severity</Label>
                <select
                  id="incident_severity"
                  value={formData.severity}
                  onChange={(e) => setFormData({ ...formData, severity: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border border-slate-300"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="incident_notes">Incident Details</Label>
              <Textarea
                id="incident_notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Describe the incident, interventions taken, and notifications made..."
                rows={6}
              />
            </div>

            <Button
              onClick={handleSaveIncident}
              disabled={saving}
              className="w-full bg-red-600 hover:bg-red-700"
            >
              {saving ? (
                <Clock className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              {isOnline ? 'Report Incident' : 'Save Offline'}
            </Button>
          </div>
        )}

        {/* Pending Count */}
        <div className="pt-3 border-t">
          <div className="flex items-center justify-between text-sm text-slate-600">
            <span>Pending items to sync:</span>
            <Badge variant="outline">{offlineStorage.getPendingCount()}</Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}