import SigningUnavailable from '@/components/signature/SigningUnavailable';

/** Direct upload, package creation, token minting, and link delivery stay paused. */
export default function SignatureRequestCreator() {
  return <SigningUnavailable title="Signature request creation unavailable" />;
}
