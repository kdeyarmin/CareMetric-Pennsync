import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * The entire workflow is quarantined, including historical read/review paths,
 * until DischargeSummary is tenant-owned and broker-authorized.
 */
export default function DischargeSummaryWorkflow() {
  return (
    <Alert variant="destructive" role="status">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Discharge summaries are temporarily unavailable</AlertTitle>
      <AlertDescription>
        Discharge summary generation is temporarily unavailable while tenant-safe storage and access controls are completed.
      </AlertDescription>
    </Alert>
  );
}
