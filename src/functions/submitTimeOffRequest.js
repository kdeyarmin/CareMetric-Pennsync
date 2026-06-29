import { base44 } from '@/api/base44Client';

export const submitTimeOffRequest = (payload = {}) => base44.functions.invoke('submitTimeOffRequest', payload);
