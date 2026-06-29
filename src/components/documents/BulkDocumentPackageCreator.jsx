import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, CheckCircle2, Send } from 'lucide-react';
import { toast } from 'sonner';

export default function BulkDocumentPackageCreator() {
  const [selectedPatients, setSelectedPatients] = useState([]);
  const [selectedTemplates, setSelectedTemplates] = useState([]);
  const [patientSearch, setPatientSearch] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const results = await base44.entities.Patient.list('-updated_date', 100);
      return results;
    },
  });

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['documentTemplates'],
    queryFn: async () => {
      const results = await base44.entities.DocumentTemplate.filter({ is_active: true });
      return results;
    },
  });

  const filteredPatients = patients.filter(
    (p) =>
      `${p.first_name} ${p.last_name}`.toLowerCase().includes(patientSearch.toLowerCase()) ||
      p.email?.toLowerCase().includes(patientSearch.toLowerCase())
  );

  const togglePatient = (patientId) => {
    setSelectedPatients((prev) =>
      prev.includes(patientId) ? prev.filter((id) => id !== patientId) : [...prev, patientId]
    );
  };

  const toggleTemplate = (templateId) => {
    setSelectedTemplates((prev) =>
      prev.includes(templateId) ? prev.filter((id) => id !== templateId) : [...prev, templateId]
    );
  };

  const handleSubmit = async () => {
    if (selectedPatients.length === 0) {
      toast.error('Select at least one patient');
      return;
    }
    if (selectedTemplates.length === 0) {
      toast.error('Select at least one template');
      return;
    }
    if (!dueDate) {
      toast.error('Set a due date');
      return;
    }

    try {
      setIsSubmitting(true);
      await base44.asServiceRole.functions.invoke('bulkCreateDocumentPackages', {
        patient_ids: selectedPatients,
        template_ids: selectedTemplates,
        due_date: dueDate,
      });

      toast.success(
        `Created ${selectedPatients.length * selectedTemplates.length} document package(s)`
      );
      setSelectedPatients([]);
      setSelectedTemplates([]);
      setDueDate('');
      queryClient.invalidateQueries({ queryKey: ['documentPackages'] });
    } catch (error) {
      toast.error(error.message || 'Failed to create packages');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex gap-3 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-900">
          Select one or more patients and templates. Signature requests will be sent to each patient's
          caregiver email for each selected template.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Patients Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select Patients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input
              placeholder="Search by name or email..."
              value={patientSearch}
              onChange={(e) => setPatientSearch(e.target.value)}
            />

            <div className="space-y-2 max-h-96 overflow-y-auto border border-slate-200 rounded-lg p-3">
              {patientsLoading ? (
                <p className="text-sm text-slate-500">Loading patients...</p>
              ) : filteredPatients.length === 0 ? (
                <p className="text-sm text-slate-500">No patients found</p>
              ) : (
                filteredPatients.map((patient) => (
                  <label
                    key={patient.id}
                    className="flex items-start gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedPatients.includes(patient.id)}
                      onCheckedChange={() => togglePatient(patient.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">
                        {patient.first_name} {patient.last_name}
                      </p>
                      {patient.caregiver_email && (
                        <p className="text-xs text-slate-600">{patient.caregiver_email}</p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            <p className="text-sm text-slate-600">
              Selected: <span className="font-medium">{selectedPatients.length}</span> patient(s)
            </p>
          </CardContent>
        </Card>

        {/* Templates Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 max-h-96 overflow-y-auto border border-slate-200 rounded-lg p-3">
              {templatesLoading ? (
                <p className="text-sm text-slate-500">Loading templates...</p>
              ) : templates.length === 0 ? (
                <p className="text-sm text-slate-500">No active templates found</p>
              ) : (
                templates.map((template) => (
                  <label
                    key={template.id}
                    htmlFor={`template-${template.id}`}
                    className="flex items-start gap-3 p-2 hover:bg-slate-50 rounded cursor-pointer"
                  >
                    <Checkbox
                      id={`template-${template.id}`}
                      checked={selectedTemplates.includes(template.id)}
                      onCheckedChange={() => toggleTemplate(template.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{template.name}</p>
                      <p className="text-xs text-slate-600 truncate">{template.description}</p>
                    </div>
                  </label>
                ))
              )}
            </div>

            <p className="text-sm text-slate-600">
              Selected: <span className="font-medium">{selectedTemplates.length}</span> template(s)
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Due Date */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Due Date</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <Label htmlFor="due-date">Set due date for all packages</Label>
              <Input
                id="due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-2"
              />
            </div>
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting || selectedPatients.length === 0 || selectedTemplates.length === 0}
              className="gap-2"
            >
              <Send className="w-4 h-4" />
              {isSubmitting ? 'Creating...' : 'Create & Send'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Summary */}
      {selectedPatients.length > 0 && selectedTemplates.length > 0 && (
        <Card className="bg-slate-50 border-slate-200">
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
              <p className="text-sm text-slate-900">
                This will create and send{' '}
                <span className="font-bold">
                  {selectedPatients.length * selectedTemplates.length}
                </span>{' '}
                signature request(s) to{' '}
                <span className="font-bold">{selectedPatients.length}</span> patient(s) with{' '}
                <span className="font-bold">{selectedTemplates.length}</span> template(s).
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}