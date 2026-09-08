import { base44 } from '@/api/base44Client';

// Legacy compatibility wrapper. The backend remains statically quarantined;
// new referral-fax retry callers use sendAuthorizedReferralFax instead.
export const retryFailedFax = (payload) =>
  base44.functions.invoke('retryFailedFax', payload);
