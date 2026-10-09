import { base44 } from '@/api/base44Client';
import { withTimeout } from '@/components/smartNote/compliance/withTimeout';

export async function getAiContentAgreementStatus() {
  const response = await withTimeout(
    base44.functions.invoke('getAiContentAgreementStatus', {}),
    30000,
    'Agreement verification timed out. Please retry verification.',
  );
  const status = response?.data ?? response;
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    throw new Error('Agreement verification returned an invalid response');
  }
  const keys = Object.keys(status).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'accepted'
    || keys[1] !== 'agreement_version'
    || typeof status.accepted !== 'boolean'
    || typeof status.agreement_version !== 'string'
  ) {
    throw new Error('Agreement verification returned an invalid response');
  }
  return status;
}