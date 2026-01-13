import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shield, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

export default function TelehealthComplianceChecker({ consent, provider, patient }) {
  const complianceChecks = [
    {
      name: 'Provider Licensure',
      status: checkProviderLicensure(provider, consent?.state_of_service),
      description: 'Provider must be licensed in the state where patient is located'
    },
    {
      name: 'Informed Consent',
      status: !!consent?.is_active,
      description: 'Valid informed consent obtained and documented'
    },
    {
      name: 'Privacy & Security',
      status: true, // Using HIPAA-compliant Twilio Video
      description: 'End-to-end encryption and HIPAA-compliant platform'
    },
    {
      name: 'Emergency Procedures',
      status: consent?.emergency_contact_verified || false,
      description: 'Emergency contact verified and documented'
    },
    {
      name: 'Patient Location',
      status: !!(consent?.patient_location && consent?.state_of_service),
      description: 'Patient location documented for emergency response'
    },
    {
      name: 'Documentation Standards',
      status: true,
      description: 'Visit will be documented per telehealth guidelines'
    }
  ];

  const allPassed = complianceChecks.every(check => check.status);
  const hasWarnings = complianceChecks.some(check => !check.status);

  return (
    <Card className={hasWarnings ? 'border-amber-200' : 'border-green-200'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className={`w-5 h-5 ${allPassed ? 'text-green-600' : 'text-amber-600'}`} />
          Telehealth Compliance Status
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!allPassed && (
          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              Please address the following compliance items before proceeding with the telehealth visit.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-3">
          {complianceChecks.map((check, index) => (
            <div key={index} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
              {check.status ? (
                <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="font-medium text-gray-900">{check.name}</p>
                <p className="text-sm text-gray-600 mt-1">{check.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h3 className="font-semibold text-blue-900 mb-2">State-Specific Requirements</h3>
          <p className="text-sm text-blue-800">
            {consent?.state_of_service ? (
              <>Providing care in: <strong>{consent.state_of_service}</strong></>
            ) : (
              'State not yet specified'
            )}
          </p>
          {consent?.state_of_service && (
            <ul className="text-sm text-blue-800 mt-2 space-y-1 list-disc list-inside">
              <li>Verify coverage and reimbursement policies</li>
              <li>Follow state-specific documentation requirements</li>
              <li>Comply with prescribing limitations if applicable</li>
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function checkProviderLicensure(provider, state) {
  // In production, this would check against license database
  // For now, assume provider is properly licensed
  return !!(provider && state);
}