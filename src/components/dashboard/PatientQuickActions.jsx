import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UserPlus, Calendar, Stethoscope } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function PatientQuickActions({ onActionComplete }) {
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [showNewVisit, setShowNewVisit] = useState(false);
  const [showNewDiagnosis, setShowNewDiagnosis] = useState(false);

  const queryClient = useQueryClient();

  const { data: patients = [] } = useQuery({
    queryKey: ['patients-quick-action'],
    queryFn: () => base44.entities.Patient.filter({ status: 'active' }, '-updated_date', 100)
  });

  // New Patient Form
  const [newPatient, setNewPatient] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    phone: '',
    primary_diagnosis: '',
    care_type: 'home_health',
    status: 'active'
  });

  const createPatientMutation = useMutation({
    mutationFn: (data) => base44.entities.Patient.create(data),
    onSuccess: () => {
      toast.success('Patient created successfully!');
      setShowNewPatient(false);
      setNewPatient({
        first_name: '',
        last_name: '',
        date_of_birth: '',
        phone: '',
        primary_diagnosis: '',
        care_type: 'home_health',
        status: 'active'
      });
      queryClient.invalidateQueries({ queryKey: ['all-patients'] });
      queryClient.invalidateQueries({ queryKey: ['patients-quick-action'] });
      if (onActionComplete) onActionComplete();
    },
    onError: (error) => {
      toast.error('Failed to create patient: ' + error.message);
    }
  });

  // New Visit Form
  const [newVisit, setNewVisit] = useState({
    patient_id: '',
    visit_date: new Date().toISOString().split('T')[0],
    visit_type: 'routine_visit',
    status: 'scheduled'
  });

  const createVisitMutation = useMutation({
    mutationFn: (data) => base44.entities.Visit.create(data),
    onSuccess: () => {
      toast.success('Visit scheduled successfully!');
      setShowNewVisit(false);
      setNewVisit({
        patient_id: '',
        visit_date: new Date().toISOString().split('T')[0],
        visit_type: 'routine_visit',
        status: 'scheduled'
      });
      queryClient.invalidateQueries({ queryKey: ['all-visits'] });
      if (onActionComplete) onActionComplete();
    },
    onError: (error) => {
      toast.error('Failed to schedule visit: ' + error.message);
    }
  });

  // New Diagnosis/Note
  const [newDiagnosis, setNewDiagnosis] = useState({
    patient_id: '',
    diagnosis: '',
    notes: ''
  });

  const updatePatientDiagnosisMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.Patient.update(id, data),
    onSuccess: () => {
      toast.success('Diagnosis added successfully!');
      setShowNewDiagnosis(false);
      setNewDiagnosis({
        patient_id: '',
        diagnosis: '',
        notes: ''
      });
      queryClient.invalidateQueries({ queryKey: ['all-patients'] });
      if (onActionComplete) onActionComplete();
    },
    onError: (error) => {
      toast.error('Failed to add diagnosis: ' + error.message);
    }
  });

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => setShowNewPatient(true)}
          className="bg-blue-600 hover:bg-blue-700 h-11"
        >
          <UserPlus className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">New Patient</span>
          <span className="sm:hidden">New</span>
        </Button>
        <Button
          onClick={() => setShowNewVisit(true)}
          variant="outline"
          className="h-11"
        >
          <Calendar className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Schedule Visit</span>
          <span className="sm:hidden">Visit</span>
        </Button>
        <Button
          onClick={() => setShowNewDiagnosis(true)}
          variant="outline"
          className="h-11"
        >
          <Stethoscope className="w-4 h-4 mr-2" />
          <span className="hidden sm:inline">Add Diagnosis</span>
          <span className="sm:hidden">Diagnosis</span>
        </Button>
      </div>

      {/* New Patient Dialog */}
      <Dialog open={showNewPatient} onOpenChange={setShowNewPatient}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Patient</DialogTitle>
            <DialogDescription>Enter patient information to create a new record</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name *</Label>
                <Input
                  value={newPatient.first_name}
                  onChange={(e) => setNewPatient({ ...newPatient, first_name: e.target.value })}
                  placeholder="John"
                />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input
                  value={newPatient.last_name}
                  onChange={(e) => setNewPatient({ ...newPatient, last_name: e.target.value })}
                  placeholder="Doe"
                />
              </div>
            </div>
            <div>
              <Label>Date of Birth</Label>
              <Input
                type="date"
                value={newPatient.date_of_birth}
                onChange={(e) => setNewPatient({ ...newPatient, date_of_birth: e.target.value })}
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={newPatient.phone}
                onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                placeholder="555-123-4567"
              />
            </div>
            <div>
              <Label>Primary Diagnosis</Label>
              <Input
                value={newPatient.primary_diagnosis}
                onChange={(e) => setNewPatient({ ...newPatient, primary_diagnosis: e.target.value })}
                placeholder="CHF, COPD, etc."
              />
            </div>
            <div>
              <Label>Care Type</Label>
              <Select value={newPatient.care_type} onValueChange={(value) => setNewPatient({ ...newPatient, care_type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewPatient(false)}>Cancel</Button>
            <Button
              onClick={() => createPatientMutation.mutate(newPatient)}
              disabled={!newPatient.first_name || !newPatient.last_name || createPatientMutation.isPending}
            >
              {createPatientMutation.isPending ? 'Creating...' : 'Create Patient'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Visit Dialog */}
      <Dialog open={showNewVisit} onOpenChange={setShowNewVisit}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule New Visit</DialogTitle>
            <DialogDescription>Schedule a visit for an active patient</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Patient *</Label>
              <Select value={newVisit.patient_id} onValueChange={(value) => setNewVisit({ ...newVisit, patient_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} - {p.medical_record_number || 'No MRN'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visit Date *</Label>
              <Input
                type="date"
                value={newVisit.visit_date}
                onChange={(e) => setNewVisit({ ...newVisit, visit_date: e.target.value })}
              />
            </div>
            <div>
              <Label>Visit Type</Label>
              <Select value={newVisit.visit_type} onValueChange={(value) => setNewVisit({ ...newVisit, visit_type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                  <SelectItem value="admission">Admission</SelectItem>
                  <SelectItem value="recertification">Recertification</SelectItem>
                  <SelectItem value="discharge">Discharge</SelectItem>
                  <SelectItem value="routine_visit">Routine Visit</SelectItem>
                  <SelectItem value="prn">PRN</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewVisit(false)}>Cancel</Button>
            <Button
              onClick={() => createVisitMutation.mutate(newVisit)}
              disabled={!newVisit.patient_id || !newVisit.visit_date || createVisitMutation.isPending}
            >
              {createVisitMutation.isPending ? 'Scheduling...' : 'Schedule Visit'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Diagnosis Dialog */}
      <Dialog open={showNewDiagnosis} onOpenChange={setShowNewDiagnosis}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Diagnosis</DialogTitle>
            <DialogDescription>Add or update patient diagnosis</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Patient *</Label>
              <Select value={newDiagnosis.patient_id} onValueChange={(value) => setNewDiagnosis({ ...newDiagnosis, patient_id: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select patient" />
                </SelectTrigger>
                <SelectContent>
                  {patients.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} - {p.primary_diagnosis || 'No diagnosis'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Diagnosis *</Label>
              <Input
                value={newDiagnosis.diagnosis}
                onChange={(e) => setNewDiagnosis({ ...newDiagnosis, diagnosis: e.target.value })}
                placeholder="e.g., CHF, COPD, Diabetes"
              />
            </div>
            <div>
              <Label>Clinical Notes</Label>
              <Textarea
                value={newDiagnosis.notes}
                onChange={(e) => setNewDiagnosis({ ...newDiagnosis, notes: e.target.value })}
                placeholder="Additional clinical notes..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDiagnosis(false)}>Cancel</Button>
            <Button
              onClick={() => {
                const patient = patients.find(p => p.id === newDiagnosis.patient_id);
                if (patient) {
                  updatePatientDiagnosisMutation.mutate({
                    id: patient.id,
                    data: {
                      primary_diagnosis: newDiagnosis.diagnosis,
                      clinical_notes: newDiagnosis.notes
                    }
                  });
                }
              }}
              disabled={!newDiagnosis.patient_id || !newDiagnosis.diagnosis || updatePatientDiagnosisMutation.isPending}
            >
              {updatePatientDiagnosisMutation.isPending ? 'Saving...' : 'Save Diagnosis'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}