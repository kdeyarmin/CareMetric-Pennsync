import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export default function AudioProcessingError({ message, onRetry, onReplace, busy }) {
  return <Alert variant="destructive">
    <AlertDescription>
      <p className="text-sm text-destructive">Audio processing failed: {message || 'Please try again.'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onRetry}>Retry audio processing</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onReplace}>Choose different audio</Button>
      </div>
    </AlertDescription>
  </Alert>;
}