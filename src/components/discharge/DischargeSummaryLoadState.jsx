import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DischargeSummaryLoadState({ pending, error, onRetry }) {
  if (pending) return <div className="flex items-center justify-center py-12 text-muted-foreground">
    <Loader2 className="mr-2 h-6 w-6 animate-spin" /> Loading summary…
  </div>;
  return <div className="space-y-3 py-8 text-center" role="alert">
    <p>{error ? 'The discharge summary could not be loaded.' : 'This discharge summary was not found for the selected patient.'}</p>
    <Button variant="outline" onClick={onRetry}>Retry loading summary</Button>
  </div>;
}