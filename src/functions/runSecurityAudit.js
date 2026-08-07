import { base44 } from '@/api/base44Client';

export const runSecurityAudit = (payload = {}) =>
  base44.functions.invoke('runSecurityAudit', payload);
