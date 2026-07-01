import { base44 } from '@/api/base44Client';

export const submitTimesheet = (payload = {}) => base44.functions.invoke('submitTimesheet', payload);
