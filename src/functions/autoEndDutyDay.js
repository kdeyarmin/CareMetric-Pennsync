import { base44 } from '@/api/base44Client';

export const autoEndDutyDay = (payload = {}) => base44.functions.invoke('autoEndDutyDay', payload);
