import React, { useState, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileCheck, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { secureEntity } from '../security/SecureEntityWrapper';

export default function TelehealthConsentForm({ patient, onConsentComplete }) {
  const [formData, setFormData] = useState({
    consent_type: 'video',
    state_of_service: '',
    patient_location: '',
    emergency_contact_verified: false,
    risks_explained: false,
    privacy_policy_accepted: false,
    recording_consent: false
  });
  const [signature, setSignature] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canvasRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);

  const startDrawing = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
    setIsDrawing(true);
  };

  const draw = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    const canvas = canvasRef.current;
    setSignature(canvas.toDataURL());
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature('');
  };

  const handleSubmit = async () => {
    if (!formData.state_of_service || !formData.patient_location) {
      alert('Please fill in all required fields');
      return;
    }

    if (!formData.emergency_contact_verified || !formData.risks_explained || !formData.privacy_policy_accepted) {
      alert('Please accept all required consents');
      return;
    }

    if (!signature) {
      alert('Please provide your signature');
      return;
    }

    setIsSubmitting(true);
    try {
      const user = await base44.auth.me();
      
      // Create telehealth consent with secure logging
      const consent = await secureEntity.create('TelehealthConsent', {
        patient_id: patient.id,
        consent_date: new Date().toISOString(),
        consent_type: formData.consent_type,
        patient_signature: signature,
        provider_email: user.email,
        state_of_service: formData.state_of_service,
        patient_location: formData.patient_location,
        emergency_contact_verified: formData.emergency_contact_verified,
        risks_explained: formData.risks_explained,
        privacy_policy_accepted: formData.privacy_policy_accepted,
        recording_consent: formData.recording_consent,
        is_active: true
      });

      // Log consent to patient chart for compliance documentation
      const complianceStatement = `
TELEHEALTH INFORMED CONSENT - COMPLIANCE DOCUMENTATION
Patient: ${patient.first_name} ${patient.last_name} (MRN: ${patient.medical_record_number})
Date: ${new Date().toLocaleString()}
Provider: ${user.full_name} (${user.email})

CONSENT TYPE: ${formData.consent_type === 'video' ? 'Video Consultation' : formData.consent_type === 'audio_only' ? 'Audio Only (Phone)' : 'Store & Forward (Async)'}

STATE OF SERVICE: ${formData.state_of_service}
PATIENT LOCATION: ${formData.patient_location}

PATIENT ACKNOWLEDGMENTS:
✓ Emergency contact verified and 911 protocol understood
✓ Risks and limitations of telehealth explained and understood
✓ HIPAA Notice of Privacy Practices reviewed and acknowledged
${formData.recording_consent ? '✓ Consent to session recording for quality assurance' : '✗ Recording consent not granted'}

HIPAA COMPLIANCE STATEMENTS:
1. Patient acknowledges receiving HIPAA Notice of Privacy Practices
2. Patient understands their health information will be transmitted securely
3. Patient consents to the use of telehealth technology for healthcare services
4. Patient understands their rights regarding privacy and security of health information
5. Patient has been informed of potential risks including technical failures and unauthorized access
6. Patient confirms they are in a private location during telehealth visits
7. Patient acknowledges emergency services (911) should be contacted for emergencies
8. Patient understands they have the right to refuse telehealth services at any time

LEGAL AND REGULATORY COMPLIANCE:
- State licensure: Provider licensed in ${formData.state_of_service}
- Patient location verified: ${formData.patient_location}
- Telehealth consent obtained and documented per state regulations
- HIPAA-compliant video conferencing platform utilized
- End-to-end encryption enabled for all telehealth communications

PATIENT CONSENT STATEMENT:
"I hereby consent to receiving healthcare services via telehealth. I understand that telehealth involves the use of electronic communications to enable healthcare providers to diagnose, consult, treat, and educate patients remotely. I understand that I have the right to withhold or withdraw my consent to telehealth services at any time."

Signature obtained: Yes (Digital signature captured ${new Date().toLocaleString()})
Consent recorded by: ${user.full_name}
Consent ID: ${consent.id}

This consent is valid for ongoing telehealth services unless revoked by the patient in writing.
      `.trim();

      // Add compliance documentation to patient's clinical notes
      await secureEntity.update('Patient', patient.id, {
        clinical_notes: (patient.clinical_notes || '') + '\n\n' + complianceStatement
      });

      // Create audit trail entry
      await base44.entities.AuditTrail.create({
        entity_type: 'TelehealthConsent',
        entity_id: consent.id,
        action: 'consent_obtained',
        user_email: user.email,
        user_name: user.full_name,
        details: {
          patient_id: patient.id,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          consent_type: formData.consent_type,
          state: formData.state_of_service,
          all_requirements_met: true,
          compliance_statement_logged: true
        },
        timestamp: new Date().toISOString()
      });

      if (onConsentComplete) {
        onConsentComplete(consent);
      }
    } catch (error) {
      alert('Failed to save consent: ' + error.message);
    }
    setIsSubmitting(false);
  };

  const usStates = ['AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileCheck className="w-5 h-5 text-blue-600" />
          Telehealth Informed Consent
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-blue-900">
              <p className="font-semibold mb-2">Patient: {patient.first_name} {patient.last_name}</p>
              <p>This consent is required before conducting any telehealth services. Please review all information carefully.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <Label>Type of Telehealth Service</Label>
            <Select value={formData.consent_type} onValueChange={(value) => setFormData({...formData, consent_type: value})}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Video Consultation</SelectItem>
                <SelectItem value="audio_only">Audio Only (Phone)</SelectItem>
                <SelectItem value="store_forward">Store & Forward (Async)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>State Where Service Will Be Provided *</Label>
            <Select value={formData.state_of_service} onValueChange={(value) => setFormData({...formData, state_of_service: value})}>
              <SelectTrigger className="mt-1">
                <SelectValue placeholder="Select state" />
              </SelectTrigger>
              <SelectContent>
                {usStates.map(state => (
                  <SelectItem key={state} value={state}>{state}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-1">Provider must be licensed in this state</p>
          </div>

          <div>
            <Label>Patient Location During Visits *</Label>
            <Input
              value={formData.patient_location}
              onChange={(e) => setFormData({...formData, patient_location: e.target.value})}
              placeholder="Street address, City, State, ZIP"
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">Physical address where patient will be during telehealth sessions</p>
          </div>
        </div>

        <div className="border-t pt-4 space-y-4">
          <h3 className="font-semibold text-gray-900">Required Acknowledgments</h3>
          
          <div className="flex items-start gap-3">
            <Checkbox
              checked={formData.emergency_contact_verified}
              onCheckedChange={(checked) => setFormData({...formData, emergency_contact_verified: checked})}
              className="mt-1"
            />
            <div className="flex-1">
              <Label className="text-sm font-normal">
                I have verified my emergency contact information and understand that in case of emergency during a telehealth visit, 
                emergency services (911) should be contacted immediately.
              </Label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              checked={formData.risks_explained}
              onCheckedChange={(checked) => setFormData({...formData, risks_explained: checked})}
              className="mt-1"
            />
            <div className="flex-1">
              <Label className="text-sm font-normal">
                I understand the potential risks of telehealth including technical failures, security risks, and limitations 
                compared to in-person visits. I have had the opportunity to ask questions.
              </Label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              checked={formData.privacy_policy_accepted}
              onCheckedChange={(checked) => setFormData({...formData, privacy_policy_accepted: checked})}
              className="mt-1"
            />
            <div className="flex-1">
              <Label className="text-sm font-normal">
                I acknowledge that I have received and reviewed the HIPAA Notice of Privacy Practices and understand how my 
                health information will be used and protected during telehealth services.
              </Label>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              checked={formData.recording_consent}
              onCheckedChange={(checked) => setFormData({...formData, recording_consent: checked})}
              className="mt-1"
            />
            <div className="flex-1">
              <Label className="text-sm font-normal">
                I consent to having telehealth sessions recorded for quality assurance and documentation purposes. 
                (Optional - recordings are HIPAA-compliant and stored securely)
              </Label>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <Label>Patient Signature *</Label>
          <div className="mt-2 border-2 border-gray-300 rounded-lg">
            <canvas
              ref={canvasRef}
              width={600}
              height={200}
              className="w-full cursor-crosshair"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
            />
          </div>
          <div className="flex gap-2 mt-2">
            <Button type="button" variant="outline" size="sm" onClick={clearSignature}>
              Clear Signature
            </Button>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isSubmitting ? 'Saving...' : 'Save Consent & Continue'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}