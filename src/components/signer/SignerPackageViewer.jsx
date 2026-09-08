import SigningUnavailable from '@/components/signature/SigningUnavailable';

/** Public package metadata and signing actions must not render while paused. */
export default function SignerPackageViewer() {
  return <SigningUnavailable title="Secure document package unavailable" />;
}
