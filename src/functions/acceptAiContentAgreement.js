import { base44 } from '@/api/base44Client';
import { withTimeout } from '@/components/smartNote/compliance/withTimeout';

export const acceptAiContentAgreement = (payload) =>
  withTimeout(
    base44.functions.invoke('acceptAiContentAgreement', payload),
    30000,
    'Recording your acknowledgment timed out. Retry to confirm whether it was saved.',
  );