import { useLayoutEffect } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { scrubPublicCapabilityParameter } from '@/lib/publicCapabilityUrl';

export const PROVIDER_FOLLOW_UP_UNAVAILABLE_MESSAGE =
  'Online provider follow-up review and response submission are unavailable in this source checkpoint. No token was submitted, and no referral, patient, request item, or response record was loaded. Use the agency-approved fax or telephone workflow.';

/**
 * The public follow-up portal is deliberately static while token snapshots and
 * atomic single-use submission are rebuilt. Token removal from browser chrome is
 * the only side effect permitted here.
 */
export default function ProviderFollowUpPortal() {
  useLayoutEffect(() => {
    scrubPublicCapabilityParameter('token');
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
      <Card className="w-full max-w-xl border-amber-300" role="status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-950">
            <ClipboardCheck className="h-5 w-5" aria-hidden="true" />
            Online provider follow-up unavailable
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-700">
          {PROVIDER_FOLLOW_UP_UNAVAILABLE_MESSAGE}
        </CardContent>
      </Card>
    </div>
  );
}
