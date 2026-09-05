import SigningUnavailable from '@/components/signature/SigningUnavailable';

/**
 * Keep the legacy public signer import target static. It must not inspect
 * package props, render document metadata, or offer a review/sign action.
 */
export default function SignerDocumentSigner() {
  return <SigningUnavailable title="Secure document review and signing are unavailable" />;
}
