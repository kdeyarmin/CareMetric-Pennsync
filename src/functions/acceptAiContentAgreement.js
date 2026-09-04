import { base44 } from '@/api/base44Client';

export const acceptAiContentAgreement = (payload) =>
  base44.functions.invoke('acceptAiContentAgreement', payload);
