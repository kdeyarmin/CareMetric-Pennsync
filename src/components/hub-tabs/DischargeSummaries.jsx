import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default function DischargeSummaries() {
  return (
    <Alert variant="destructive" role="status">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Discharge summaries are temporarily unavailable</AlertTitle>
      <AlertDescription>
        This workflow is paused while tenant-safe storage and brokered access controls are completed.
      </AlertDescription>
    </Alert>
  );
}
