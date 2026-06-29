import { useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function SignatureRealTimeTracker({ packageId, onSignatureUpdate }) {
  useEffect(() => {
    let unsubscribe = null;

    const setupSubscription = async () => {
      try {
        // Subscribe to all DocumentSignature changes
        if (!base44.entities.DocumentSignature.subscribe) {
          console.warn('DocumentSignature subscription not available');
          return;
        }
        unsubscribe = base44.entities.DocumentSignature.subscribe((event) => {
          if (event.type === 'update' && event.data) {
            const sig = event.data;

            // Check if this is the signature record we're tracking.
            // 'completed' is the current status; tolerate legacy 'signed'.
            if (
              sig.id === packageId &&
              (sig.status === 'completed' || sig.status === 'signed')
            ) {
              // Derive the most recently completed signer from signers[].
              const completedSigners = (sig.signers || []).filter(
                (s) => s.status === 'completed' || s.signed_date
              );
              const primarySigner = completedSigners[completedSigners.length - 1];
              const signerName = primarySigner?.name || 'A signer';

              // Notify admin
              toast.success(
                <div className="flex gap-2 items-start">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Document Signed</p>
                    <p className="text-sm text-slate-600">{signerName} signed the document</p>
                  </div>
                </div>,
                { duration: 4000 }
              );

              // Update parent component
              if (onSignatureUpdate) {
                onSignatureUpdate(sig);
              }
            }
          }
        });
      } catch (error) {
        console.error('Failed to setup signature subscription:', error);
      }
    };

    setupSubscription();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [packageId, onSignatureUpdate]);

  return null;
}