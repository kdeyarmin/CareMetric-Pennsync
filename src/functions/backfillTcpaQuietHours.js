import { base44 } from '@/api/base44Client';

export const backfillTcpaQuietHours = (payload = {}) =>
  base44.functions.invoke('backfillTcpaQuietHours', payload);
