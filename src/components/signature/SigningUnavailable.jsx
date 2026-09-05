import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export const SIGNING_UNAVAILABLE_MESSAGE =
  'Document review, signature requests, signature collection, submission, history, audit, and analytics are unavailable until exact tenant-scoped brokers and an immutable authority-bound review artifact are hosted and verified. No document, patient, signer, package, or signature record was loaded. This unavailable state must not be interpreted as an empty queue, a completed request, or zero activity.';

export default function SigningUnavailable({
  title = 'Document signing unavailable',
  message = SIGNING_UNAVAILABLE_MESSAGE,
}) {
  return (
    <Alert
      className="border-amber-300 bg-amber-50 text-amber-950"
      data-signing-unavailable="true"
    >
      <AlertTriangle className="h-5 w-5 text-amber-700" aria-hidden="true" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
