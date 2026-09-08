import { Button } from '@/components/ui/button';
import { FileText } from 'lucide-react';

export default function DischargeSummaryGenerator() {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled
      title="Discharge summaries are paused pending tenant-safe storage"
    >
      <FileText className="w-4 h-4 mr-2" />
      Discharge Summary (Unavailable)
    </Button>
  );
}
