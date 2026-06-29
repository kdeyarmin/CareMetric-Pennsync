import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  WifiOff,
  Wifi,
  Save,
  Clock
} from 'lucide-react';
import { OfflineStorageManager } from './OfflineSyncService';
import { toast } from 'sonner';

export default function OfflineVisitNoteCapture({ patient, onComplete }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [visitData, setVisitData] = useState({
    patient_id: patient?.id,
    patient_name: patient ? `${patient.first_name} ${patient.last_name}` : '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_type: 'Skilled Nursing',
    vitals: {
      blood_pressure_systolic: '',
      blood_pressure_diastolic: '',
      heart_rate: '',
      respiratory_rate: '',
      temperature: '',
      oxygen_saturation: '',
      pain_level: '',
      weight: ''
    },
    chief_complaint: '',
    assessment: '',
    interventions: '',
    patient_response: '',
    plan: '',
    clinical_notes: '',
    nurse_signature: '',
    visit_duration_minutes: 45
  });

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Connection restored - syncing offline data');
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline - data will be saved locally');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const updateField = (field, value) => {
    setVisitData(prev => ({ ...prev, [field]: value }));
  };

  const updateVitals = (vitalName, value) => {
    setVisitData(prev => ({
      ...prev,
      vitals: { ...prev.vitals, [vitalName]: value }
    }));
  };

  const saveVisitNote = async () => {
    if (!visitData.patient_id) {
      toast.error('Patient is required');
      return;
    }

    if (!visitData.assessment || !visitData.plan) {
      toast.error('Assessment and Plan are required fields');
      return;
    }

    // Validate numeric vitals against absolute sanity bounds before queuing — the
    // offline sync worker writes visitData verbatim to the Visit record, so an
    // impossible/typo value (e.g. weight -150, O2 9000) would corrupt the chart.
    const VITAL_BOUNDS = {
      blood_pressure_systolic: [40, 300], blood_pressure_diastolic: [20, 200],
      heart_rate: [10, 300], respiratory_rate: [3, 80], temperature: [80, 115],
      oxygen_saturation: [50, 100], pain_level: [0, 10], weight: [1, 1500],
    };
    for (const [field, [min, max]] of Object.entries(VITAL_BOUNDS)) {
      const raw = visitData.vitals?.[field];
      if (raw === undefined || raw === null || raw === '') continue;
      const n = parseFloat(raw);
      if (!Number.isFinite(n) || n < min || n > max) {
        toast.error(`${field.replace(/_/g, ' ')} must be between ${min} and ${max}`);
        return;
      }
    }

    try {
      // Map the form onto the Visit ENTITY SCHEMA before queuing. The offline sync
      // worker writes item.data verbatim via Visit.create and Base44 silently drops
      // unknown fields — so the form's own field names (`vitals`, `assessment`,
      // `interventions`, `plan`, `chief_complaint`, …) and the display-label
      // `visit_type` were syncing an empty visit shell with no vitals and no
      // clinical narrative. Map vitals -> `vital_signs` (numeric), the narrative ->
      // `nurse_notes`, and the label -> the `visit_type` enum.
      const rawVitals = visitData.vitals || {};
      const vital_signs = {};
      for (const [key, val] of Object.entries(rawVitals)) {
        if (val === '' || val == null) continue;
        const n = parseFloat(val);
        if (Number.isFinite(n)) vital_signs[key] = n;
      }
      const hasVitals = Object.keys(vital_signs).length > 0;

      // Form labels -> Visit.visit_type enum. Therapy/aide/social-work visits have
      // no dedicated enum member, so they map to the generic 'routine_visit'.
      const VISIT_TYPE_MAP = {
        'Skilled Nursing': 'skilled_nursing',
        'Physical Therapy': 'routine_visit',
        'Occupational Therapy': 'routine_visit',
        'Speech Therapy': 'routine_visit',
        'Home Health Aide': 'routine_visit',
        'Social Work': 'routine_visit',
      };

      const nurseNotes = [
        visitData.chief_complaint && `Chief Complaint:\n${visitData.chief_complaint}`,
        visitData.assessment && `Assessment:\n${visitData.assessment}`,
        visitData.interventions && `Interventions:\n${visitData.interventions}`,
        visitData.patient_response && `Patient Response:\n${visitData.patient_response}`,
        visitData.plan && `Plan of Care:\n${visitData.plan}`,
        visitData.clinical_notes && `Additional Notes:\n${visitData.clinical_notes}`,
        visitData.visit_duration_minutes ? `Visit Duration: ${visitData.visit_duration_minutes} minutes` : null,
        visitData.nurse_signature && `Signed: ${visitData.nurse_signature}`,
      ].filter(Boolean).join('\n\n');

      // Save the schema-conformant Visit to the offline queue.
      const _savedId = OfflineStorageManager.saveToQueue('visit', {
        patient_id: visitData.patient_id,
        visit_date: visitData.visit_date,
        visit_type: VISIT_TYPE_MAP[visitData.visit_type] || 'skilled_nursing',
        vital_signs: hasVitals ? vital_signs : null,
        nurse_notes: nurseNotes,
        status: 'completed',
      });

      toast.success(
        isOnline 
          ? 'Visit note saved and will sync shortly' 
          : 'Visit note saved offline - will sync when online'
      );

      // Reset form
      setVisitData({
        patient_id: patient?.id,
        patient_name: patient ? `${patient.first_name} ${patient.last_name}` : '',
        visit_date: new Date().toISOString().split('T')[0],
        visit_type: 'Skilled Nursing',
        vitals: {
          blood_pressure_systolic: '',
          blood_pressure_diastolic: '',
          heart_rate: '',
          respiratory_rate: '',
          temperature: '',
          oxygen_saturation: '',
          pain_level: '',
          weight: ''
        },
        chief_complaint: '',
        assessment: '',
        interventions: '',
        patient_response: '',
        plan: '',
        clinical_notes: '',
        nurse_signature: '',
        visit_duration_minutes: 45
      });

      if (onComplete) onComplete();
    } catch (error) {
      console.error('Error saving visit note:', error);
      toast.error('Failed to save visit note');
    }
  };

  return (
    <div className="space-y-4">
      {/* Connection Status Banner */}
      <Card className={`border-2 ${isOnline ? 'border-green-300 bg-green-50' : 'border-orange-300 bg-orange-50'}`}>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            {isOnline ? (
              <Wifi className="w-6 h-6 text-green-600" />
            ) : (
              <WifiOff className="w-6 h-6 text-orange-600" />
            )}
            <div className="flex-1">
              <p className={`font-semibold ${isOnline ? 'text-green-900' : 'text-orange-900'}`}>
                {isOnline ? 'Connected' : 'Offline Mode'}
              </p>
              <p className={`text-sm ${isOnline ? 'text-green-700' : 'text-orange-700'}`}>
                {isOnline 
                  ? 'Your notes will sync immediately' 
                  : 'Your notes will be saved locally and synced when connection is restored'}
              </p>
            </div>
            {!isOnline && (
              <Badge className="bg-orange-500">
                <Clock className="w-3 h-3 mr-1" />
                Offline
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Patient Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Patient Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label htmlFor="visit-patient" className="text-sm font-medium text-slate-700 mb-1 block">Patient</label>
            <Input id="visit-patient" value={visitData.patient_name} disabled className="bg-slate-50" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="visit-date" className="text-sm font-medium text-slate-700 mb-1 block">Visit Date</label>
              <Input
                id="visit-date"
                type="date"
                value={visitData.visit_date}
                onChange={(e) => updateField('visit_date', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="visit-type" className="text-sm font-medium text-slate-700 mb-1 block">Visit Type</label>
              <Select value={visitData.visit_type} onValueChange={(val) => updateField('visit_type', val)}>
                <SelectTrigger id="visit-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Skilled Nursing">Skilled Nursing</SelectItem>
                  <SelectItem value="Physical Therapy">Physical Therapy</SelectItem>
                  <SelectItem value="Occupational Therapy">Occupational Therapy</SelectItem>
                  <SelectItem value="Speech Therapy">Speech Therapy</SelectItem>
                  <SelectItem value="Home Health Aide">Home Health Aide</SelectItem>
                  <SelectItem value="Social Work">Social Work</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vital Signs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Vital Signs</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            <div>
              <label htmlFor="vital-bp-systolic" className="text-xs font-medium text-slate-700 mb-1 block">BP Systolic</label>
              <Input
                id="vital-bp-systolic"
                type="number"
                placeholder="120"
                value={visitData.vitals.blood_pressure_systolic}
                onChange={(e) => updateVitals('blood_pressure_systolic', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-bp-diastolic" className="text-xs font-medium text-slate-700 mb-1 block">BP Diastolic</label>
              <Input
                id="vital-bp-diastolic"
                type="number"
                placeholder="80"
                value={visitData.vitals.blood_pressure_diastolic}
                onChange={(e) => updateVitals('blood_pressure_diastolic', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-heart-rate" className="text-xs font-medium text-slate-700 mb-1 block">Heart Rate</label>
              <Input
                id="vital-heart-rate"
                type="number"
                placeholder="72"
                value={visitData.vitals.heart_rate}
                onChange={(e) => updateVitals('heart_rate', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-resp-rate" className="text-xs font-medium text-slate-700 mb-1 block">Resp Rate</label>
              <Input
                id="vital-resp-rate"
                type="number"
                placeholder="16"
                value={visitData.vitals.respiratory_rate}
                onChange={(e) => updateVitals('respiratory_rate', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-temperature" className="text-xs font-medium text-slate-700 mb-1 block">Temp (°F)</label>
              <Input
                id="vital-temperature"
                type="number"
                step="0.1"
                placeholder="98.6"
                value={visitData.vitals.temperature}
                onChange={(e) => updateVitals('temperature', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-oxygen-saturation" className="text-xs font-medium text-slate-700 mb-1 block">O2 Sat (%)</label>
              <Input
                id="vital-oxygen-saturation"
                type="number"
                placeholder="98"
                value={visitData.vitals.oxygen_saturation}
                onChange={(e) => updateVitals('oxygen_saturation', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-pain-level" className="text-xs font-medium text-slate-700 mb-1 block">Pain (0-10)</label>
              <Input
                id="vital-pain-level"
                type="number"
                min="0"
                max="10"
                placeholder="0"
                value={visitData.vitals.pain_level}
                onChange={(e) => updateVitals('pain_level', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="vital-weight" className="text-xs font-medium text-slate-700 mb-1 block">Weight (lbs)</label>
              <Input
                id="vital-weight"
                type="number"
                placeholder="150"
                value={visitData.vitals.weight}
                onChange={(e) => updateVitals('weight', e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Clinical Documentation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Clinical Documentation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="clinical-chief-complaint" className="text-sm font-medium text-slate-700 mb-1 block">
              Chief Complaint
            </label>
            <Textarea
              id="clinical-chief-complaint"
              placeholder="Patient's primary concern or reason for visit..."
              value={visitData.chief_complaint}
              onChange={(e) => updateField('chief_complaint', e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <label htmlFor="clinical-assessment" className="text-sm font-medium text-slate-700 mb-1 block">
              Assessment <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="clinical-assessment"
              placeholder="Clinical assessment, findings, and observations..."
              value={visitData.assessment}
              onChange={(e) => updateField('assessment', e.target.value)}
              rows={4}
            />
          </div>

          <div>
            <label htmlFor="clinical-interventions" className="text-sm font-medium text-slate-700 mb-1 block">
              Interventions Performed
            </label>
            <Textarea
              id="clinical-interventions"
              placeholder="Nursing interventions, treatments, education provided..."
              value={visitData.interventions}
              onChange={(e) => updateField('interventions', e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <label htmlFor="clinical-patient-response" className="text-sm font-medium text-slate-700 mb-1 block">
              Patient Response
            </label>
            <Textarea
              id="clinical-patient-response"
              placeholder="How patient responded to interventions..."
              value={visitData.patient_response}
              onChange={(e) => updateField('patient_response', e.target.value)}
              rows={2}
            />
          </div>

          <div>
            <label htmlFor="clinical-plan" className="text-sm font-medium text-slate-700 mb-1 block">
              Plan of Care <span className="text-red-500">*</span>
            </label>
            <Textarea
              id="clinical-plan"
              placeholder="Ongoing plan, follow-up, next visit plan..."
              value={visitData.plan}
              onChange={(e) => updateField('plan', e.target.value)}
              rows={3}
            />
          </div>

          <div>
            <label htmlFor="clinical-notes" className="text-sm font-medium text-slate-700 mb-1 block">
              Additional Clinical Notes
            </label>
            <Textarea
              id="clinical-notes"
              placeholder="Any additional relevant information..."
              value={visitData.clinical_notes}
              onChange={(e) => updateField('clinical_notes', e.target.value)}
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3 sticky bottom-4 bg-white p-4 rounded-lg border-2 border-slate-200 shadow-lg">
        <Button
          onClick={saveVisitNote}
          className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          size="lg"
        >
          <Save className="w-4 h-4 mr-2" />
          Save Visit Note
          {!isOnline && <Badge className="ml-2 bg-orange-500">Offline</Badge>}
        </Button>
      </div>
    </div>
  );
}