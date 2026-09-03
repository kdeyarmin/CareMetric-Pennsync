import { base44 } from '@/api/base44Client';

export const listTenantTrainingIntegrityRecords = (payload = {}) =>
  base44.functions.invoke('listTenantTrainingIntegrityRecords', payload);
