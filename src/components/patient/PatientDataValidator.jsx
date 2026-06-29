import { useMemo } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

export default function PatientDataValidator({ patient }) {
  const validation = useMemo(() => {
    if (!patient) return { isValid: true, issues: [], score: 100 };

    const criticalFields = [
      { key: 'emergency_contact_name', label: 'Emergency Contact Name' },
      { key: 'emergency_contact_phone', label: 'Emergency Contact Phone' },
      { key: 'physician_name', label: 'Physician Name' },
      { key: 'phone', label: 'Patient Phone' },
      { key: 'date_of_birth', label: 'Date of Birth' },
      { key: 'address', label: 'Address' },
    ];

    const missing = criticalFields.filter(field => 
      !patient[field.key] || patient[field.key] === ''
    );

    const score = ((criticalFields.length - missing.length) / criticalFields.length * 100).toFixed(0);

    return {
      isValid: missing.length === 0,
      issues: missing.map(m => m.label),
      score: parseInt(score),
      critical: missing.length >= 3
    };
  }, [patient]);

  if (validation.isValid) {
    return (
      <Alert className="border-green-300 bg-green-50">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          Patient record is complete ({validation.score}% data quality)
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className={validation.critical ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}>
      <AlertTriangle className={`h-4 w-4 ${validation.critical ? 'text-red-600' : 'text-amber-600'}`} />
      <AlertDescription className={validation.critical ? 'text-red-800' : 'text-amber-800'}>
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold">Incomplete Patient Record ({validation.score}% complete)</span>
          <Badge variant={validation.critical ? "destructive" : "outline"}>
            {validation.critical ? 'Critical' : 'Warning'}
          </Badge>
        </div>
        <p className="text-sm">Missing: {validation.issues.join(', ')}</p>
        <p className="text-xs mt-2">Please complete patient information for safety and compliance.</p>
      </AlertDescription>
    </Alert>
  );
}