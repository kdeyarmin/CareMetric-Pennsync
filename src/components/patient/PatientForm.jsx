import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { X, Save, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { sanitizeObject, handleSecureError, logSecurityEvent } from "../utils/security";
import { validatePatient, formatPhoneNumber, SEVERITY } from "../utils/patientValidation";
import { findDuplicatesForCandidate } from "./patientDuplicateUtils";
import ValidationOverrideDialog from "./ValidationOverrideDialog";
import PotentialDuplicateDialog from "./PotentialDuplicateDialog";
import OCRDocumentExtractor from "./OCRDocumentExtractor";
import { toast } from 'sonner';

export default function PatientForm({ patient, onSuccess, onCancel }) {
  const [formData, setFormData] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    medical_record_number: '',
    address: '',
    phone: '',
    email: '',
    primary_diagnosis: '',
    secondary_diagnoses: [],
    allergies: '',
    care_type: 'home_health',
    status: 'active'
  });

  // Keep a live ref to the latest formData so real-time validation always sees
  // every field's current value. The old handleChange validated
  // `{ ...formData, [field]: value }` off the render closure, so every field
  // except the one being edited was the stale pre-keystroke value (cross-field
  // checks and "did I fix it?" feedback were wrong). The timer ref also debounces.
  const formDataRef = useRef(formData);
  useEffect(() => { formDataRef.current = formData; }, [formData]);
  const validationTimerRef = useRef(null);
  // Clear the debounced-validation timer on unmount so it can't fire setState
  // after the component is gone (and leak the pending timeout).
  useEffect(() => () => clearTimeout(validationTimerRef.current), []);

  const [secondaryDiagnosisInput, setSecondaryDiagnosisInput] = useState('');
  const [validationErrors, setValidationErrors] = useState([]);
  const [overriddenWarnings, setOverriddenWarnings] = useState({});
  const [showOverrideDialog, setShowOverrideDialog] = useState(false);
  const [currentWarning, setCurrentWarning] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [duplicateMatches, setDuplicateMatches] = useState([]);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);

  // Existing roster, used to catch duplicates at entry time. Reuses the same
  // ['patients'] cache the Patients page populates, so this is usually instant
  // and adds no extra round-trip. Only needed when adding a brand-new patient.
  const { data: existingPatients = [] } = useQuery({
    queryKey: ['patients'],
    queryFn: async () => {
      const all = await base44.entities.Patient.list('-created_date', 2000);
      return all.filter((p) => !p.is_archived);
    },
    enabled: !patient,
    staleTime: 60000,
  });

  const handleOCRDataExtracted = (extractedData) => {
    setFormData(prev => ({
      ...prev,
      ...extractedData,
      secondary_diagnoses: extractedData.secondary_diagnoses || prev.secondary_diagnoses || []
    }));
    
    // Trigger validation on extracted data
    const errors = validatePatient({ ...formData, ...extractedData });
    setValidationErrors(errors);
  };

  useEffect(() => {
    if (patient) {
      setFormData(prev => ({
        ...prev,
        ...patient,
        secondary_diagnoses: patient.secondary_diagnoses || []
      }));
    }
  }, [patient]);

  const handleChange = (field, value) => {
    const next = { ...formDataRef.current, [field]: value };
    formDataRef.current = next; // sync so rapid successive edits accumulate
    setFormData(next);

    // Real-time validation against the authoritative next state, debounced.
    clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      setValidationErrors(validatePatient(next));
    }, 500);
  };
  
  const handleOverrideWarning = (field, justification) => {
    setOverriddenWarnings(prev => ({
      ...prev,
      [field]: { justification, timestamp: new Date().toISOString() }
    }));
  };
  
  const getFieldError = (fieldName) => {
    return validationErrors.find(e => e.field === fieldName && e.severity === SEVERITY.ERROR);
  };
  
  const getFieldWarning = (fieldName) => {
    if (overriddenWarnings[fieldName]) return null;
    return validationErrors.find(e => e.field === fieldName && e.severity === SEVERITY.WARNING && e.canOverride);
  };
  
  const getFieldInfo = (fieldName) => {
    return validationErrors.find(e => e.field === fieldName && e.severity === SEVERITY.INFO);
  };

  const addSecondaryDiagnosis = () => {
    if (secondaryDiagnosisInput.trim()) {
      setFormData(prev => ({
        ...prev,
        secondary_diagnoses: [...(prev.secondary_diagnoses || []), secondaryDiagnosisInput.trim()]
      }));
      setSecondaryDiagnosisInput('');
    }
  };

  const removeSecondaryDiagnosis = (index) => {
    setFormData(prev => ({
      ...prev,
      secondary_diagnoses: prev.secondary_diagnoses.filter((_, i) => i !== index)
    }));
  };

  // Actually create/update the patient. Split out from handleSubmit so the
  // duplicate-warning dialog's "Add as new anyway" can persist directly,
  // bypassing the duplicate check it just dismissed.
  const persistPatient = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      // Include override justifications in form data
      const dataWithOverrides = {
        ...formData,
        validation_overrides: overriddenWarnings
      };

      // Sanitize all input data before submission using the new sanitizeObject
      const sanitizedData = sanitizeObject(dataWithOverrides);

      if (patient) {
        // Update existing patient
        await base44.entities.Patient.update(patient.id, sanitizedData);
        await logSecurityEvent('PATIENT_UPDATED', {
          patient_id: patient.id,
          fields_changed: Object.keys(formData)
        });
      } else {
        // Create new patient
        await base44.entities.Patient.create(sanitizedData);
        await logSecurityEvent('PATIENT_CREATED', {
          // Don't log PHI as per outline
        });
      }

      if (onSuccess) onSuccess();
    } catch (error) {
      // Use the new handleSecureError for robust error handling and user feedback
      await handleSecureError(
        error,
        'patient_form_submit',
        (msg) => toast.error(msg)
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent double-submit: a second click before the create resolves would
    // create a duplicate patient record.
    if (isSubmitting) return;

    // Enhanced validation
    const errors = validatePatient(formData);
    const blockingErrors = errors.filter(e =>
      e.severity === SEVERITY.ERROR ||
      (e.severity === SEVERITY.WARNING && e.canOverride && !overriddenWarnings[e.field])
    );

    if (blockingErrors.length > 0) {
      setValidationErrors(errors);

      const unovverriddenWarnings = blockingErrors.filter(e => e.severity === SEVERITY.WARNING && e.canOverride);
      if (unovverriddenWarnings.length > 0) {
        toast.error('Please review and override the highlighted warnings before saving.');
        return;
      }

      toast.error('Please fix validation errors before saving');
      return;
    }

    // Duplicate guard — only when adding a new patient. If the entered record
    // looks like one already in the system, warn and offer to open that chart
    // instead of silently creating another duplicate.
    if (!patient) {
      const matches = findDuplicatesForCandidate(formData, existingPatients, { limit: 5 });
      if (matches.length > 0) {
        setDuplicateMatches(matches);
        setShowDuplicateDialog(true);
        return;
      }
    }

    await persistPatient();
  };

  // Filter and group validation messages
  const errorMessages = validationErrors.filter(e => e.severity === SEVERITY.ERROR);
  const warningMessages = validationErrors.filter(e => 
    e.severity === SEVERITY.WARNING && !overriddenWarnings[e.field]
  );
  const infoMessages = validationErrors.filter(e => e.severity === SEVERITY.INFO);
  
  return (
    <>
      <Card className="mb-6 modern-card-elevated animate-fade-in border-slate-200">
        <CardHeader className="bg-slate-50 border-b border-slate-100 rounded-t-xl">
          <CardTitle>{patient ? 'Edit Patient' : 'Add New Patient'}</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="p-6 space-y-4">
            {/* OCR Document Extractor - Only show for new patients */}
            {!patient && (
              <OCRDocumentExtractor onDataExtracted={handleOCRDataExtracted} />
            )}
            
            {/* Validation Summary */}
            {errorMessages.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription>
                  <strong className="block mb-2">Errors must be fixed:</strong>
                  <ul className="list-disc ml-4 space-y-1">
                    {errorMessages.map((err, idx) => (
                      <li key={idx}>{err.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {warningMessages.length > 0 && (
              <Alert className="border-amber-500 bg-amber-50">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription>
                  <strong className="block mb-2 text-amber-900">Warnings (can be overridden):</strong>
                  <ul className="space-y-2">
                    {warningMessages.map((warning, idx) => (
                      <li key={idx} className="flex items-start justify-between gap-2">
                        <span className="text-amber-800">{warning.message}</span>
                        {warning.canOverride && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setCurrentWarning(warning);
                              setShowOverrideDialog(true);
                            }}
                            className="flex-shrink-0 text-xs"
                          >
                            Override
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            
            {infoMessages.length > 0 && (
              <Alert className="border-blue-500 bg-blue-50">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription>
                  <ul className="space-y-1 text-blue-800">
                    {infoMessages.map((info, idx) => (
                      <li key={idx}>{info.message}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="first_name">First Name *</Label>
              <Input
                id="first_name"
                required
                value={formData.first_name}
                onChange={(e) => handleChange('first_name', e.target.value)}
                className={getFieldError('first_name') ? 'border-red-500' : ''}
              />
              {getFieldError('first_name') && (
                <p className="text-xs text-red-600 mt-1">{getFieldError('first_name').message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="last_name">Last Name *</Label>
              <Input
                id="last_name"
                required
                value={formData.last_name}
                onChange={(e) => handleChange('last_name', e.target.value)}
              />
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="date_of_birth">Date of Birth</Label>
              <Input
                id="date_of_birth"
                type="date"
                value={formData.date_of_birth}
                onChange={(e) => handleChange('date_of_birth', e.target.value)}
                className={getFieldError('date_of_birth') ? 'border-red-500' : getFieldWarning('date_of_birth') ? 'border-amber-500' : ''}
              />
              {getFieldError('date_of_birth') && (
                <p className="text-xs text-red-600 mt-1">{getFieldError('date_of_birth').message}</p>
              )}
              {getFieldWarning('date_of_birth') && (
                <p className="text-xs text-amber-600 mt-1">{getFieldWarning('date_of_birth').message}</p>
              )}
              {getFieldInfo('date_of_birth') && (
                <p className="text-xs text-blue-600 mt-1">{getFieldInfo('date_of_birth').message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="medical_record_number">Medical Record Number</Label>
              <Input
                id="medical_record_number"
                value={formData.medical_record_number}
                onChange={(e) => handleChange('medical_record_number', e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="address">Address</Label>
            <Input
              id="address"
              value={formData.address}
              onChange={(e) => handleChange('address', e.target.value)}
            />
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                placeholder="(123) 456-7890"
                className={getFieldError('phone') ? 'border-red-500' : ''}
              />
              {getFieldError('phone') && (
                <p className="text-xs text-red-600 mt-1">{getFieldError('phone').message}</p>
              )}
              {formData.phone && !getFieldError('phone') && (
                <p className="text-xs text-slate-500 mt-1">Formatted: {formatPhoneNumber(formData.phone)}</p>
              )}
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={getFieldError('email') ? 'border-red-500' : getFieldWarning('email') ? 'border-amber-500' : ''}
              />
              {getFieldError('email') && (
                <p className="text-xs text-red-600 mt-1">{getFieldError('email').message}</p>
              )}
              {getFieldWarning('email') && (
                <p className="text-xs text-amber-600 mt-1">{getFieldWarning('email').message}</p>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="care_type">Care Type *</Label>
              <Select
                value={formData.care_type}
                onValueChange={(value) => handleChange('care_type', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select care type" />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="home_health">Home Health</SelectItem>
                  <SelectItem value="hospice">Hospice</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => handleChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent style={{ zIndex: 9999 }}>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="discharged">Discharged</SelectItem>
                  <SelectItem value="hospitalized">Hospitalized</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="primary_diagnosis">Primary Diagnosis</Label>
            <Input
              id="primary_diagnosis"
              value={formData.primary_diagnosis}
              onChange={(e) => handleChange('primary_diagnosis', e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="secondary_diagnoses">Secondary Diagnoses</Label>
            <div className="flex gap-2 mb-2">
              <Input
                id="secondary_diagnoses"
                value={secondaryDiagnosisInput}
                onChange={(e) => setSecondaryDiagnosisInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addSecondaryDiagnosis())}
                placeholder="Type and press Enter"
              />
              <Button type="button" onClick={addSecondaryDiagnosis} variant="outline">
                Add
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.secondary_diagnoses?.map((diagnosis, index) => (
                <div key={index} className="flex items-center gap-1 bg-navy-100 text-navy-800 px-3 py-1 rounded-full">
                  <span className="text-sm">{diagnosis}</span>
                  <button
                    type="button"
                    onClick={() => removeSecondaryDiagnosis(index)}
                    className="hover:bg-navy-200 rounded-full p-1"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="allergies">Allergies</Label>
            <Textarea
              id="allergies"
              value={formData.allergies}
              onChange={(e) => handleChange('allergies', e.target.value)}
              placeholder="NKDA or list allergies"
              rows={3}
            />
          </div>
        </CardContent>
        <CardFooter className="flex justify-end gap-3 pt-4 border-t border-slate-100 bg-slate-50/50 rounded-b-xl">
          <Button type="button" className="btn-ghost text-slate-600" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="btn-primary" disabled={isSubmitting}>
            <Save className="w-4 h-4 mr-2" />
            {isSubmitting ? 'Saving…' : (patient ? 'Update Patient' : 'Add Patient')}
          </Button>
        </CardFooter>
      </form>
    </Card>
    
    <ValidationOverrideDialog
      isOpen={showOverrideDialog}
      onClose={() => setShowOverrideDialog(false)}
      warning={currentWarning}
      onOverride={handleOverrideWarning}
    />

    <PotentialDuplicateDialog
      open={showDuplicateDialog}
      onOpenChange={setShowDuplicateDialog}
      matches={duplicateMatches}
      onProceedAnyway={persistPatient}
    />
    </>
  );
}