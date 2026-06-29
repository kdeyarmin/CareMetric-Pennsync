import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { 
  ArrowRight, 
  Phone, 
  Mail, 
  MapPin, 
  Calendar,
  AlertTriangle,
  CheckCircle2,
  GitMerge
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { logActivity, ActivityActions } from "../utils/activityLogger";
import { mergePatientInto } from "./mergePatients";

export default function PatientMergeDialog({ 
  open, 
  onOpenChange, 
  patient1, 
  patient2 
}) {
  const queryClient = useQueryClient();
  const [selectedPrimary, setSelectedPrimary] = useState(null);
  const [step, setStep] = useState(1); // 1: Select Primary, 2: Review, 3: Confirm

  // Fetch related data for both patients
  const { data: patient1Visits = [] } = useQuery({
    queryKey: ['patientVisits', patient1?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient1.id }),
    enabled: !!patient1?.id,
  });

  const { data: patient2Visits = [] } = useQuery({
    queryKey: ['patientVisits', patient2?.id],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patient2.id }),
    enabled: !!patient2?.id,
  });

  const { data: patient1CarePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patient1?.id],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patient1.id }),
    enabled: !!patient1?.id,
  });

  const { data: patient2CarePlans = [] } = useQuery({
    queryKey: ['patientCarePlans', patient2?.id],
    queryFn: () => base44.entities.CarePlan.filter({ patient_id: patient2.id }),
    enabled: !!patient2?.id,
  });

  const mergeMutation = useMutation({
    mutationFn: async () => {
      const primaryPatient = selectedPrimary === 'patient1' ? patient1 : patient2;
      const secondaryPatient = selectedPrimary === 'patient1' ? patient2 : patient1;

      // Use the shared merge helper: it reassigns the secondary's clinical history
      // to the primary and SOFT-archives the secondary (status 'merged',
      // is_archived, merged_into_id) — mirroring the deduplicatePatients backend.
      // The previous inline path hard-deleted the secondary after moving only
      // visits and care plans, orphaning every other clinical record (OASIS,
      // incidents, documents, alerts, …) and destroying the patient irrecoverably.
      const me = await base44.auth.me().catch(() => null);
      await mergePatientInto(primaryPatient.id, secondaryPatient.id, { mergedBy: me?.email || null });

      return { primaryPatient, secondaryPatient };
    },
    onSuccess: ({ primaryPatient, secondaryPatient }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      logActivity(ActivityActions.UPDATE, {
        entity_type: 'Patient',
        action: 'merge_patients',
        primary_patient: `${primaryPatient.first_name} ${primaryPatient.last_name}`,
        merged_patient: `${secondaryPatient.first_name} ${secondaryPatient.last_name}`,
        page: 'Patients'
      });
      toast.success('Patients merged. The duplicate was archived (recoverable).');
      onOpenChange(false);
      setStep(1);
      setSelectedPrimary(null);
    },
    onError: (error) => {
      // Surface failures instead of leaving the button stuck and the merge silently
      // half-applied with no feedback.
      toast.error(`Merge failed: ${error?.message || 'Please try again.'}`);
    },
  });

  const handleClose = () => {
    onOpenChange(false);
    setStep(1);
    setSelectedPrimary(null);
  };

  if (!patient1 || !patient2) return null;

  const PatientCard = ({ patient, isSelected, value, visits, carePlans }) => (
    <div className="space-y-2">
      <RadioGroupItem 
        value={value} 
        id={value}
        className="peer sr-only"
      />
      <Label 
        htmlFor={value}
        className={`block cursor-pointer rounded-lg border-2 p-4 transition-all ${
          isSelected 
            ? 'border-blue-600 bg-blue-50' 
            : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="font-semibold text-lg">{patient.first_name} {patient.last_name}</h3>
            <p className="text-xs text-slate-500">MRN: {patient.medical_record_number || 'N/A'}</p>
          </div>
          {isSelected && (
            <Badge className="bg-blue-600">Primary</Badge>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-slate-600">
            <Calendar className="w-4 h-4" />
            <span>DOB: {patient.date_of_birth || 'N/A'}</span>
          </div>
          {patient.phone && (
            <div className="flex items-center gap-2 text-slate-600">
              <Phone className="w-4 h-4" />
              <span>{patient.phone}</span>
            </div>
          )}
          {patient.email && (
            <div className="flex items-center gap-2 text-slate-600">
              <Mail className="w-4 h-4" />
              <span>{patient.email}</span>
            </div>
          )}
          {patient.address && (
            <div className="flex items-start gap-2 text-slate-600">
              <MapPin className="w-4 h-4 mt-0.5" />
              <span className="text-xs">{patient.address}</span>
            </div>
          )}
        </div>

        <div className="flex gap-4 mt-3 pt-3 border-t">
          <div className="text-center">
            <p className="text-xs text-slate-500">Visits</p>
            <p className="text-lg font-semibold text-blue-600">{visits.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Care Plans</p>
            <p className="text-lg font-semibold text-green-600">{carePlans.length}</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-slate-500">Created</p>
            <p className="text-xs font-medium text-slate-700">
              {Number.isNaN(new Date(patient.created_date).getTime()) ? '—' : format(new Date(patient.created_date), 'MM/dd/yyyy')}
            </p>
          </div>
        </div>
      </Label>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="w-5 h-5 text-blue-600" />
            Merge Duplicate Patients - Step {step} of 3
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-300">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Select Primary Patient Record</p>
                <p className="text-xs">The primary patient's information will be kept. The other patient's clinical history will be transferred to it, and the duplicate record will be archived (recoverable), not deleted.</p>
              </AlertDescription>
            </Alert>

            <RadioGroup value={selectedPrimary} onValueChange={setSelectedPrimary}>
              <div className="grid md:grid-cols-2 gap-4">
                <PatientCard 
                  patient={patient1} 
                  isSelected={selectedPrimary === 'patient1'}
                  value="patient1"
                  visits={patient1Visits}
                  carePlans={patient1CarePlans}
                />
                <PatientCard 
                  patient={patient2} 
                  isSelected={selectedPrimary === 'patient2'}
                  value="patient2"
                  visits={patient2Visits}
                  carePlans={patient2CarePlans}
                />
              </div>
            </RadioGroup>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Alert className="bg-yellow-50 border-yellow-300">
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                <p className="font-medium mb-1">Review Merge Details</p>
                <p className="text-xs">Please review the merge operation below before confirming.</p>
              </AlertDescription>
            </Alert>

            <div className="grid md:grid-cols-3 gap-4 items-center">
              <Card className="border-2 border-green-300 bg-green-50">
                <CardHeader className="pb-2">
                  <Badge className="bg-green-600 w-fit">Primary (Keep)</Badge>
                </CardHeader>
                <CardContent>
                  <h3 className="font-semibold">
                    {(selectedPrimary === 'patient1' ? patient1 : patient2).first_name}{' '}
                    {(selectedPrimary === 'patient1' ? patient1 : patient2).last_name}
                  </h3>
                  <p className="text-xs text-slate-600">
                    MRN: {(selectedPrimary === 'patient1' ? patient1 : patient2).medical_record_number || 'N/A'}
                  </p>
                </CardContent>
              </Card>

              <div className="flex justify-center">
                <ArrowRight className="w-8 h-8 text-blue-600" />
              </div>

              <Card className="border-2 border-red-300 bg-red-50">
                <CardHeader className="pb-2">
                  <Badge className="bg-red-600 w-fit">Secondary (Merge &amp; Archive)</Badge>
                </CardHeader>
                <CardContent>
                  <h3 className="font-semibold">
                    {(selectedPrimary === 'patient1' ? patient2 : patient1).first_name}{' '}
                    {(selectedPrimary === 'patient1' ? patient2 : patient1).last_name}
                  </h3>
                  <p className="text-xs text-slate-600">
                    MRN: {(selectedPrimary === 'patient1' ? patient2 : patient1).medical_record_number || 'N/A'}
                  </p>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-blue-50 border-blue-300">
              <CardHeader>
                <CardTitle className="text-sm">What will happen:</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Transfer {(selectedPrimary === 'patient1' ? patient2Visits : patient1Visits).length} visits to primary patient</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Transfer {(selectedPrimary === 'patient1' ? patient2CarePlans : patient1CarePlans).length} care plans to primary patient</span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  <span>Transfer the secondary patient's other clinical records (OASIS, alerts, pending updates) to primary</span>
                </div>
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
                  <span className="text-amber-700 font-medium">Archive the secondary patient record (recoverable, not deleted)</span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Alert className="bg-red-50 border-red-300">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription>
                <p className="font-medium text-red-900 mb-1">⚠️ Final Confirmation Required</p>
                <p className="text-xs text-red-800">
                  The secondary patient's clinical history will be transferred to the primary and the duplicate record will be archived. This is recoverable (the duplicate is marked merged, not deleted), but please confirm the primary selection is correct.
                </p>
              </AlertDescription>
            </Alert>

            <div className="bg-slate-50 p-4 rounded-lg">
              <p className="text-sm font-medium mb-2">You are about to:</p>
              <ul className="space-y-1 text-sm text-slate-700">
                <li>• Merge {(selectedPrimary === 'patient1' ? patient2 : patient1).first_name} {(selectedPrimary === 'patient1' ? patient2 : patient1).last_name} into {(selectedPrimary === 'patient1' ? patient1 : patient2).first_name} {(selectedPrimary === 'patient1' ? patient1 : patient2).last_name}</li>
                <li>• Transfer {(selectedPrimary === 'patient1' ? patient2Visits.length : patient1Visits.length)} visits and {(selectedPrimary === 'patient1' ? patient2CarePlans.length : patient1CarePlans.length)} care plans (plus alerts and other clinical history)</li>
                <li>• Archive the secondary patient record (recoverable, not deleted)</li>
              </ul>
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between items-center">
          <div>
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep(step + 1)}
                disabled={step === 1 && !selectedPrimary}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Next: {step === 1 ? 'Review' : 'Confirm'}
              </Button>
            ) : (
              <Button
                onClick={() => mergeMutation.mutate()}
                disabled={mergeMutation.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {mergeMutation.isPending ? 'Merging...' : 'Merge Patients'}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}