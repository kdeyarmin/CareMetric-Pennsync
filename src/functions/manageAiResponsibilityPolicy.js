import { base44 } from '@/api/base44Client';
import { withTimeout } from '@/components/smartNote/compliance/withTimeout';
export async function manageAiResponsibilityPolicy(payload = {}) {
  const response = await withTimeout(base44.functions.invoke('manageAiResponsibilityPolicy', payload), 30000, 'Consent setting request timed out. Please retry.');
  const result = response?.data ?? response;
  if (typeof result?.bypass_previously_acknowledged !== 'boolean') throw new Error('Could not confirm the consent setting.');
  return result;
}