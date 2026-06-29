import { base44 } from '@/api/base44Client';

export const retryFailedFax = (payload = {}) => base44.functions.invoke('retryFailedFax', payload);
