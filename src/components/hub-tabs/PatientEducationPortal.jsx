import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * Patient education generation and delivery are quarantined until the backing
 * records are tenant-owned and available only through reviewed brokers.
 */
export default function PatientEducationPortal() {
  return (
    <Alert variant="destructive" role="status">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Patient education is temporarily unavailable</AlertTitle>
      <AlertDescription>
        Patient education generation is temporarily unavailable while tenant-safe storage and access controls are completed.
      </AlertDescription>
    </Alert>
  );
}
