import { base44 } from '@/api/base44Client';

export const assignInService = (payload = {}) => base44.functions.invoke('assignInService', payload);
