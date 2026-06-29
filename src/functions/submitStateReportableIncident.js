import { base44 } from '@/api/base44Client';

export const submitStateReportableIncident = (payload = {}) =>
  base44.functions.invoke('submitStateReportableIncident', payload);
