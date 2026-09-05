import { Pen } from 'lucide-react';
import PageContainer from '@/components/ui/PageContainer';
import PageHeader from '@/components/ui/PageHeader';
import SigningUnavailable from '@/components/signature/SigningUnavailable';

/**
 * Internal signing is deliberately fail-closed at this source checkpoint.
 * Do not add record lookup, HTML/PDF rendering, signature capture, or submit
 * behavior here until one broker binds the exact tenant, signer roster, and
 * immutable reviewed document digest through completion.
 */
export default function SignDocument() {
  return (
    <PageContainer>
      <PageHeader
        icon={Pen}
        eyebrow="Documentation"
        title="Sign Document"
        description="Review and signature collection are temporarily unavailable"
        favoritePage="SignDocument"
      />
      <SigningUnavailable title="Document review and signing unavailable" />
    </PageContainer>
  );
}
