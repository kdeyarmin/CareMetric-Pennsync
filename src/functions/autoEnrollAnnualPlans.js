import { base44 } from '@/api/base44Client';

export const autoEnrollAnnualPlans = (payload = {}) =>
  base44.functions.invoke('autoEnrollAnnualPlans', payload);
