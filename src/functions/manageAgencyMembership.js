import { base44 } from '@/api/base44Client';

export const manageAgencyMembership = (payload) =>
  base44.functions.invoke('manageAgencyMembership', payload);
