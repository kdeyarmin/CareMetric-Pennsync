import { getAiContentAgreementStatus } from '@/functions/getAiContentAgreementStatus';
import { hasAcceptedAiContentAgreement } from '@/lib/aiContentAgreement';

// Cancel any pre-acceptance query before issuing a fresh protected read.
// Only a verified current attestation may open the exact user's workspace.
export async function verifyAiContentAgreementAcceptance(queryClient, queryKey) {
  await queryClient.cancelQueries({ queryKey, exact: true });
  const status = await getAiContentAgreementStatus();
  if (!hasAcceptedAiContentAgreement(status)) {
    throw new Error('Your acknowledgment is not yet verified. Please retry verification.');
  }
  queryClient.setQueryData(queryKey, status);
  return status;
}