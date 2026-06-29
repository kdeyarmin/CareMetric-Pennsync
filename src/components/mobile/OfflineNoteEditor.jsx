import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, WifiOff, CheckCircle2, Edit3 } from "lucide-react";

export default function OfflineNoteEditor({ patientId, onSaveOffline }) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [noteData, setNoteData] = useState({
    visit_date: new Date().toISOString().split('T')[0],
    visit_type: 'routine_visit',
    nurse_notes: '',
    vitals: { bp: '', hr: '', temp: '', o2: '', pain: '' }
  });
  const [savedLocally, setSavedLocally] = useState(false);

  let cachedPatients = [];
  try {
    cachedPatients = JSON.parse(localStorage.getItem('offline_patient_data') || '[]');
  } catch (e) {
    console.warn('Failed to parse cached patient data:', e);
  }
  const patient = cachedPatients.find(c => c.patient.id === patientId)?.patient;

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

  const handleSaveOffline = () => {
    const draft = {
      id: Date.now().toString(),
      patient_id: patientId,
      patient_name: patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown',
      visit_date: noteData.visit_date,
      visit_type: noteData.visit_type,
      nurse_notes: noteData.nurse_notes,
      vital_signs: {
        blood_pressure_systolic: noteData.vitals.bp?.split('/')[0] || null,
        blood_pressure_diastolic: noteData.vitals.bp?.split('/')[1] || null,
        heart_rate: noteData.vitals.hr ? parseInt(noteData.vitals.hr) : null,
        temperature: noteData.vitals.temp ? parseFloat(noteData.vitals.temp) : null,
        oxygen_saturation: noteData.vitals.o2 ? parseInt(noteData.vitals.o2) : null,
        pain_level: noteData.vitals.pain ? parseInt(noteData.vitals.pain) : null
      },
      saved_at: new Date().toISOString(),
      synced: false
    };

    // Add to localStorage
    let existingDrafts = [];
    try { existingDrafts = JSON.parse(localStorage.getItem('offline_visit_drafts') || '[]'); } catch {}
    existingDrafts.push(draft);
    try { localStorage.setItem('offline_visit_drafts', JSON.stringify(existingDrafts)); } catch {}

    setSavedLocally(true);
    setTimeout(() => setSavedLocally(false), 3000);

    onSaveOffline?.(draft);

    // Clear form
    setNoteData({
      visit_date: new Date().toISOString().split('T')[0],
      visit_type: 'routine_visit',
      nurse_notes: '',
      vitals: { bp: '', hr: '', temp: '', o2: '', pain: '' }
    });
  };

  if (!patient) {
    return (
      <Alert className="bg-red-50 border-red-300">
        <AlertDescription className="text-sm text-red-800">
          Patient not cached for offline access. Download patient data first.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className={`border-2 ${isOnline ? 'border-blue-300' : 'border-orange-300'}`}>
      <CardHeader className={isOnline ? 'bg-blue-50' : 'bg-orange-50'}>
        <CardTitle className="text-base flex items-center gap-2">
          <Edit3 className="w-5 h-5" />
          {isOnline ? 'Document Visit' : 'Offline Note Editor'}
          {!isOnline && <Badge className="bg-orange-600 ml-auto">Offline Mode</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {!isOnline && (
          <Alert className="bg-orange-50 border-orange-300">
            <WifiOff className="w-4 h-4 text-orange-600" />
            <AlertDescription className="text-sm text-orange-800">
              Working offline. This note will sync when connection returns.
            </AlertDescription>
          </Alert>
        )}

        {savedLocally && (
          <Alert className="bg-green-50 border-green-300">
            <CheckCircle2 className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-sm text-green-800">
              ✅ Note saved locally. Will sync when online.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          <div>
            <Label className="text-sm">Patient</Label>
            <p className="font-medium">{patient.first_name} {patient.last_name}</p>
            <p className="text-xs text-slate-600">{patient.primary_diagnosis}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-sm">Visit Date</Label>
              <Input
                type="date"
                value={noteData.visit_date}
                onChange={(e) => setNoteData({...noteData, visit_date: e.target.value})}
              />
            </div>
            <div>
              <Label className="text-sm">Visit Type</Label>
              <Select value={noteData.visit_type} onValueChange={(val) => setNoteData({...noteData, visit_type: val})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="routine_visit">Routine Visit</SelectItem>
                  <SelectItem value="admission">Admission</SelectItem>
                  <SelectItem value="recertification">Recertification</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                  <SelectItem value="prn">PRN Visit</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Vitals */}
          <div>
            <Label className="text-sm font-semibold mb-2 block">Vital Signs</Label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <Input
                placeholder="BP (120/80)"
                value={noteData.vitals.bp}
                onChange={(e) => setNoteData({...noteData, vitals: {...noteData.vitals, bp: e.target.value}})}
              />
              <Input
                placeholder="HR (bpm)"
                type="number"
                value={noteData.vitals.hr}
                onChange={(e) => setNoteData({...noteData, vitals: {...noteData.vitals, hr: e.target.value}})}
              />
              <Input
                placeholder="Temp (°F)"
                type="number"
                step="0.1"
                value={noteData.vitals.temp}
                onChange={(e) => setNoteData({...noteData, vitals: {...noteData.vitals, temp: e.target.value}})}
              />
              <Input
                placeholder="O2 Sat (%)"
                type="number"
                value={noteData.vitals.o2}
                onChange={(e) => setNoteData({...noteData, vitals: {...noteData.vitals, o2: e.target.value}})}
              />
              <Input
                placeholder="Pain (0-10)"
                type="number"
                min="0"
                max="10"
                value={noteData.vitals.pain}
                onChange={(e) => setNoteData({...noteData, vitals: {...noteData.vitals, pain: e.target.value}})}
              />
            </div>
          </div>

          {/* Note */}
          <div>
            <Label className="text-sm">Clinical Notes</Label>
            <Textarea
              placeholder="Document your visit notes here..."
              value={noteData.nurse_notes}
              onChange={(e) => setNoteData({...noteData, nurse_notes: e.target.value})}
              className="min-h-[200px]"
            />
            <p className="text-xs text-slate-500 mt-1">
              {noteData.nurse_notes.length} characters
            </p>
          </div>

          <Button
            onClick={handleSaveOffline}
            disabled={!noteData.nurse_notes || noteData.nurse_notes.length < 20}
            className="w-full bg-blue-600 hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save {isOnline ? 'Note' : 'Offline'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}