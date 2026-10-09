import { base44 } from '@/api/base44Client';
import protectedAiRequest from '@/lib/protectedAiRequest';

// The server loads the referral's authorized open items and owns the prompt.
export const extractReferralResponseScan = payload =>
  protectedAiRequest(() => base44.functions.invoke('extractReferralResponseScan', payload));
