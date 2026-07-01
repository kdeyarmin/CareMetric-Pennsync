import { base44 } from '@/api/base44Client';

export const reviewTimesheet = (payload = {}) => base44.functions.invoke('reviewTimesheet', payload);
