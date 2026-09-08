import { base44 } from '@/api/base44Client';

// Browser callers supply either a new referral-fax request or the immutable id
// of a prior, provider-confirmed failed attempt. All authority is re-proved by
// the backend broker before a provider request can be made.
export const sendAuthorizedReferralFax = (payload) =>
  base44.functions.invoke('sendAuthorizedReferralFax', payload);
