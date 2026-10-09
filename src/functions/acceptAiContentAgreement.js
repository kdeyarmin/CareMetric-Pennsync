import { base44 } from '@/api/base44Client';
import { withTimeout } from '@/components/smartNote/compliance/withTimeout';

export async function acceptAiContentAgreement(payload) {
  const response = await withTimeout(
    base44.functions.invoke('acceptAiContentAgreement', payload),
    30000,
    'Recording your acknowledgment timed out. Retry to confirm whether it was saved.',
  );
  const result = response?.data ?? response;
  if (result?.success !== true || result.agreement_version !== payload.agreement_version) {
    throw new Error('Your acknowledgment could not be confirmed. Please try again.');
  }
  return response;
}