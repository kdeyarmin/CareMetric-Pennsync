import { base44 } from '@/api/base44Client';

export const savePayrollProfile = (payload = {}) => base44.functions.invoke('savePayrollProfile', payload);
