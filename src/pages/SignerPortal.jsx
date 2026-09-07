import { useLayoutEffect } from 'react';
import { Lock } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { APP_NAME, PLATFORM_NAME } from '@/lib/brand';
import { scrubPublicCapabilityParameter } from '@/lib/publicCapabilityUrl';

export const PUBLIC_SIGNING_UNAVAILABLE_MESSAGE =
  'Secure document review and signing are unavailable in this source checkpoint. No token was submitted, and no package, document URL, document bytes, signer roster, or signature record was loaded. Contact the document administrator for an approved signing path.';

/**
 * Public signing is deliberately static. Keep token scrubbing, but do not add a
 * validation read, document URL, upload, signature control, or submit call until
 * the complete immutable-review capability is hosted and verified.
 */
export default function SignerPortal() {
  useLayoutEffect(() => {
    scrubPublicCapabilityParameter('token');
  }, []);

  return (
    <>
      <title>{`Document signing | ${APP_NAME} by ${PLATFORM_NAME}`}</title>
      <main className="min-h-screen bg-slate-50 p-4 flex items-center justify-center">
        <Card className="w-full max-w-xl border-amber-300" role="status">
          <CardHeader>
            <h1 className="flex items-center gap-2 text-2xl font-semibold leading-tight tracking-tight text-amber-950">
              <Lock className="h-5 w-5" aria-hidden="true" />
              Document signing unavailable
            </h1>
          </CardHeader>
          <CardContent className="text-sm text-slate-700">
            {PUBLIC_SIGNING_UNAVAILABLE_MESSAGE}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
