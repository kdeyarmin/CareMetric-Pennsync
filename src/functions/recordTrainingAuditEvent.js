import { base44 } from '@/api/base44Client';

export const recordTrainingAuditEvent = (payload = {}) =>
  base44.functions.invoke('recordTrainingAuditEvent', payload);
