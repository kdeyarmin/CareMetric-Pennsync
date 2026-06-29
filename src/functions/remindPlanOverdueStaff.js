import { base44 } from '@/api/base44Client';

export const remindPlanOverdueStaff = (payload = {}) =>
  base44.functions.invoke('remindPlanOverdueStaff', payload);
