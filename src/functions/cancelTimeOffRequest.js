import { base44 } from '@/api/base44Client';

export const cancelTimeOffRequest = (payload = {}) => base44.functions.invoke('cancelTimeOffRequest', payload);
