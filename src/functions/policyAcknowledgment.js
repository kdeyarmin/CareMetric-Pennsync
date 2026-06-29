import { base44 } from '@/api/base44Client';

export const policyAcknowledgment = (payload = {}) =>
  base44.functions.invoke('policyAcknowledgment', payload);
