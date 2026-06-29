import { base44 } from '@/api/base44Client';

export const duplicateInService = (payload = {}) => base44.functions.invoke('duplicateInService', payload);
