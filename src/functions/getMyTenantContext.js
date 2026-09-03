import { base44 } from '@/api/base44Client';

export const getMyTenantContext = (payload = {}) =>
  base44.functions.invoke('getMyTenantContext', payload);
