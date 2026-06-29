import { base44 } from '@/api/base44Client';

export const validateSignerToken = (payload = {}) => base44.functions.invoke('validateSignerToken', payload);
