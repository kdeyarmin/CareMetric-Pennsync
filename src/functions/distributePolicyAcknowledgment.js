import { base44 } from '@/api/base44Client';

export const distributePolicyAcknowledgment = (payload = {}) =>
  base44.functions.invoke('distributePolicyAcknowledgment', payload);
