import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { FileText, Building, User, Phone, AlertTriangle } from 'lucide-react';
import PhysicianSelector from '../physician/PhysicianSelector';

const DOCUMENT_TYPES = [
  { value: 'orders', label: 'Orders', disclaimer: 'URGENT - PHYSICIAN ORDERS ENCLOSED' },
  { value: 'lab_results', label: 'Lab Results', disclaimer: 'TIME-SENSITIVE LAB RESULTS' },
  { value: 'progress_notes', label: 'Progress Notes', disclaimer: 'CLINICAL PROGRESS NOTES' },
  { value: 'referral', label: 'Referral', disclaimer: 'REFERRAL INFORMATION ENCLOSED' },
  { value: 'discharge_summary', label: 'Discharge Summary', disclaimer: 'DISCHARGE SUMMARY - FOLLOW-UP REQUIRED' },
  { value: 'medication_list', label: 'Medication List', disclaimer: 'MEDICATION RECONCILIATION' },
  { value: 'consent_forms', label: 'Consent Forms', disclaimer: 'CONSENT FORMS FOR REVIEW' },
  { value: 'insurance', label: 'Insurance', disclaimer: 'INSURANCE DOCUMENTATION' },
  { value: 'other', label: 'Other', disclaimer: 'CONFIDENTIAL MEDICAL INFORMATION' },
];

const HIPAA_DISCLAIMERS = {
  standard: `CONFIDENTIAL NOTICE: This facsimile transmission contains confidential information belonging to the sender that is legally privileged. This information is intended only for the use of the individual or entity named above. The authorized recipient of this information is prohibited from disclosing this information to any other party unless required to do so by law or regulation and is required to destroy the information after its stated need has been fulfilled. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or action taken in reliance on the contents of these documents is STRICTLY PROHIBITED. If you have received this facsimile in error, please notify the sender immediately to arrange for return or destruction of these documents.`,
  
  urgent: `URGENT CONFIDENTIAL NOTICE: This transmission contains time-sensitive, confidential medical information that is legally privileged under HIPAA regulations. Immediate attention required. This information is intended only for the use of the individual or entity named above. Any unauthorized review, use, disclosure or distribution is prohibited. If you have received this transmission in error, please immediately notify the sender and destroy all copies of the original message.`,
  
  medication: `CONFIDENTIAL MEDICATION INFORMATION: This transmission contains protected health information (PHI) regarding patient medication management. This information is confidential and legally privileged under HIPAA. Recipients must ensure secure handling and storage of this information. Any unauthorized disclosure may result in civil and criminal penalties. If received in error, immediately notify sender and destroy all copies.`,
  
  orders: `PHYSICIAN ORDERS - CONFIDENTIAL: This transmission contains physician orders that constitute protected health information under HIPAA. Immediate clinical attention may be required. This information is intended solely for the healthcare provider named above. Unauthorized access, use, or disclosure is strictly prohibited and may be subject to legal penalties. If received in error, contact sender immediately.`,
};

export default function DynamicCoverSheetGenerator({ onGenerate, patientName, patientId }) {
  const [selectedPhysician, setSelectedPhysician] = useState(null);
  const [documentType, setDocumentType] = useState('');
  const [pageCount, setPageCount] = useState(1);
  const [urgency, setUrgency] = useState('routine');
  const [additionalNotes, setAdditionalNotes] = useState('');
  const [customRecipient, setCustomRecipient] = useState({
    name: '',
    organization: '',
    fax: '',
    phone: '',
  });
  const [useCustomRecipient, setUseCustomRecipient] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: agencySettings } = useQuery({
    queryKey: ['agencySettings'],
    queryFn: async () => {
      const settings = await base44.entities.AgencySettings.list();
      return settings[0] || {};
    },
  });

  useEffect(() => {
    if (selectedPhysician) {
      setUseCustomRecipient(false);
    }
  }, [selectedPhysician]);

  const getDisclaimerType = () => {
    if (urgency === 'urgent') return 'urgent';
    if (documentType === 'orders') return 'orders';
    if (documentType === 'medication_list') return 'medication';
    return 'standard';
  };

  const generateCoverSheet = () => {
    const recipient = useCustomRecipient ? customRecipient : {
      name: selectedPhysician?.full_name + (selectedPhysician?.credentials ? `, ${selectedPhysician.credentials}` : ''),
      organization: selectedPhysician?.practice_name || '',
      fax: selectedPhysician?.fax_number || '',
      phone: selectedPhysician?.phone_number || '',
    };

    const docTypeInfo = DOCUMENT_TYPES.find(dt => dt.value === documentType);
    const disclaimerType = getDisclaimerType();

    const coverSheetData = {
      // Sender Info
      from_name: currentUser?.full_name || '',
      from_organization: agencySettings?.office_name || 'Home Health Agency',
      from_phone: agencySettings?.office_phone || '',
      from_fax: agencySettings?.office_fax || '',
      from_address: agencySettings?.office_address || '',
      
      // Recipient Info
      to_name: recipient.name,
      to_organization: recipient.organization,
      to_fax: recipient.fax,
      to_phone: recipient.phone,
      
      // Document Info
      document_type: docTypeInfo?.label || 'Medical Records',
      document_type_disclaimer: docTypeInfo?.disclaimer || 'CONFIDENTIAL MEDICAL INFORMATION',
      page_count: pageCount + 1, // +1 for cover sheet itself
      urgency: urgency,
      date: new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }),
      time: new Date().toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      }),
      
      // Patient Info (if provided)
      patient_name: patientName || '',
      patient_id: patientId || '',
      
      // HIPAA Disclaimer
      hipaa_disclaimer: HIPAA_DISCLAIMERS[disclaimerType],
      
      // Additional Notes
      notes: additionalNotes,
      
      // Metadata
      physician_id: selectedPhysician?.id || null,
    };

    onGenerate(coverSheetData);
  };

  const isValid = () => {
    if (useCustomRecipient) {
      return customRecipient.name && customRecipient.fax && documentType && pageCount > 0;
    }
    return selectedPhysician && documentType && pageCount > 0;
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Cover Sheet Generator
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Recipient Selection */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold">Recipient Information</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUseCustomRecipient(!useCustomRecipient)}
              >
                {useCustomRecipient ? 'Use Physician Directory' : 'Enter Custom Recipient'}
              </Button>
            </div>

            {!useCustomRecipient ? (
              <div>
                <Label>Select Physician from Directory</Label>
                <PhysicianSelector
                  onSelect={setSelectedPhysician}
                  selectedPhysician={selectedPhysician}
                />
                {selectedPhysician && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-600" />
                      <span className="font-semibold">{selectedPhysician.full_name}</span>
                      {selectedPhysician.credentials && (
                        <span className="text-blue-600">{selectedPhysician.credentials}</span>
                      )}
                    </div>
                    {selectedPhysician.practice_name && (
                      <div className="flex items-center gap-2 text-slate-600">
                        <Building className="w-4 h-4" />
                        {selectedPhysician.practice_name}
                      </div>
                    )}
                    {selectedPhysician.fax_number && (
                      <div className="flex items-center gap-2 text-slate-600">
                        <Phone className="w-4 h-4" />
                        Fax: {selectedPhysician.fax_number}
                      </div>
                    )}
                    {selectedPhysician.specialty && (
                      <div className="text-slate-600">
                        Specialty: {selectedPhysician.specialty.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <Label>Recipient Name *</Label>
                  <Input
                    value={customRecipient.name}
                    onChange={(e) => setCustomRecipient({ ...customRecipient, name: e.target.value })}
                    placeholder="Dr. John Smith, MD"
                  />
                </div>
                <div>
                  <Label>Organization</Label>
                  <Input
                    value={customRecipient.organization}
                    onChange={(e) => setCustomRecipient({ ...customRecipient, organization: e.target.value })}
                    placeholder="Medical Practice Name"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Fax Number *</Label>
                    <Input
                      value={customRecipient.fax}
                      onChange={(e) => setCustomRecipient({ ...customRecipient, fax: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                  <div>
                    <Label>Phone Number</Label>
                    <Input
                      value={customRecipient.phone}
                      onChange={(e) => setCustomRecipient({ ...customRecipient, phone: e.target.value })}
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Document Information */}
          <div className="space-y-4">
            <Label className="text-base font-semibold">Document Information</Label>
            
            <div>
              <Label>Document Type *</Label>
              <Select value={documentType} onValueChange={setDocumentType}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map(type => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {documentType && (
                <p className="mt-2 text-xs text-slate-600 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  Cover sheet will include: "{DOCUMENT_TYPES.find(t => t.value === documentType)?.disclaimer}"
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Number of Pages (excluding cover) *</Label>
                <Input
                  type="number"
                  min="1"
                  value={pageCount}
                  onChange={(e) => setPageCount(parseInt(e.target.value) || 1)}
                />
              </div>
              <div>
                <Label>Urgency Level</Label>
                <Select value={urgency} onValueChange={setUrgency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="routine">Routine</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="stat">STAT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Patient Information */}
          {patientName && (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <Label className="text-sm font-semibold">Patient</Label>
              <p className="text-sm text-slate-700 mt-1">{patientName}</p>
              {patientId && <p className="text-xs text-slate-500">ID: {patientId}</p>}
            </div>
          )}

          {/* Additional Notes */}
          <div>
            <Label>Additional Notes (Optional)</Label>
            <Textarea
              value={additionalNotes}
              onChange={(e) => setAdditionalNotes(e.target.value)}
              placeholder="Any special instructions or additional information..."
              rows={3}
            />
          </div>

          {/* HIPAA Disclaimer Preview */}
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <Label className="text-sm font-semibold text-yellow-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              HIPAA Disclaimer (will appear on cover sheet)
            </Label>
            <p className="text-xs text-yellow-800 mt-2 leading-relaxed">
              {HIPAA_DISCLAIMERS[getDisclaimerType()]}
            </p>
          </div>

          {/* Generate Button */}
          <Button
            onClick={generateCoverSheet}
            disabled={!isValid()}
            className="w-full"
            size="lg"
          >
            Generate Cover Sheet
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}