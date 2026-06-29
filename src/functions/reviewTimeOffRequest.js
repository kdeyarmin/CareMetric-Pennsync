import { base44 } from '@/api/base44Client';

export const reviewTimeOffRequest = (payload = {}) => base44.functions.invoke('reviewTimeOffRequest', payload);
