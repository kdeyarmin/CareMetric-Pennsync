import { base44 } from '@/api/base44Client';

export const seedYearlyRequiredInServices = (payload = {}) =>
  base44.functions.invoke('seedYearlyRequiredInServices', payload);
